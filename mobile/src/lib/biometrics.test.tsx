import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  state: 'active', listener: null as null | ((state: string) => void),
  authenticate: vi.fn(), hardware: vi.fn(), enrolled: vi.fn(), types: vi.fn(),
  get: vi.fn(), set: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: {
  get currentState() { return mocks.state; },
  addEventListener: (_: string, listener: (state: string) => void) => {
    mocks.listener = listener; return { remove: () => { mocks.listener = null; } };
  },
} }));
vi.mock('expo-local-authentication', () => ({
  authenticateAsync: mocks.authenticate, hasHardwareAsync: mocks.hardware,
  isEnrolledAsync: mocks.enrolled, supportedAuthenticationTypesAsync: mocks.types,
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
}));
vi.mock('./storage', () => ({ getItem: mocks.get, setItem: mocks.set }));
import { useBiometricLock } from './biometrics';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let tree: ReactTestRenderer;
let lock: ReturnType<typeof useBiometricLock>;
function Probe({ signedIn = true }: { signedIn?: boolean }) {
  lock = useBiometricLock(signedIn, false, 'nas'); return null;
}
async function render() { await act(async () => { tree = create(<Probe />); }); }
async function state(value: string) { await act(async () => { mocks.state = value; mocks.listener?.(value); }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.state = 'active';
  mocks.get.mockResolvedValue('true'); mocks.set.mockResolvedValue(undefined);
  mocks.authenticate.mockResolvedValue({ success: true }); mocks.hardware.mockResolvedValue(true);
  mocks.enrolled.mockResolvedValue(true); mocks.types.mockResolvedValue([2]);
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });
describe('optional biometric login lock', () => {
  it('keeps a restored saved login locked until biometric success', async () => {
    await render(); expect(lock.locked).toBe(true); expect(lock.label).toBe('Face ID');
    await act(async () => lock.unlock()); expect(lock.locked).toBe(false);
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.objectContaining({ disableDeviceFallback: true, biometricsSecurityLevel: 'strong' }));
  });
  it('accepts success while the native authentication dialog is still dismissing', async () => {
    await render(); await state('inactive');
    await act(async () => lock.unlock()); expect(lock.locked).toBe(false);
  });
  it('does not unlock when authentication is cancelled', async () => {
    mocks.authenticate.mockResolvedValue({ success: false, error: 'user_cancel' });
    await render(); await act(async () => lock.unlock()); expect(lock.locked).toBe(true);
    expect(lock.error).toContain('password');
  });
  it('locks again after backgrounding and rejects late authentication', async () => {
    await render(); await act(async () => lock.unlock()); await state('background');
    expect(lock.locked).toBe(true); await state('active');
    let resolve!: (result: { success: boolean }) => void;
    mocks.authenticate.mockImplementation(() => new Promise(done => { resolve = done; }));
    let operation!: Promise<void>;
    await act(async () => { operation = lock.unlock(); });
    await state('background'); await state('active');
    await act(async () => { resolve({ success: true }); await operation; });
    expect(lock.locked).toBe(true);
  });
  it('does not bypass an enabled lock when biometrics are no longer enrolled', async () => {
    mocks.enrolled.mockResolvedValue(false); await render();
    expect(lock.available).toBe(false); expect(lock.locked).toBe(true);
  });
  it('requires a successful match before enabling the option', async () => {
    mocks.get.mockResolvedValue(null); await render();
    mocks.authenticate.mockResolvedValue({ success: false });
    await act(async () => lock.setEnabled(true)); expect(mocks.set).not.toHaveBeenCalled();
    expect(lock.enabled).toBe(false);
    mocks.authenticate.mockResolvedValue({ success: true });
    await act(async () => lock.setEnabled(true)); expect(lock.enabled).toBe(true);
    expect(mocks.set).toHaveBeenCalledWith('imadeo.biometricLogin', 'true');
  });
  it('password sign-in unlocks the saved session', async () => {
    await render(); await act(async () => lock.passwordSignedIn()); expect(lock.locked).toBe(false);
  });
  it('fails closed when the stored preference cannot be read', async () => {
    mocks.get.mockRejectedValue(Error('Keychain unavailable')); await render();
    expect(lock.locked).toBe(true); expect(lock.error).toContain('password');
  });
});
