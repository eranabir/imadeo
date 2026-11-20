import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ offset: vi.fn(), limit: vi.fn(), metadata: vi.fn(async () => []), count: vi.fn(async () => ({ totalCount: 22680 })), loader: null as any }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-media-library', () => ({
  AssetField: { MEDIA_TYPE: 'type', CREATION_TIME: 'date' }, MediaType: { IMAGE: 'image', VIDEO: 'video' },
  Query: class { within() { return this; } orderBy() { return this; }
    offset(value: number) { calls.offset(value); return this; } limit(value: number) { calls.limit(value); return this; }
    exeForMetadata() { return calls.metadata(); } },
}));
vi.mock('expo-media-library/legacy', () => ({ getAssetsAsync: calls.count }));
vi.mock('./usePageWindow', () => ({ usePageWindow: (_key: string, loader: any) => { calls.loader = loader; return { reload: async () => {} }; } }));
import { useLocalPhotoIndex } from './useLocalPhotoIndex';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => { await act(async () => tree?.unmount()); vi.clearAllMocks(); });
const excluded = new Set<string>();
function Test() { useLocalPhotoIndex(true, 'date', 'desc', excluded, 0); return null; }
describe('PhotoKit random access', () => {
  it('reads only 60 metadata records at the requested offset for a distant phone-library page', async () => {
    await act(async () => { tree = create(<Test />); });
    const page = await calls.loader(378, new AbortController().signal);
    expect(calls.offset.mock.calls).toEqual([[22620]]);
    expect(calls.limit.mock.calls).toEqual([[60]]);
    expect(calls.metadata).toHaveBeenCalledTimes(1);
    expect(calls.count).toHaveBeenCalledWith({ first: 1, mediaType: ['photo', 'video'] });
    expect(page.total).toBe(22680);
  });
});
