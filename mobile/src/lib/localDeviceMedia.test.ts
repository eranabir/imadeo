import { expect, it, vi } from 'vitest';
import { readLocalDevicePage } from './localDeviceMedia';
const asset = (id: string, filename: string) => ({ id, filename, creationTime: 1, mediaType: 'photo' } as any);
it('asks Photos to sort the complete library by date/type before pagination', async () => {
  const fetch = vi.fn().mockResolvedValue({ assets: [], hasNextPage: false });
  await readLocalDevicePage(fetch, 'date', 'asc', 120);
  expect(fetch.mock.calls[0][0].sortBy).toEqual([['creationTime', true]]);
  await readLocalDevicePage(fetch, 'type', 'desc', 120, 'cursor');
  expect(fetch.mock.calls[1][0]).toMatchObject({ after: 'cursor', sortBy: [['mediaType', false], ['creationTime', false]] });
});
it('indexes every metadata page before ordering filenames', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ assets: [asset('10', 'IMG_10.jpg')], endCursor: 'one', hasNextPage: true, totalCount: 2 })
    .mockResolvedValueOnce({ assets: [asset('2', 'IMG_2.jpg')], endCursor: 'two', hasNextPage: false, totalCount: 2 });
  const result = await readLocalDevicePage(fetch, 'name', 'asc', 120);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result?.assets.map(a => a.id)).toEqual(['2', '10']);
  expect(result?.hasNextPage).toBe(false);
});
it('does not continue or expose a partial filename index after cancellation', async () => {
  let active = true;
  const fetch = vi.fn().mockImplementation(async () => {
    active = false;
    return { assets: [asset('1', 'IMG_1.jpg')], endCursor: 'one', hasNextPage: true };
  });
  expect(await readLocalDevicePage(fetch, 'name', 'asc', 120, undefined, () => active)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('skips fully hidden native pages without losing the original continuation cursor', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce({ assets: [asset('trash-1', 'A.jpg')], endCursor: 'native-one', hasNextPage: true, totalCount: 4 })
    .mockResolvedValueOnce({ assets: [asset('trash-2', 'B.jpg')], endCursor: 'native-two', hasNextPage: true, totalCount: 4 })
    .mockResolvedValueOnce({ assets: [asset('visible', 'C.jpg')], endCursor: 'native-three', hasNextPage: true, totalCount: 4 });
  const result = await readLocalDevicePage(fetch, 'date', 'desc', 1, undefined, () => true, new Set(['trash-1', 'trash-2']));
  expect(result?.assets.map(a => a.id)).toEqual(['visible']);
  expect(result?.endCursor).toBe('native-three');
  expect(result?.hasNextPage).toBe(true);
  expect(result?.totalCount).toBe(4);
  expect(fetch.mock.calls.slice(1).map(([options]) => options.after)).toEqual(['native-one', 'native-two']);
});
it('finishes a type page cleanly when its remaining items are all hidden', async () => {
  const fetch = vi.fn().mockResolvedValue({ assets: [asset('trash', 'A.jpg')], endCursor: 'final', hasNextPage: false, totalCount: 1 });
  const result = await readLocalDevicePage(fetch, 'type', 'asc', 1, 'previous', () => true, new Set(['trash']));
  expect(result?.assets).toEqual([]);
  expect(result?.hasNextPage).toBe(false);
  expect(result?.endCursor).toBe('final');
});
it('filters the complete filename index, including IDs excluded during a later page', async () => {
  const hidden = new Set(['trash']);
  const fetch = vi.fn()
    .mockResolvedValueOnce({ assets: [asset('new-trash', 'IMG_1.jpg')], endCursor: 'one', hasNextPage: true, totalCount: 3 })
    .mockImplementationOnce(async () => {
      hidden.add('new-trash');
      return { assets: [asset('trash', 'IMG_0.jpg'), asset('visible', 'IMG_2.jpg')], endCursor: 'final', hasNextPage: false, totalCount: 3 };
    });
  const result = await readLocalDevicePage(fetch, 'name', 'asc', 120, undefined, () => true, hidden);
  expect(result?.assets.map(a => a.id)).toEqual(['visible']);
  expect(result?.totalCount).toBe(3);
});
it('stops skipping hidden pages when the request is cancelled', async () => {
  let active = true;
  const fetch = vi.fn().mockImplementation(async () => {
    active = false;
    return { assets: [asset('trash', 'A.jpg')], endCursor: 'one', hasNextPage: true, totalCount: 2 };
  });
  expect(await readLocalDevicePage(fetch, 'date', 'asc', 1, undefined, () => active, new Set(['trash']))).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
