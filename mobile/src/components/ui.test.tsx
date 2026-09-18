import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dimensions: { width: 402, height: 874, fontScale: 1, scale: 3 },
  keyboard: new Map<string, (event: any) => void>(),
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', Pressable: 'Pressable',
  ScrollView: 'ScrollView', Text: 'Text', View: 'View', Platform: { OS: 'ios' },
  useWindowDimensions: () => mocks.dimensions,
  PanResponder: { create: () => ({ panHandlers: {} }) },
  Easing: { out: () => undefined, in: () => undefined },
  Animated: {
    View: 'AnimatedView',
    Value: class { setValue() {} interpolate() { return 0; } },
    timing: () => ({ start: (callback: any) => callback?.({ finished: true }), stop() {} }),
  },
  Keyboard: {
    scheduleLayoutAnimation: vi.fn(),
    addListener: (name: string, callback: (event: any) => void) => {
      mocks.keyboard.set(name, callback);
      return { remove: () => mocks.keyboard.delete(name) };
    },
  },
}));
vi.mock('react-native-safe-area-context', () => ({ initialWindowMetrics: { insets: { bottom: 34 } } }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('./Icon', () => ({ Icon: 'Icon' }));
import { Button, Sheet } from './ui';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(element); });
  mounted.push(tree); return tree;
}
beforeEach(() => { mocks.dimensions = { width: 402, height: 874, fontScale: 1, scale: 3 }; });
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });

describe('Sheet layout safety', () => {
  it('centres button labels within a consistent minimum touch target', async () => {
    const tree = await render(<Button label="Remove" variant="danger" onPress={vi.fn()} />);
    const label = tree.root.findByType('Text' as any);
    expect(label.props.style.textAlign).toBe('center');
    expect(label.props.style.flexShrink).toBe(1);
    expect(label.parent?.props.style.minHeight).toBe(52);
  });
  it.each([[320, 568, 3.5], [402, 874, 1], [1024, 1366, 2]])(
    'keeps all copy scrollable and the footer separate at %s×%s and scale %s', async (width, height, fontScale) => {
      mocks.dimensions = { width, height, fontScale, scale: 3 };
      const tree = await render(<Sheet open title="Remove?" description="A long warning" onClose={vi.fn()}
        footer={<Button label="Cancel" onPress={vi.fn()} />}>{null}</Sheet>);
      const scroll = tree.root.findByType('ScrollView' as any);
      expect(scroll.findAllByType('Text' as any).map(n => n.props.children)).toEqual(['Remove?', 'A long warning']);
      expect(scroll.findAllByType(Button)).toHaveLength(0);
      expect(scroll.props.style.flexShrink).toBe(1);
      const footer = tree.root.findByType(Button).parent!;
      expect(footer.props.style.flexShrink).toBe(0);
      const panel = tree.root.findAllByType('AnimatedView' as any).find(n => Array.isArray(n.props.style))!;
      expect(panel.props.style[0].maxHeight).toBe(height * 0.85);
      expect(panel.props.style[0].paddingBottom).toBe(34);
    },
  );
  it('retains clearance for the keyboard and restores the home-indicator inset', async () => {
    const tree = await render(<Sheet open title="Name" onClose={vi.fn()} footer={<Button label="Save" onPress={vi.fn()} />}>
      <React.Fragment>Field</React.Fragment>
    </Sheet>);
    const panel = () => tree.root.findAllByType('AnimatedView' as any).find(n => Array.isArray(n.props.style))!;
    await act(async () => mocks.keyboard.get('keyboardWillChangeFrame')!({ endCoordinates: { height: 319 } }));
    expect(panel().props.style[0].paddingBottom).toBe(331);
    await act(async () => mocks.keyboard.get('keyboardWillHide')!({}));
    expect(panel().props.style[0].paddingBottom).toBe(34);
  });
});
