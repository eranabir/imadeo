import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ gestures: [] as any[] }));
vi.mock('react-native-gesture-handler', () => {
  const gesture = (type: string) => {
    const value: any = { type, handlers: {}, options: {} };
    for (const name of ['enabled', 'minDistance', 'maxPointers', 'numberOfTaps', 'maxDuration'])
      value[name] = (option: any) => { value.options[name] = option; return value; };
    for (const name of ['onStart', 'onUpdate', 'onEnd', 'onFinalize'])
      value[name] = (fn: any) => { value.handlers[name] = fn; return value; };
    mocks.gestures.push(value); return value;
  };
  return { GestureDetector: (props: any) => React.createElement('GestureDetector', props, props.children),
    Gesture: { Pinch: () => gesture('pinch'), Pan: () => gesture('pan'), Tap: () => gesture('tap'),
      Simultaneous: (...items: any[]) => items, Exclusive: (...items: any[]) => items } };
});
vi.mock('react-native-reanimated', () => ({ default: { View: 'View' },
  clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)),
  runOnJS: (fn: any) => fn, withSpring: (v: number) => v,
  useSharedValue: (v: number) => React.useRef({ value: v }).current,
  useAnimatedStyle: (fn: any) => fn(),
}));
import { ZoomableMedia } from './ZoomableMedia';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });
const latest = (type: string) => mocks.gestures.filter(g => g.type === type).at(-1);
async function setup() {
  const swipe = vi.fn(), lock = vi.fn();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<ZoomableMedia width={400} height={700} onPageSwipe={swipe} onZoomChange={lock}><React.Fragment /></ZoomableMedia>); });
  mounted.push(tree);
  const doubleTap = mocks.gestures.filter(g => g.type === 'tap' && g.options.numberOfTaps === 2).at(-1);
  await act(async () => doubleTap.handlers.onEnd({ x: 200, y: 350 }, true));
  return { tree, swipe, lock };
}
describe('Zoomed image paging', () => {
  it.each([[-400, 1], [400, -1]])('changes page after a horizontal pull past the image edge', async (distance, direction) => {
    const h = await setup();
    const pan = latest('pan');
    expect(pan.options.enabled).toBe(true);
    expect(pan.options.maxPointers).toBe(1);
    await act(async () => { pan.handlers.onStart(); pan.handlers.onUpdate({ translationX: distance, translationY: 0 });
      pan.handlers.onEnd({ translationX: distance, translationY: 0 }); });
    expect(h.swipe).toHaveBeenCalledExactlyOnceWith(direction);
  });
  it('keeps ordinary panning and vertical gestures inside the enlarged photo', async () => {
    const h = await setup(), pan = latest('pan');
    for (const [x, y] of [[150, 0], [400, 600]]) {
      await act(async () => { pan.handlers.onStart(); pan.handlers.onUpdate({ translationX: x, translationY: y });
        pan.handlers.onEnd({ translationX: x, translationY: y }); });
    }
    expect(h.swipe).not.toHaveBeenCalled();
  });
  it('clears zoom and releases the pager when the photo becomes inactive', async () => {
    const h = await setup();
    expect(h.lock).toHaveBeenLastCalledWith(true);
    await act(async () => h.tree.update(<ZoomableMedia active={false} width={400} height={700} onPageSwipe={h.swipe} onZoomChange={h.lock}><React.Fragment /></ZoomableMedia>));
    await act(async () => h.tree.update(<ZoomableMedia width={400} height={700} onPageSwipe={h.swipe} onZoomChange={h.lock}><React.Fragment /></ZoomableMedia>));
    expect(h.lock).toHaveBeenLastCalledWith(false);
    expect(latest('pan').options.enabled).toBe(false);
  });
});
