import { expect, it } from 'vitest';
import { readDeviceAssetIndex, sortDeviceAssets, sortDevices } from './deviceSort';
it('sorts the whole device list by name, last activity, and platform', () => {
  const rows = [
    { id: 'a', libraryName: 'Phone 10', platform: 'ios', lastSeenAt: '2026-01-01' },
    { id: 'b', libraryName: 'Phone 2', platform: 'android', lastSeenAt: '2026-02-01' },
  ] as any;
  expect(sortDevices(rows, 'name', 'asc').map(d => d.id)).toEqual(['b', 'a']);
  expect(sortDevices(rows, 'date', 'asc').map(d => d.id)).toEqual(['a', 'b']);
  expect(sortDevices(rows, 'type', 'desc').map(d => d.id)).toEqual(['a', 'b']);
});
it('loads later device pages before globally grouping types', async () => {
  const seen: number[] = [];
  const all = await readDeviceAssetIndex(async page => {
    seen.push(page);
    return { items: [{ id: `${page}`, type: page === 1 ? 'VIDEO' : 'IMAGE', originalFileName: `File ${page}` }],
      pagination: { page, size: 1, total: 2 } };
  }, () => true);
  expect(seen).toEqual([1, 2]);
  expect(sortDeviceAssets(all!, 'asc').map(a => a.id)).toEqual(['2', '1']);
});
it('discards an incomplete type index when its request is cancelled', async () => {
  let active = true;
  const result = await readDeviceAssetIndex(async page => {
    active = false;
    return { items: [{ id: 'a' }], pagination: { page, size: 1, total: 2 } };
  }, () => active);
  expect(result).toBeNull();
});
