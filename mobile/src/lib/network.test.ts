import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ net: null as null | ((s: any) => void), foreground: null as null | ((s: string) => void), refresh: vi.fn(async () => ({})), off: vi.fn() }));
vi.mock('@react-native-community/netinfo', () => ({ default: {
  addEventListener: (cb: any) => { mocks.net = cb; return mocks.off; },
  refresh: mocks.refresh, fetch: vi.fn(), configure: vi.fn(),
} }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: {
  addEventListener: (_: string, cb: any) => { mocks.foreground = cb; return { remove: mocks.off }; },
} }));
vi.mock('expo-location', () => ({ getForegroundPermissionsAsync: vi.fn(async () => ({ status: 'denied' })) }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
describe('network recovery without SSID access', () => {
  it('detects Wi-Fi to cellular and home Wi-Fi transitions with no network name', async () => {
    const { subscribeToNetwork } = await import('./network'); const change = vi.fn();
    const stop = subscribeToNetwork(change);
    mocks.net!({ type: 'wifi', isConnected: true, details: {} });
    mocks.net!({ type: 'cellular', isConnected: true, details: {} });
    mocks.net!({ type: 'wifi', isConnected: true, details: {} });
    expect(change).toHaveBeenCalledTimes(3);
    mocks.net!({ type: 'wifi', isConnected: true, details: {} });
    expect(change).toHaveBeenCalledTimes(3); stop();
  });
  it('rechecks on foreground even when iOS missed background network events', async () => {
    const { subscribeToNetwork } = await import('./network'); const change = vi.fn();
    const stop = subscribeToNetwork(change); mocks.foreground!('background');
    expect(change).not.toHaveBeenCalled(); mocks.foreground!('active');
    expect(change).toHaveBeenCalledOnce(); expect(mocks.refresh).toHaveBeenCalledOnce(); stop();
  });
});
