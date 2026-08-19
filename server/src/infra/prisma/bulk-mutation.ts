/**
 * Shared limits for user-triggered operations that can touch thousands of rows.
 * Prisma's five-second interactive-transaction default is too short on a busy NAS.
 */
export const BULK_MUTATION_TRANSACTION = { maxWait: 30_000, timeout: 60_000 } as const;

export const BULK_MUTATION_BATCH_SIZE = 100;

export function batchesOf<T>(items: T[], size = BULK_MUTATION_BATCH_SIZE) {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}
