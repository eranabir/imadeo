/** Bulk APIs can return HTTP 200 while rejecting individual files. */
export function assertActionResults(result: unknown) {
  if (!Array.isArray(result)) return;
  const failures = result.filter((entry) => entry?.success === false && entry?.error !== 'duplicate');
  if (failures.length) {
    throw new Error(`${failures.length} ${failures.length === 1 ? 'item could' : 'items could'} not be changed. Check access to the selected items and try again.`);
  }
}
