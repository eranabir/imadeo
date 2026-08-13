import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, extname, join, parse, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sanitize from 'sanitize-filename';
import type { AppConfig } from '../../config/configuration';

export interface StoragePathContext {
  ownerId: string;
  assetId: string;
  originalFileName: string;
  localDateTime: Date;
  isLocked: boolean;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private get storage() {
    return this.config.get('storage', { infer: true });
  }

  // -- path construction ----------------------------------------------------

  buildUserRoot(userId: string) {
    return join(this.storage.users, userId);
  }

  async ensureUserRoot(userId: string) {
    const root = this.buildUserRoot(userId);
    await Promise.all(
      ['library', 'upload', 'thumbs', 'encoded-video', 'profile', 'locked'].map((directory) =>
        this.ensureDir(join(root, directory)),
      ),
    );
    return root;
  }

  /**
   * Where an original file finally lives. Each account has a self-contained
   * tree, making ownership visible on disk and straightforward to back up.
   */
  buildOriginalPath(ctx: StoragePathContext): string {
    const ext = extname(ctx.originalFileName).toLowerCase() || '.bin';
    const userRoot = this.buildUserRoot(ctx.ownerId);

    if (ctx.isLocked) {
      return join(userRoot, 'locked', `${ctx.assetId}${ext}`);
    }

    const rendered = this.renderTemplate(this.storage.template, ctx);
    return join(userRoot, 'library', rendered);
  }

  /**
   * Derivatives are fanned out over two levels of hex so no single directory
   * ends up with a million entries.
   */
  buildDerivativePath(kind: 'thumb' | 'preview' | 'video', ownerId: string, assetId: string) {
    const base = join(this.buildUserRoot(ownerId), kind === 'video' ? 'encoded-video' : 'thumbs');

    const shard = join(assetId.slice(0, 2), assetId.slice(2, 4));
    const format = this.config.get('thumbnail.format', { infer: true });
    const name =
      kind === 'video' ? `${assetId}.mp4` : `${assetId}-${kind}.${format === 'jpeg' ? 'jpg' : 'webp'}`;

    return join(base, shard, name);
  }

  buildProfilePath(userId: string, ext: string) {
    return join(this.buildUserRoot(userId), 'profile', `avatar${ext}`);
  }

  buildPersonThumbnailPath(ownerId: string, personId: string) {
    return join(this.buildUserRoot(ownerId), 'thumbs', 'people', `${personId}.jpeg`);
  }

  /** Temporary landing spot before the pipeline knows the real capture date. */
  buildIncomingPath(ownerId: string, filename: string) {
    return join(this.buildUserRoot(ownerId), 'upload', sanitize(filename));
  }

  private renderTemplate(template: string, ctx: StoragePathContext) {
    const d = ctx.localDateTime;
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    const parsed = parse(sanitize(ctx.originalFileName));

    const tokens: Record<string, string> = {
      y: String(d.getFullYear()),
      yy: pad(d.getFullYear() % 100),
      MM: pad(d.getMonth() + 1),
      MMM: d.toLocaleString('en', { month: 'short' }),
      MMMM: d.toLocaleString('en', { month: 'long' }),
      dd: pad(d.getDate()),
      HH: pad(d.getHours()),
      mm: pad(d.getMinutes()),
      ss: pad(d.getSeconds()),
      filename: parsed.name,
      ext: parsed.ext.replace('.', ''),
      assetId: ctx.assetId,
      // Short id keeps names unique when two cameras produce IMG_0001.jpg.
      shortId: ctx.assetId.slice(0, 8),
    };

    const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => tokens[key] ?? '');

    // A template that forgets the extension still has to produce a usable file.
    const withExt = extname(rendered) ? rendered : `${rendered}${parsed.ext}`;

    return withExt
      .split(/[/\\]/)
      .filter(Boolean)
      .map((segment) => sanitize(segment))
      .join(sep);
  }

  /**
   * Guards against a template or filename escaping the media root. Every write
   * goes through this.
   */
  assertInsideRoot(path: string) {
    const root = resolve(this.storage.root);
    const target = resolve(path);
    const rel = relative(root, target);
    if (rel.startsWith('..') || resolve(root, rel) !== target) {
      throw new Error(`Refusing to write outside the media root: ${path}`);
    }
    return target;
  }

  // -- file operations ------------------------------------------------------

  async ensureDir(path: string) {
    await mkdir(path, { recursive: true });
  }

  async exists(path: string) {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async size(path: string) {
    const info = await stat(path);
    return info.size;
  }

  /**
   * Moves a file, falling back to copy+unlink when source and destination are
   * on different filesystems (common when /data is a bind mount).
   */
  async move(from: string, to: string) {
    this.assertInsideRoot(to);
    await this.ensureDir(dirname(to));

    const target = await this.resolveCollision(to);
    try {
      await rename(from, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyFile(from, target);
      await unlink(from);
    }
    return target;
  }

  async writeStream(stream: NodeJS.ReadableStream, to: string) {
    this.assertInsideRoot(to);
    await this.ensureDir(dirname(to));
    await pipeline(stream, createWriteStream(to));
    return to;
  }

  readStream(path: string) {
    return createReadStream(path);
  }

  async remove(path: string) {
    try {
      await rm(path, { force: true });
    } catch (error) {
      this.logger.warn(`Could not remove ${path}: ${(error as Error).message}`);
    }
  }

  async removeMany(paths: (string | null | undefined)[]) {
    await Promise.all(paths.filter((p): p is string => Boolean(p)).map((p) => this.remove(p)));
  }

  /**
   * Two different photos can legitimately render to the same path (same second,
   * same camera). Suffix rather than overwrite.
   */
  private async resolveCollision(path: string) {
    if (!(await this.exists(path))) return path;

    const { dir, name, ext } = parse(path);
    for (let i = 1; i < 1000; i++) {
      const candidate = join(dir, `${name}+${i}${ext}`);
      if (!(await this.exists(candidate))) return candidate;
    }
    throw new Error(`Could not find a free filename for ${path}`);
  }
}
