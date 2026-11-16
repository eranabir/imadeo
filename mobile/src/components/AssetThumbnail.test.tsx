import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), memoryWarning: null as null | (() => void), logout: null as null | ((token: string | null) => void) }));
vi.mock('expo-image', () => ({ Image: Object.assign((props: any) => React.createElement('Image', props), { loadAsync: mocks.load }) }));
vi.mock('react-native', () => ({ AppState: { addEventListener: (_: string, callback: () => void) => { mocks.memoryWarning = callback; } } }));
vi.mock('../lib/auth', () => ({ onTokenChanged: (callback: (token: string | null) => void) => { mocks.logout = callback; } }));
vi.mock('../lib/api', () => ({ thumbnail: (server: string, id: string, token: string | null) => ({ uri: `${server}/api/assets/${id}/thumbnail`, headers: { Authorization: `Bearer ${token}` } }) }));
import { AssetThumbnail, cachedThumbnail } from './AssetThumbnail';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
const props = { serverUrl: 'https://photos.test', assetId: 'photo', token: 'token' };
async function render(overrides = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<AssetThumbnail {...props} {...overrides} />); });
  mounted.push(tree);
  return tree;
}
beforeEach(() => { mocks.memoryWarning?.(); mocks.load.mockReset().mockImplementation(() => new Promise(() => {})); });
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });

describe('Grid thumbnail loading', () => {
  it('uses small authenticated thumbnails instead of viewer previews during scrolling', async () => {
    const tree = await render();
    const image = tree.root.findByType('Image' as any);
    expect(image.props.source).toEqual({ uri: 'https://photos.test/api/assets/photo/thumbnail', headers: { Authorization: 'Bearer token' } });
    expect(mocks.load.mock.calls[0][0]).toEqual(image.props.source);
    expect(image.props.transition).toBe(0);
  });

  it('shares decoded thumbnails with recycled tiles and the viewer without a second preload', async () => {
    const image = { nativeRef: 'small-thumbnail' };
    mocks.load.mockResolvedValue(image);
    const first = await render();
    expect(first.root.findByType('Image' as any).props.source).toBe(image);
    expect(cachedThumbnail(props.serverUrl, props.assetId, props.token)).toBe(image);
    await act(async () => first.unmount());
    mounted.splice(mounted.indexOf(first), 1);
    const recycled = await render();
    expect(recycled.root.findByType('Image' as any).props.source).toBe(image);
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it('does not retain a late thumbnail after logout', async () => {
    let finish!: (image: any) => void;
    mocks.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render();
    mocks.logout?.(null);
    await act(async () => finish({ nativeRef: 'old-session' }));
    expect(cachedThumbnail(props.serverUrl, props.assetId, props.token)).toBeUndefined();
  });
});
