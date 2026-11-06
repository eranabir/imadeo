import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('expo-router', () => ({ useFocusEffect: vi.fn() }));
vi.mock('./api', () => ({
  request: api.request,
  useToken: () => 'token',
  usePagedResource: () => ({ items: [], loading: false, error: null }),
}));
import { useDeviceAssets } from './useDeviceAssets';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('uses stable server dates to index duplicate filenames across pages before type sorting', async () => {
  api.request.mockImplementation(async (_server: string, path: string) => {
    const params = new URL(path, 'https://server').searchParams;
    expect(params.get('sortBy')).toBe('date');
    expect(params.get('order')).toBe('asc');
    const page = Number(params.get('page'));
    return { items: page === 1
      ? Array.from({ length: 1000 }, (_, n) => ({ id: `video-${n}`, type: 'VIDEO', originalFileName: 'IMG_1.jpg' }))
      : [{ id: 'photo', type: 'IMAGE', originalFileName: 'IMG_1.jpg' }],
    pagination: { page, size: 1000, total: 1001 } };
  });
  let current!: ReturnType<typeof useDeviceAssets>;
  function Screen() { current = useDeviceAssets('https://server', 'phone', 'type', 'asc'); return null; }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<Screen />); });
  expect(api.request).toHaveBeenCalledTimes(2);
  expect(current.error).toBeNull();
  expect(current.loading).toBe(false);
  expect(current.items).toHaveLength(1001);
  expect(current.items[0].id).toBe('photo');
  await act(async () => tree.unmount());
});
