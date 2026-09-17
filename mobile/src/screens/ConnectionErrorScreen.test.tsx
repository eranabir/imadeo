import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View' }));
vi.mock('../components/Icon', () => ({ Icon: 'Icon' }));
vi.mock('../components/Logo', () => ({ Logo: 'Logo' }));
import { ConnectionErrorScreen } from './ConnectionErrorScreen';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Connection recovery navigation', () => {
  it('keeps editing and managing the saved server available during automatic retries', async () => {
    const retry = vi.fn(), edit = vi.fn(), manage = vi.fn();
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<ConnectionErrorScreen server={{ id: 'home', name: 'Home NAS', url: 'https://example.test', connectedVia: 'external', ssids: [], version: '1.0.0' }}
        retrying onRetry={retry} onEditServer={edit} onManageServers={manage} />);
    });
    try {
      const buttons = tree.root.findAllByType('Pressable' as any);
      expect(buttons[0].props.disabled).toBe(true);
      expect(buttons[1].props.disabled).not.toBe(true);
      expect(buttons[2].props.disabled).not.toBe(true);
      await act(async () => { buttons[1].props.onPress(); buttons[2].props.onPress(); });
      expect(edit).toHaveBeenCalledOnce();
      expect(manage).toHaveBeenCalledOnce();
      expect(retry).not.toHaveBeenCalled();
      expect(JSON.stringify(tree.toJSON())).toContain('Home NAS');
    } finally {
      await act(async () => tree.unmount());
    }
  });
});
