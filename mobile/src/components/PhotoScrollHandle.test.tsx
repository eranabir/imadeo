import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { PhotoScrollHandle } from './PhotoScrollHandle';

vi.mock('react-native', () => ({
  Animated: { Value: class { setValue() {} }, View: 'Handle' },
  PanResponder: { create: (handlers: object) => ({ panHandlers: handlers }) },
  View: 'View',
}));
vi.mock('../theme', () => ({ colors: {}, shadow: () => ({}) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ right: 0, bottom: 34 }) }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
afterEach(async () => { await act(async () => tree.unmount()); });

it('drags from the current offset to both ends of the measured list', async () => {
  const seek = vi.fn();
  const scroll = { addListener: vi.fn(), removeListener: vi.fn(), interpolate: vi.fn() };
  const viewport = 800, content = 50000;
  await act(async () => {
    tree = create(<PhotoScrollHandle scrollY={scroll as any} viewport={viewport} content={content}
      topInset={100} onSeek={seek} />);
  });
  const handle = tree.root.findByType('Handle' as any);
  const onScroll = scroll.addListener.mock.calls[0][0];
  const max = content - viewport;
  onScroll({ value: max / 2 });
  await act(async () => {
    handle.props.onPanResponderGrant();
    handle.props.onPanResponderMove(null, { dy: 0 });
    handle.props.onPanResponderRelease(null, { dy: viewport });
  });
  expect(seek.mock.calls).toEqual([[max / 2], [max]]);
  onScroll({ value: max });
  await act(async () => {
    handle.props.onPanResponderGrant();
    handle.props.onPanResponderRelease(null, { dy: -viewport });
  });
  expect(seek).toHaveBeenLastCalledWith(0);
});
