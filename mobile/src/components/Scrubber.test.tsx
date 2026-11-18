import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ responders: [] as any[] }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }, View: 'View', Text: 'Text',
  PanResponder: { create: (callbacks: any) => { mocks.responders.push(callbacks); return { panHandlers: { responder: callbacks } }; } },
  Animated: { View: 'AnimatedView', Value: class {
    value: number; listeners = new Map();
    constructor(value: number) { this.value = value; }
    setValue(value: number) { this.value = value; this.listeners.forEach(fn => fn({ value })); }
    addListener(fn: any) { this.listeners.set('listener', fn); return 'listener'; }
    removeListener(id: string) { this.listeners.delete(id); }
    interpolate(options: any) { return options; }
  }, timing: () => ({ start() {}, stop() {} }) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ right: 0 }) }));
import { Animated } from 'react-native';
import { Scrubber } from './Scrubber';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });

describe('Scroll handle gestures', () => {
  it('retains the same responder and finger position when a page changes the extent', async () => {
    const scrollY = new Animated.Value(2_300);
    const seek = vi.fn(), drag = vi.fn();
    let props = { scrollY, contentHeight: 10_000, viewportHeight: 800, topInset: 100,
      visible: true, onSeek: seek, onDrag: drag };
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<Scrubber {...props} />); });
    mounted.push(tree);
    const responder = mocks.responders.at(-1);
    // Native scroll notifications supply the starting offset.
    await act(async () => scrollY.setValue(2_300));
    await act(async () => responder.onPanResponderGrant());
    const thumb = () => tree.root.findByType('AnimatedView' as any);
    const start = thumb().props.style.transform[0].translateY.value;
    props = { ...props, contentHeight: 20_000 };
    await act(async () => tree.update(<Scrubber {...props} />));
    expect(mocks.responders.at(-1)).toBe(responder);
    expect(thumb().props.style.transform[0].translateY.value).toBe(start);
    await act(async () => responder.onPanResponderMove(null, { dy: 50 }));
    const rail = tree.root.findAllByType('View' as any)[0].props.style;
    const handle = thumb().props.style;
    expect(rail.width).toBeGreaterThanOrEqual(handle.width + handle.right);
    const runway = rail.height - handle.height;
    expect(seek).toHaveBeenLastCalledWith(((start + 50) / runway) * 19_200);
    expect(responder.onPanResponderTerminationRequest()).toBe(false);
    await act(async () => responder.onPanResponderRelease());
    expect(drag.mock.calls.map(call => call[0])).toEqual([true, false]);
  });
});
