vi.mock('./ViewerButton', () => ({ ViewerAction: 'ViewerAction' }));
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  insets: { top: 62, bottom: 34, left: 0, right: 0 },
  player: {
    currentTime: 0,
    duration: 30,
    addListener: vi.fn(() => ({ remove: vi.fn() })),
    replaceAsync: vi.fn(async () => undefined),
    pause: vi.fn(),
    play: vi.fn(),
  },
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }, View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => state.insets }));
vi.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }));
vi.mock('expo-video', () => ({ useVideoPlayer: () => state.player, VideoView: 'VideoView' }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('../lib/preferences', () => ({ autoplayVideos: () => false }));
vi.mock('../lib/actions', () => ({ actions: {} }));
vi.mock('../lib/api', () => ({ ApiError: Error, duration: () => '' }));
vi.mock('../lib/exportAsset', () => ({ exportAsset: vi.fn() }));
vi.mock('../lib/auth', () => ({ ensureFreshToken: vi.fn(async () => null) }));
vi.mock('./grow', () => ({ useGrowFrom: vi.fn() }));
vi.mock('./sheets', () => ({ ConfirmSheet: 'ConfirmSheet', VaultSheet: 'VaultSheet' }));
vi.mock('./Icon', () => ({ Icon: 'Icon' }));
vi.mock('./ui', () => ({ Touchable: 'Touchable' }));
vi.mock('./Glass', () => ({ Glass: 'Glass' }));
vi.mock('./ZoomableMedia', () => ({ ZoomableMedia: 'ZoomableMedia' }));
vi.mock('./ViewerFilmstrip', () => ({ ViewerFilmstrip: 'ViewerFilmstrip' }));
vi.mock('./ServerPhoto', () => ({ ServerPhoto: 'ServerPhoto' }));
import { VideoPage } from './AssetViewer';
import { ViewerHeader, ViewerDock } from './ViewerChrome';
import { applyPalette, DARK, LIGHT } from '../theme';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
const props = {
  uri: 'ph://local-video', token: null, active: true, controlsVisible: true,
  width: 402, height: 874, rotation: 0 as const, safeBottom: 12,
};
async function render(overrides: Partial<React.ComponentProps<typeof VideoPage>> = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<VideoPage {...props} {...overrides} />); });
  mounted.push(tree);
  return tree;
}
beforeEach(() => {
  state.insets = { top: 62, bottom: 34, left: 0, right: 0 };
  vi.clearAllMocks();
});
afterEach(async () => {
  applyPalette(DARK);
  for (const tree of mounted.splice(0)) await act(async () => tree.unmount());
});

describe('Video viewer bounds', () => {
  it.each([
    { width: 320, height: 568, top: 20, left: 0, right: 0 },
    { width: 402, height: 874, top: 62, left: 0, right: 0 },
    { width: 874, height: 402, top: 0, left: 62, right: 62 },
    { width: 1024, height: 1366, top: 24, left: 0, right: 0 },
  ])('keeps video between the header and playback row in $width × $height', async ({ width, height, top, left, right }) => {
    state.insets = { top, bottom: 34, left, right };
    const tree = await render({ width, height });
    const media = tree.root.findByType('ZoomableMedia' as any);
    const clippedFrame = media.parent!;
    const mediaContainer = clippedFrame.parent!;
    const controls = tree.root.findByType('Glass' as any);
    const mediaTop = mediaContainer.props.style.top;
    const mediaBottom = mediaTop + media.props.height;
    const controlsTop = height - controls.props.style.bottom - controls.props.style.minHeight;
    expect(mediaTop).toBeGreaterThanOrEqual(top + 52);
    expect(mediaBottom).toBeLessThan(controlsTop);
    expect(clippedFrame.props.style.overflow).toBe('hidden');
    expect(mediaContainer.props.style.left).toBe(left);
    expect(media.props.width).toBe(width - left - right);
    const video = tree.root.findByType('VideoView' as any);
    expect(video.props.contentFit).toBe('contain');
    expect(video.props.nativeControls).toBe(false);
    expect(video.props.fullscreenOptions).toEqual({ enable: true });
    expect(controls.props.interactive).toBe(true);
    expect(controls.props.tint).toBe('transparent');
    expect(controls.props.colorScheme).toBe('dark');
    expect(controls.props.style.backgroundColor).toBeUndefined();
  });

  it('hides native controls immediately without changing video size', async () => {
    const tree = await render();
    const before = tree.root.findByType('VideoView' as any).props.style;
    await act(async () => { tree.update(<VideoPage {...props} controlsVisible={false} />); });
    expect(tree.root.findAllByType('Glass' as any)).toHaveLength(0);
    expect(tree.root.findByType('VideoView' as any).props.style).toEqual(before);
    expect(state.player.replaceAsync).toHaveBeenCalledOnce();
  });

  it.each([90, 270] as const)('contains the video after rotating %s degrees', async rotation => {
    const tree = await render({ rotation });
    const media = tree.root.findByType('ZoomableMedia' as any);
    const video = tree.root.findByType('VideoView' as any);
    expect(video.props.style.width).toBe(media.props.height);
    expect(video.props.style.height).toBe(media.props.width);
    expect(video.props.style.transform).toEqual([{ rotate: `${rotation}deg` }]);
    expect(video.props.contentFit).toBe('contain');
  });
});


describe('Viewer chrome', () => {
  it('floats native navigation and actions separately from the photo strip', async () => {
    applyPalette(LIGHT);
    state.insets = { top: 0, bottom: 34, left: 62, right: 62 };
    let tree!: ReactTestRenderer;
    const close = vi.fn();
    await act(async () => {
      tree = create(<>
        <ViewerHeader visible width={874} insets={state.insets} title="Video.mp4" subtitle="Today" onClose={close} />
        <ViewerDock visible width={874} insets={state.insets} safeBottom={12}
          items={[]} current={0} onSelect={vi.fn()}><TextAction /></ViewerDock>
      </>);
    });
    mounted.push(tree);
    const materials = tree.root.findAllByType('Glass' as any);
    expect(materials).toHaveLength(1);
    const metadata = materials[0];
    expect(metadata.props.colorScheme).toBe('dark');
    const frame = metadata.parent!.parent!;
    expect(frame.props.style.width).toBe(560);
    const button = tree.root.findByType('ViewerAction' as any);
    expect(button.props.icon).toBe('back');
    button.props.onPress();
    expect(close).toHaveBeenCalledOnce();
    const text = metadata.findAllByType('Text' as any);
    expect(text[0].props.style.color).toBe(DARK.text);
    expect(text[1].props.style.color).toBe(DARK.muted);
  });
});

function TextAction() { return null; }
