import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), clear: null as null | (() => void), logout: null as null | ((token: string | null) => void) }));
vi.mock('expo-image', () => ({ Image: Object.assign((props: any) => React.createElement('Image', props), { loadAsync: mocks.load }) }));
vi.mock('react-native', () => ({ AppState: { addEventListener: (_: string, callback: () => void) => { mocks.clear = callback; } } }));
vi.mock('../lib/auth', () => ({ onTokenChanged: (callback: (token: string | null) => void) => { mocks.logout = callback; } }));
vi.mock('../lib/api', () => ({ thumbnail: (server: string, id: string, token: string | null) => ({ uri: `${server}/api/assets/${id}/thumbnail`, headers: { Authorization: `Bearer ${token}` } }) }));
import { AssetThumbnail, cachedThumbnail } from './AssetThumbnail';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
const props = { serverUrl: 'https://photos.test', assetId: 'photo', token: 'token' };
async function render(extra = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<AssetThumbnail {...props} {...extra} />); });
  mounted.push(tree); return tree;
}
const image = (tree: ReactTestRenderer) => tree.root.findByType('Image' as any);
beforeEach(() => { mocks.clear?.(); mocks.load.mockClear(); });
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });
describe('Visible thumbnail loading', () => {
  it('paints the small thumbnail before requesting a sharper preview, without JS preloads', async () => {
    const tree = await render();
    expect(image(tree).props.source.uri).toBe('https://photos.test/api/assets/photo/thumbnail');
    await act(async () => image(tree).props.onDisplay());
    expect(image(tree).props.source.uri).toContain('size=preview');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(image(tree).props.allowDownscaling).toBe(true);
  });
  it('does not request images for rows outside the viewport and buffer', async () => {
    const tree = await render({ enabled: false });
    expect(image(tree).props.source).toBeNull();
    await act(async () => image(tree).props.onDisplay());
    expect(cachedThumbnail(props.serverUrl, props.assetId, props.token)).toBeUndefined();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('keeps a good small thumbnail when the sharp upgrade fails', async () => {
    const tree = await render();
    await act(async () => image(tree).props.onDisplay());
    await act(async () => image(tree).props.onError({}));
    expect(image(tree).props.source.uri).not.toContain('preview');
    await act(async () => image(tree).props.onDisplay());
    expect(image(tree).props.source.uri).not.toContain('preview');
  });
  it('does not repopulate another session cache from a late native display event', async () => {
    const tree = await render();
    const late = image(tree).props.onDisplay;
    mocks.logout?.(null);
    await act(async () => late());
    expect(cachedThumbnail(props.serverUrl, props.assetId, props.token)).toBeUndefined();
  });
});
