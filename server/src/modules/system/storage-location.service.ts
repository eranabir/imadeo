import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { readFile, statfs } from 'node:fs/promises';
import { platform } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { AppConfig } from '../../config/configuration';

export type HostKind = 'docker' | 'windows' | 'macos' | 'linux';

/**
 * Answers "where are my photos actually on disk?", which changes meaning
 * depending on how Imadeo was installed.
 *
 * The distinction that matters is Docker: inside a container the media root is
 * something like `/data`, which does not exist on the user's Mac or Windows
 * machine at all — the real location is whatever host directory was bound to
 * it, and only the person who wrote the compose file knows that. Reporting the
 * container path on its own would send people looking for a folder that is not
 * there, so the container case is labelled as such and explained.
 */
@Injectable()
export class StorageLocationService {
  private readonly logger = new Logger(StorageLocationService.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /**
   * Docker sets neither an environment variable nor a hostname we can rely on,
   * so this checks the two marks that are actually dependable: the file the
   * daemon drops into every container, and the control groups of PID 1.
   */
  private async detectContainer(): Promise<boolean> {
    if (existsSync('/.dockerenv')) return true;

    try {
      const cgroup = await readFile('/proc/1/cgroup', 'utf8');
      return /docker|containerd|kubepods/.test(cgroup);
    } catch {
      // No /proc at all means this is Windows or macOS running natively.
      return false;
    }
  }

  private hostKind(inContainer: boolean): HostKind {
    if (inContainer) return 'docker';
    switch (platform()) {
      case 'win32':
        return 'windows';
      case 'darwin':
        return 'macos';
      default:
        return 'linux';
    }
  }

  private async disk(path: string) {
    try {
      const stats = await statfs(path);
      const blockSize = stats.bsize;
      return {
        totalBytes: stats.blocks * blockSize,
        availableBytes: stats.bavail * blockSize,
        usedBytes: (stats.blocks - stats.bfree) * blockSize,
      };
    } catch (error) {
      // An unmounted volume or a path that does not exist yet: report the
      // location anyway, just without the capacity figures.
      this.logger.warn(`Could not read disk usage for ${path}: ${error}`);
      return null;
    }
  }

  async describe(storageLabel: string | null) {
    const storage = this.config.get('storage', { infer: true });
    const inContainer = await this.detectContainer();
    const host = this.hostKind(inContainer);

    /**
     * `MEDIA_LOCATION` is written by hand, so on Windows it usually arrives
     * with forward slashes while everything derived from it through `join`
     * comes back with backslashes. Showing both styles side by side looks like
     * two different folders, so every path is normalised to the platform's own.
     */
    const show = (path: string) => resolve(path);
    const root = show(storage.root);

    return {
      host,
      inContainer,
      /** Path separator, so the client can render examples that look native. */
      separator: sep,
      root,
      exists: existsSync(root),
      /**
       * In a container these are paths *inside* the container. The host
       * directory is whatever the `MEDIA_LOCATION` volume is bound to, which
       * the server genuinely cannot see from in here.
       */
      paths: {
        originals: show(storage.upload),
        incoming: show(storage.incoming),
        thumbnails: show(storage.thumbs),
        encodedVideo: show(storage.encodedVideo),
        profile: show(storage.profile),
        backups: show(storage.backups),
        vault: show(storage.vault),
      },
      /** This account's own folder underneath the originals directory. */
      library: storageLabel ? show(join(storage.upload, storageLabel)) : null,
      disk: await this.disk(root),
    };
  }
}
