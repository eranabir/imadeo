import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import archiver from 'archiver';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AuthDto } from '../../common/auth.types';
import { Auth, Authed } from '../../common/decorators';
import { AssetService } from './asset.service';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.dng': 'image/x-adobe-dng',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v', '.3gp': 'video/3gpp',
};

/**
 * Originals are stored by path without an extension. Keep using a derivative's
 * real extension when it has one, then fall back to the uploaded filename so
 * native media players receive a useful Content-Type while processing catches up.
 */
export const mimeFor = (path: string, originalFileName?: string) => {
  const extension = extname(path).toLowerCase() || extname(originalFileName ?? '').toLowerCase();
  return MIME_TYPES[extension] ?? 'application/octet-stream';
};

/**
 * Finished derivatives are immutable during normal browsing and safe to keep
 * in the private browser cache. A provisional browser thumbnail, or a smaller
 * derivative used as a temporary fallback, must be fetched again after the
 * processing worker replaces it.
 */
export const thumbnailCacheControl = (path: string, expectedPath: string | null) =>
  path === expectedPath && !path.endsWith('-browser.jpg')
    ? 'private, max-age=86400'
    : 'private, no-store';

/** Close the source immediately when a browser abandons a thumbnail or video. */
export async function pipeMediaStream(source: Readable, req: Request, res: Response) {
  const abortController = new AbortController();
  const abort = () => {
    if (!res.writableFinished) abortController.abort();
  };
  req.once('aborted', abort);
  res.once('close', abort);

  try {
    await pipeline(source, res, { signal: abortController.signal });
  } catch (error) {
    // Closing a tab or scrolling a virtual grid recycles image requests. That
    // is a normal cancellation, not a server error.
    if (!abortController.signal.aborted && !req.destroyed && !res.destroyed) throw error;
  } finally {
    req.off('aborted', abort);
    res.off('close', abort);
    source.destroy();
  }
}

@ApiTags('Media')
@Controller('assets')
export class MediaController {
  constructor(private readonly assetService: AssetService) {}

  @Auth({ sharedLink: true })
  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Grid thumbnail. Falls back to the original until one is generated.' })
  async thumbnail(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Query('size') size: 'thumbnail' | 'preview' = 'thumbnail',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const requestedSize = size === 'preview' ? 'preview' : 'thumbnail';
    const { path, asset } = await this.assetService.resolveMediaPath(
      auth,
      id,
      requestedSize,
    );
    res.setHeader(
      'Cache-Control',
      thumbnailCacheControl(
        path,
        requestedSize === 'preview' ? asset.previewPath : asset.thumbnailPath,
      ),
    );
    return this.send(path, req, res, asset.originalFileName);
  }

  @Auth({ sharedLink: true })
  @Get(':id/original')
  @ApiOperation({ summary: 'The untouched uploaded file' })
  @Header('Cache-Control', 'private, max-age=31536000, immutable')
  async original(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { path, asset } = await this.assetService.resolveMediaPath(auth, id, 'original');
    return this.send(path, req, res, asset.originalFileName);
  }

  @Auth({ sharedLink: true })
  @Get(':id/video')
  @ApiOperation({
    summary: 'Playable video stream',
    description:
      'Serves the transcoded copy when one exists, otherwise the original. Supports range requests so players can seek.',
  })
  async video(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Query('quality') quality: 'original' | 'transcoded' = 'transcoded',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { path, asset } = await this.assetService.resolveMediaPath(
      auth,
      id,
      quality === 'original' ? 'original' : 'video',
    );
    return this.send(path, req, res, asset.originalFileName);
  }

  @Auth({ sharedLink: true })
  @Get(':id/download')
  @ApiOperation({ summary: 'Download the original as an attachment' })
  async download(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { path, asset } = await this.assetService.resolveMediaPath(auth, id, 'original');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(asset.originalFileName)}"`,
    );
    return this.send(path, req, res, asset.originalFileName);
  }

  @Auth()
  @Get('download/archive')
  @ApiOperation({ summary: 'Stream several assets as one zip, built on the fly' })
  async archive(
    @Authed() auth: AuthDto,
    @Query('ids') ids: string,
    @Query('name') name: string | undefined,
    @Res() res: Response,
  ) {
    const assetIds = (ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(name || 'imadeo')}.zip"`,
    );

    // No compression: photos and videos are already compressed, so store-only
    // saves a lot of CPU and lets the download start immediately.
    const zip = archiver('zip', { zlib: { level: 0 }, store: true });
    zip.on('error', () => res.destroy());
    zip.pipe(res);

    const used = new Set<string>();
    for (const id of assetIds) {
      try {
        const { path, asset } = await this.assetService.resolveMediaPath(auth, id, 'original');
        // Two photos can share a filename; keep both.
        let entry = asset.originalFileName;
        if (used.has(entry)) {
          const ext = extname(entry);
          entry = `${basename(entry, ext)}_${id.slice(0, 8)}${ext}`;
        }
        used.add(entry);
        zip.file(path, { name: entry });
      } catch {
        // Skip anything the caller may not read rather than failing the archive.
      }
    }

    await zip.finalize();
  }

  /**
   * Streams a file, honouring `Range` so browsers and native players can seek
   * without downloading the whole video first.
   */
  private async send(path: string, req: Request, res: Response, originalFileName?: string) {
    const info = await stat(path);
    const mime = mimeFor(path, originalFileName);
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mime);

    if (!range) {
      res.setHeader('Content-Length', info.size);
      return pipeMediaStream(createReadStream(path), req, res);
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${info.size}`);
      return res.end();
    }

    // An open-ended "bytes=500-" means "from 500 to the end".
    const start = match[1] ? Number.parseInt(match[1], 10) : 0;
    const end = match[2] ? Number.parseInt(match[2], 10) : info.size - 1;

    if (start >= info.size || end >= info.size || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${info.size}`);
      return res.end();
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    res.setHeader('Content-Length', end - start + 1);
    return pipeMediaStream(createReadStream(path, { start, end }), req, res);
  }
}
