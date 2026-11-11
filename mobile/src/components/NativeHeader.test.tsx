import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ push: vi.fn(), regular: false, right: 84 }));
vi.mock('../lib/deviceLayout', () => ({ get isRegularIPhone() { return mocks.regular; } }));
vi.mock('expo-router/react-navigation', () => ({ HeaderHeightContext: React.createContext(44), useTheme: () => ({ colors: { background: 'background', text: 'text' } }) }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Platform: { OS: 'ios' } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: mocks.right, bottom: 0 }) }));
vi.mock('expo-router', () => {
  const Toolbar = Object.assign((props: any) => React.createElement('NativeToolbar', props, props.children), {
    Button: (props: any) => React.createElement('NativeButton', props, props.children),
    Menu: (props: any) => React.createElement('NativeMenu', props, props.children),
    MenuAction: (props: any) => React.createElement('NativeMenuAction', props, props.children),
    Label: (props: any) => React.createElement('NativeLabel', props, props.children),
  });
  return { Stack: { Screen: (props: any) => React.createElement('ScreenOptions', props), Toolbar }, useRouter: () => ({ push: mocks.push }) };
});
import { NativeHeader } from './NativeHeader';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
const Action = (_: any) => null;
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); vi.clearAllMocks(); mocks.regular = false; mocks.right = 84; });
async function render(props: React.ComponentProps<typeof NativeHeader>) {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<NativeHeader {...props} />); }); mounted.push(tree); return tree;
}
describe('native navigation actions', () => {
  it('keeps nested folder actions and their handlers available as native buttons', async () => {
    const add = vi.fn(), list = vi.fn();
    const tree = await render({ title: 'Browse', actionType: Action, account: <React.Fragment />,
      action: <React.Fragment><Action icon="list" label="Show as list" onPress={list} /><React.Fragment>
        <Action icon="plus" label="New" onPress={add} /></React.Fragment></React.Fragment> });
    expect(tree.root.findAllByType('NativeButton' as any)).toHaveLength(0);
    expect(tree.root.findAllByType('NativeMenu' as any)).toHaveLength(1);
    const buttons = tree.root.findAllByType('NativeMenuAction' as any);
    expect(buttons.map(b => b.props.children)).toEqual(['Show as list', 'New', 'Account']);
    buttons[0].props.onPress(); buttons[1].props.onPress(); buttons[2].props.onPress();
    expect(list).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledOnce(); expect(mocks.push).toHaveBeenCalledWith('/account');
    expect(buttons.map(b => b.props.icon)).toEqual(['list.bullet', 'plus', 'person.crop.circle']);
  });
  it('keeps direct action buttons when navigation is along the bottom', async () => {
    mocks.right = 0;
    const tree = await render({ title: 'Library', actionType: Action, account: <React.Fragment />,
      action: <Action icon="backup" label="Back up" onPress={vi.fn()} /> });
    expect(tree.root.findAllByType('NativeMenu' as any)).toHaveLength(0);
    expect(tree.root.findAllByType('NativeButton' as any).map(b => b.props.children)).toEqual(['Back up', 'Account']);
  });
  it('preserves the detail-screen back handler and search content outside the toolbar', async () => {
    const back = vi.fn();
    const tree = await render({ title: 'Album', actionType: Action, onBack: back,
      children: React.createElement('SearchInput') });
    tree.root.findByType('NativeButton' as any).props.onPress();
    expect(back).toHaveBeenCalledOnce();
    expect(tree.root.findAllByType('Text' as any).some(text => text.props.children === 'Album')).toBe(true);
    expect(tree.root.findByType('SearchInput' as any)).toBeTruthy();
    expect(tree.root.findAllByType('NativeToolbar' as any).flatMap(toolbar => toolbar.findAllByType('SearchInput' as any))).toHaveLength(0);
    expect(tree.root.findByType('ScreenOptions' as any).props.options.headerShown).toBe(true);
  });
  it('aligns a regular iPhone heading with its toolbar without moving the Duo heading', async () => {
    const duo = await render({ title: 'Library', actionType: Action });
    const duoHeading = duo.root.findByType('Text' as any).parent!;
    expect(duoHeading.props.style.height).toBe(56);
    expect(duoHeading.parent!.props.style.paddingTop).toBe(44);
    mocks.regular = true;
    const phone = await render({ title: 'Library', actionType: Action });
    const phoneHeading = phone.root.findByType('Text' as any).parent!;
    expect(phoneHeading.props.style.height).toBe(44);
    expect(phoneHeading.parent!.props.style.paddingTop).toBe(0);
  });
});
