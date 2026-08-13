import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import archiver from 'archiver';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { AuthDto } from '../../common/auth.types';
import { Auth, Authed } from '../../common/decorators';
import { AssetService } from './asset.service';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo', '.m4v': 'video/x-m4v', '.3gp': 'video/3gpp',
};

const mimeFor = (path: string) => MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';

@ApiTags('Media')
@Controller('assets')
export class MediaController {
  constructor(private readonly assetService: AssetService) {}

  @Auth({ sharedLink: true })
  @Get(':id/thumbnail')
  @ApiOperation({ summary: 'Grid thumbnail. Falls back to the original until one is generated.' })
  // A derivative may not exist on the first request immediately after upload.
  // Revalidation prevents that temporary response becoming permanent.
  @Header('Cache-Control', 'private, no-cache')
  async thumbnail(
    @Authed() auth: AuthDto,
    @Param('id') id: string,
    @Query('size') size: 'thumbnail' | 'preview' = 'thumbnail',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { path } = await this.assetService.resolveMediaPath(
      auth,
      id,
      size === 'preview' ? 'preview' : 'thumbnail',
    );
    return this.send(path, req, res);
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
    const { path } = await this.assetService.resolveMediaPath(auth, id, 'original');
    return this.send(path, req, res);
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
    const { path } = await this.assetService.resolveMediaPath(
      auth,
      id,
      quality === 'original' ? 'original' : 'video',
    );
    return this.send(path, req, res);
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
    return this.send(path, req, res);
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
  private async send(path: string, req: Request, res: Response) {
    const info = await stat(path);
    const mime = mimeFor(path);
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mime);

    if (!range) {
      res.setHeader('Content-Length', info.size);
      createReadStream(path).pipe(res);
      return;
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
    createReadStream(path, { start, end }).pipe(res);
  }
}
