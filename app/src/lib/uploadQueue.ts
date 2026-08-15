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
