/** Runs every item exactly once while keeping pressure on a self-hosted server bounded. */
export async function runUploadQueue<T>(
  items: readonly T[],
  concurrency: number,
  upload: (item: T, index: number) => Promise<void>,
  cancelled: () => boolean = () => false,
) {
  let nextIndex = 0;
  const worker = async () => {
    while (!cancelled()) {
      const index = nextIndex++;
      if (index >= items.length) return;
      await upload(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()),
  );
}

/** Shares one concurrency ceiling between upload batches added at different times. */
export function createUploadLimiter(concurrency: number) {
  const limit = Math.max(1, concurrency);
  const waiting: Array<() => void> = [];
  let active = 0;

  const acquire = () =>
    new Promise<void>((resolve) => {
      const enter = () => {
        active += 1;
        resolve();
      };
      if (active < limit) enter();
      else waiting.push(enter);
    });

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  return async function limitUpload<T>(upload: () => Promise<T>) {
    await acquire();
    try {
      return await upload();
    } finally {
      release();
    }
  };
}
