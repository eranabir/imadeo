import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { UploadPriorityInterceptor } from './upload-priority.interceptor';

describe('UploadPriorityInterceptor', () => {
  it.each([
    ['successful request', of({ id: 'asset-id' })],
    ['failed request', throwError(() => new Error('upload failed'))],
  ])('ends upload priority after a %s', async (_name, response) => {
    const finish = vi.fn();
    const beginUpload = vi.fn().mockReturnValue(finish);
    const interceptor = new UploadPriorityInterceptor({ beginUpload } as never);
    const result = lastValueFrom(
      interceptor.intercept({} as never, { handle: () => response } as never),
    );

    await result.catch(() => undefined);

    expect(beginUpload).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });
});

