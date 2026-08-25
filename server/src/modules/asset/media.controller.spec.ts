import type { Request, Response } from 'express';
import { EventEmitter, once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { mimeFor, pipeMediaStream, thumbnailCacheControl } from './media.controller';

describe('mimeFor', () => {
  it('uses the uploaded filename when a stored original has no extension', () => {
    expect(mimeFor('/data/users/id/library/asset', 'IMG_1234.MOV')).toBe('video/quicktime');
  });

  it('prefers the generated derivative extension', () => {
    expect(mimeFor('/data/users/id/encoded-video/asset.mp4', 'IMG_1234.MOV')).toBe('video/mp4');
  });
});

describe('thumbnailCacheControl', () => {
  it('keeps a finished requested derivative in the private browser cache', () => {
    expect(thumbnailCacheControl('/data/thumbs/photo-thumb.webp', '/data/thumbs/photo-thumb.webp'))
      .toBe('private, max-age=86400');
  });

  it('does not cache provisional browser thumbnails', () => {
    expect(thumbnailCacheControl('/data/thumbs/photo-browser.jpg', '/data/thumbs/photo-browser.jpg'))
      .toBe('private, no-store');
  });

  it('does not cache a lower-resolution fallback under a preview URL', () => {
    expect(thumbnailCacheControl('/data/thumbs/photo-thumb.webp', '/data/thumbs/photo-preview.webp'))
      .toBe('private, no-store');
  });
});

describe('pipeMediaStream', () => {
  it('finishes and closes a normal media stream', async () => {
    const request = new EventEmitter() as Request;
    const responseStream = new PassThrough();
    responseStream.resume();
    const response = responseStream as unknown as Response;
    const source = Readable.from(Buffer.from('thumbnail'));

    await pipeMediaStream(source, request, response);

    expect(source.destroyed).toBe(true);
    expect(response.writableFinished).toBe(true);
  });

  it('destroys the source when the client abandons the response', async () => {
    const request = new EventEmitter() as Request;
    const responseStream = new PassThrough();
    responseStream.resume();
    const response = responseStream as unknown as Response;
    const source = new PassThrough();
    const streaming = pipeMediaStream(source, request, response);
    source.write(Buffer.alloc(64));

    request.emit('aborted');
    await streaming;

    expect(source.destroyed).toBe(true);
  });

  it('closes every file handle across repeated abandoned thumbnail requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'imadeo-stream-'));
    const path = join(directory, 'thumbnail.webp');
    await writeFile(path, Buffer.alloc(64 * 1024));

    try {
      for (let index = 0; index < 100; index++) {
        const request = new EventEmitter() as Request;
        const responseStream = new PassThrough();
        responseStream.resume();
        const response = responseStream as unknown as Response;
        const source = createReadStream(path, { highWaterMark: 1 });
        const opened = once(source, 'open');
        const streaming = pipeMediaStream(source, request, response);
        await opened;

        request.emit('aborted');
        await streaming;
        expect(source.closed).toBe(true);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
