import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ options: vi.fn(), remove: vi.fn(), alert: vi.fn() }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' }, Alert: { alert: mock.alert } }));
vi.mock('../lib/api', () => ({ ApiError: class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } } }));
vi.mock('../lib/accountDeletion', () => ({ accountDeletionOptions: mock.options, deleteOwnAccount: mock.remove }));
vi.mock('./ui', () => ({
  Sheet: ({ open, children, footer, ...props }: any) => open ? React.createElement('Sheet', props, children, footer) : null,
  Button: 'Button', SheetRow: 'SheetRow',
}));
import { DeleteAccountSheet } from './DeleteAccountSheet';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: ReactTestRenderer[] = [];
const options = { gracePeriodDays: 30, hasPassword: true, requiresSuccessor: false, willEmptyServer: false, leavesServerWithoutAdmin: false, successors: [] };
beforeEach(() => {
  vi.resetAllMocks();
  mock.options.mockResolvedValue(options);
  mock.remove.mockResolvedValue({ gracePeriodDays: 30 });
});
afterEach(async () => { for (const tree of mounted.splice(0)) await act(async () => tree.unmount()); });
async function render() {
  const props = { open: true, serverUrl: 'https://server', email: 'owner@example.com', onClose: vi.fn(), onDeleted: vi.fn() };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<DeleteAccountSheet {...props} />); });
  mounted.push(tree);
  const button = () => tree.root.findAllByType('Button' as any).find(node => node.props.variant === 'danger')!;
  const type = async (label: string, value: string) => {
    const input = tree.root.findAllByType('TextInput' as any).find(node => node.props.accessibilityLabel === label)!;
    await act(async () => input.props.onChangeText(value));
  };
  return { tree, props, button, type };
}
describe('account deletion confirmation', () => {
  it('requires matching account email and current password before enabling deletion', async () => {
    const view = await render();
    expect(view.button().props.disabled).toBe(true);
    await view.type('Account email confirmation', 'other@example.com');
    await view.type('Current password', 'current-password');
    expect(view.button().props.disabled).toBe(true);
    await view.type('Account email confirmation', ' OWNER@example.com ');
    expect(view.button().props.disabled).toBe(false);
    await act(async () => view.button().props.onPress());
    expect(mock.remove).toHaveBeenCalledExactlyOnceWith('https://server', {
      confirmationEmail: 'OWNER@example.com', currentPassword: 'current-password',
    });
    expect(view.props.onDeleted).toHaveBeenCalledOnce();
    expect(mock.alert).toHaveBeenCalledWith('Account deletion requested', expect.stringContaining('30 days'));
  });
  it('requires an explicit successor when deleting the last administrator', async () => {
    mock.options.mockResolvedValue({ ...options, requiresSuccessor: true,
      successors: [{ id: 'member-id', name: 'Member', email: 'member@example.com' }] });
    const view = await render();
    await view.type('Account email confirmation', 'owner@example.com');
    await view.type('Current password', 'current-password');
    expect(view.button().props.disabled).toBe(true);
    await act(async () => view.tree.root.findByType('SheetRow' as any).props.onPress());
    expect(view.button().props.disabled).toBe(false);
    await act(async () => view.button().props.onPress());
    expect(mock.remove.mock.calls[0][1].successorId).toBe('member-id');
  });
  it('allows passwordless confirmation without fabricating a password', async () => {
    mock.options.mockResolvedValue({ ...options, hasPassword: false, willEmptyServer: true });
    const view = await render();
    expect(view.tree.root.findAllByType('TextInput' as any)).toHaveLength(1);
    await view.type('Account email confirmation', 'owner@example.com');
    await act(async () => view.button().props.onPress());
    expect(mock.remove).toHaveBeenCalledWith('https://server', { confirmationEmail: 'owner@example.com' });
  });
  it('requires explicit acknowledgement when disabled accounts prevent automatic setup', async () => {
    mock.options.mockResolvedValue({ ...options, leavesServerWithoutAdmin: true });
    const view = await render();
    await view.type('Account email confirmation', 'owner@example.com');
    await view.type('Current password', 'current-password');
    expect(view.button().props.disabled).toBe(true);
    await act(async () => view.tree.root.findByType('SheetRow' as any).props.onPress());
    expect(view.button().props.disabled).toBe(false);
    await act(async () => view.button().props.onPress());
    expect(mock.remove.mock.calls[0][1].acknowledgeServerLockout).toBe(true);
  });
  it('does not sign out or claim success when the server rejects deletion', async () => {
    mock.remove.mockRejectedValue(new Error('Current password is incorrect.'));
    const view = await render();
    await view.type('Account email confirmation', 'owner@example.com');
    await view.type('Current password', 'wrong-password');
    await act(async () => view.button().props.onPress());
    expect(view.props.onDeleted).not.toHaveBeenCalled();
    expect(mock.alert).not.toHaveBeenCalled();
    expect(view.tree.root.findAllByType('Text' as any).some(node => node.props.children === 'Current password is incorrect.')).toBe(true);
  });
  it('keeps older-server errors visible with deletion disabled', async () => {
    mock.options.mockRejectedValue(new Error('Update your Imadeo server, then try again.'));
    const view = await render();
    expect(view.button().props.disabled).toBe(true);
    expect(view.tree.root.findAllByType('Text' as any).some(node => String(node.props.children).includes('Update your Imadeo server'))).toBe(true);
    expect(mock.remove).not.toHaveBeenCalled();
  });
  it('ignores duplicate presses and cancellation while deletion is in flight', async () => {
    let finish!: (value: unknown) => void;
    mock.remove.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = await render();
    await view.type('Account email confirmation', 'owner@example.com');
    await view.type('Current password', 'current-password');
    await act(async () => { view.button().props.onPress(); view.button().props.onPress(); });
    expect(mock.remove).toHaveBeenCalledOnce();
    await act(async () => view.tree.root.findByType('Sheet' as any).props.onClose());
    expect(view.props.onClose).not.toHaveBeenCalled();
    await act(async () => finish({ gracePeriodDays: 30 }));
    expect(view.props.onDeleted).toHaveBeenCalledOnce();
  });
});
