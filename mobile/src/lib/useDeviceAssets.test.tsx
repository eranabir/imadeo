import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
const paged = vi.hoisted(() => vi.fn(() => ({ items: [], loading: false, error: null })));
vi.mock('./api', () => ({ usePagedResource: paged }));
import { useDeviceAssets } from './useDeviceAssets';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('uses server type ordering with random-access pagination instead of scanning every device photo', async () => {
  function Screen() { useDeviceAssets('https://server', 'phone', 'type', 'asc'); return null; }
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Screen />); });
  expect(paged).toHaveBeenCalledWith('https://server', '/assets?deviceId=phone&sortBy=type&order=asc');
  await act(async () => tree.unmount());
});
