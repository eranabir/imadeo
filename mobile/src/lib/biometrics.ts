import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { getItem, setItem } from './storage';
import { STORAGE_KEYS } from './storageKeys';

export function useBiometricLock(signedIn: boolean, restoring: boolean, serverId?: string) {
  const [enabled, setEnabledState] = useState(false);
  const [available, setAvailable] = useState(false);
  const [label, setLabel] = useState('biometrics');
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epoch = useRef(0);
  const inFlight = useRef(false);

  const refreshCapabilities = useCallback(async () => {
    if (Platform.OS === 'web') return;
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    setAvailable(hardware && enrolled);
    setLabel(Platform.OS === 'ios'
      ? types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION) ? 'Face ID' : 'Touch ID'
      : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT) ? 'fingerprint' : 'biometrics');
  }, []);

  useEffect(() => {
    if (restoring) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        // Read the preference before capabilities: an unavailable sensor must
        // leave an enabled lock in place, with password sign-in as fallback.
        const saved = await getItem(STORAGE_KEYS.biometricLogin);
        if (!alive) return;
        setEnabledState(saved === 'true');
        await refreshCapabilities().catch(() => { if (alive) setAvailable(false); });
      } catch {
        // Fail closed if secure storage cannot be read.
        if (alive) { setEnabledState(true); setError('Biometric settings could not be read. Sign in with your password.'); }
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; epoch.current++; };
  }, [restoring, serverId, refreshCapabilities]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshCapabilities().catch(() => setAvailable(false));
      if (state !== 'background') return;
      epoch.current++;
      if (enabled && signedIn) setLocked(true);
    });
    return () => subscription.remove();
  }, [enabled, signedIn, refreshCapabilities]);
  useEffect(() => { epoch.current++; }, [signedIn]);
  useEffect(() => () => { epoch.current++; }, []);

  const authenticate = async () => {
    if (!available) throw new Error('Set up Face ID or fingerprint recognition in your device settings, or use your password.');
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Imadeo', cancelLabel: 'Cancel',
      disableDeviceFallback: true, biometricsSecurityLevel: 'strong',
    });
    if (!result.success) throw new Error('Not unlocked. Try again or sign in with your password.');
  };

  return {
    enabled, available, label, loading, busy, error,
    locked: enabled && signedIn && locked,
    passwordSignedIn: () => { epoch.current++; setLocked(false); setError(null); },
    unlock: async () => {
      if (inFlight.current) return;
      inFlight.current = true; setBusy(true); setError(null);
      const operation = epoch.current;
      try {
        await authenticate();
        if (operation === epoch.current && AppState.currentState !== 'background') setLocked(false);
      } catch (cause) {
        if (operation === epoch.current) setError(cause instanceof Error ? cause.message : 'Could not unlock Imadeo.');
      } finally { inFlight.current = false; setBusy(false); }
    },
    setEnabled: async (next: boolean) => {
      if (inFlight.current || !signedIn) return;
      inFlight.current = true; setBusy(true); setError(null);
      const operation = epoch.current;
      try {
        if (next) await authenticate();
        if (operation !== epoch.current) return;
        await setItem(STORAGE_KEYS.biometricLogin, String(next));
        if (operation !== epoch.current) return;
        setEnabledState(next); setLocked(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not update biometric sign-in.');
      } finally { inFlight.current = false; setBusy(false); }
    },
  };
}
