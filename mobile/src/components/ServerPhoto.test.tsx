import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), cached: vi.fn() }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'ios' }, StyleSheet: { absoluteFill: {} } }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('../lib/auth', () => ({ ensureFreshToken: mocks.refresh }));
vi.mock('./AssetThumbnail', () => ({ cachedThumbnail: mocks.cached }));
vi.mock('./Icon', () => ({ Icon: 'Icon' }));
vi.mock('./ZoomableMedia', () => ({ ZoomableMedia: (props: any) => React.createElement('ZoomSurface', props, props.children) }));
vi.mock('./ui', () => ({ Touchable: (props: any) => React.createElement('Touchable', props, props.children) }));
import { ServerPhoto } from './ServerPhoto';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const defaults = { serverUrl: 'https://nas.test', token: 'token', asset: { id: 'photo' }, width: 402, height: 650, rotation: 0 as const, loadOriginal: true, active: true };
const mounted: ReactTestRenderer[] = [];
async function render(props = defaults) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ServerPhoto {...props} />); });
  mounted.push(tree); return tree;
}
const layers = (tree: ReactTestRenderer) => tree.root.findAllByType('Image' as any);
const layer = (tree: ReactTestRenderer, name: string) => layers(tree).find(n => n.props.testID === `viewer-photo-${name}`)!;
beforeEach(() => { vi.useFakeTimers(); mocks.refresh.mockReset().mockResolvedValue('fresh-token'); mocks.cached.mockReset(); });
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); vi.useRealTimers(); });

describe('Server photo lifecycle', () => {
  it('paints a decoded grid thumbnail immediately and defers the original during opening', async () => {
    const image = { nativeRef: 'decoded-thumbnail' }; mocks.cached.mockReturnValue(image);
    const tree = await render({ ...defaults, loadOriginal: false });
    expect(layer(tree, 'thumb').props.source).toBe(image);
    expect(layer(tree, 'original')).toBeUndefined();
    expect(tree.root.findAllByType('ActivityIndicator' as any)).toHaveLength(0);
    await act(async () => tree.update(<ServerPhoto {...defaults} />));
    expect(layer(tree, 'original')).toBeTruthy();
  });
  it('never hides a displayed preview until the original has actually painted', async () => {
    const tree = await render();
    await act(async () => layer(tree, 'preview').props.onDisplay());
    expect(layer(tree, 'thumb')).toBeUndefined();
    expect(layer(tree, 'original').props.onLoad).toBeUndefined();
    expect(layer(tree, 'preview')).toBeTruthy();
    await act(async () => layer(tree, 'original').props.onDisplay());
    expect(layer(tree, 'preview')).toBeUndefined();
    // Paging away must not remove the only displayed image from its page.
    await act(async () => tree.update(<ServerPhoto {...defaults} loadOriginal={false} />));
    expect(layer(tree, 'original')).toBeTruthy();
  });
  it('keeps a good preview when an unsupported original fails', async () => {
    const tree = await render();
    await act(async () => layer(tree, 'preview').props.onDisplay());
    await act(async () => layer(tree, 'original').props.onError());
    expect(layer(tree, 'preview')).toBeTruthy();
    expect(layer(tree, 'original')).toBeUndefined();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('recovers authentication once, then exposes a retry instead of a blank screen', async () => {
    const tree = await render();
    await act(async () => { for (const image of layers(tree)) image.props.onError(); });
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith('https://nas.test', 0);
    expect(layer(tree, 'original').props.source.headers.Authorization).toBe('Bearer fresh-token');
    await act(async () => { for (const image of layers(tree)) image.props.onError(); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    const retry = tree.root.findByType('Touchable' as any);
    expect(retry.props.label).toBe('Retry photo');
    expect(tree.root.findByType('ZoomSurface' as any).findAllByType('Touchable' as any)).toHaveLength(0);
    await act(async () => retry.props.onPress());
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(layer(tree, 'original').props.source.uri).toContain('retry=2');
  });
  it('offers recovery for a hung request and for an unavailable auth endpoint', async () => {
    const tree = await render();
    await act(async () => { vi.advanceTimersByTime(20_001); });
    expect(JSON.stringify(tree.toJSON())).toContain('This photo could not be loaded.');
    mocks.refresh.mockRejectedValueOnce(Error('Offline'));
    await act(async () => tree.root.findByType('Touchable' as any).props.onPress());
    expect(JSON.stringify(tree.toJSON())).toContain('Could not reconnect');
  });
  it('ignores a late retry after the user switches photos', async () => {
    let done!: (value: string) => void;
    mocks.refresh.mockImplementation(() => new Promise(resolve => { done = resolve; }));
    const tree = await render();
    await act(async () => { for (const image of layers(tree)) image.props.onError(); });
    await act(async () => tree.update(<ServerPhoto {...defaults} asset={{ id: 'other' }} />));
    await act(async () => done('old-request-token'));
    expect(layer(tree, 'original').props.source.uri).toContain('/other/original');
    expect(layer(tree, 'original').props.source.headers.Authorization).toBe('Bearer token');
  });
});
