import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

type SsidListener = (ssid: string | null) => void;

export type SsidLookupIssue =
  | 'permission-denied'
  | 'precise-location-required'
  | 'location-disabled'
  | 'unavailable';

export interface SsidLookupResult {
  ssid: string | null;
  issue?: SsidLookupIssue;
  canOpenSettings?: boolean;
}

const listeners = new Set<SsidListener>();
let nativeUnsubscribe: (() => void) | null = null;
let ssidLookupEnabled = false;

function ssidFrom(state: Awaited<ReturnType<typeof NetInfo.fetch>>): string | null {
  const ssid = (state.details as { ssid?: string | null } | null)?.ssid?.trim();
  if (!ssid || ssid === '<unknown ssid>') return null;
  return ssid;
}

function startNativeSubscription() {
  if (nativeUnsubscribe || listeners.size === 0) return;
  nativeUnsubscribe = NetInfo.addEventListener((state) => {
    const ssid = ssidFrom(state);
    listeners.forEach((listener) => listener(ssid));
  });
}

/**
 * NetInfo deliberately leaves SSID reads disabled on iOS. Enable them only
 * after location access is granted, then rebuild our shared subscription
 * because `configure` replaces NetInfo's global state and its listeners.
 */
function enableSsidLookup() {
  if (Platform.OS !== 'ios' || ssidLookupEnabled) return;
  nativeUnsubscribe?.();
  nativeUnsubscribe = null;
  NetInfo.configure({ shouldFetchWiFiSSID: true });
  ssidLookupEnabled = true;
  startNativeSubscription();
}

async function refreshSsid(): Promise<string | null> {
  // Asking for the Wi-Fi interface bypasses NetInfo's cached global state and
  // calls iOS' current-network API. The permission result can take a moment to
  // reach that API after the system sheet closes, so retry briefly.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await NetInfo.fetch('wifi');
    const ssid = ssidFrom(state);
    if (ssid) return ssid;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/** Reads the current network name without prompting. It can be unavailable by design. */
export async function currentSsid(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    if (Platform.OS === 'ios') {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') return null;
      enableSsidLookup();
    }
    return refreshSsid();
  } catch {
    return null;
  }
}

/** Updates the selected server while the app is open and the phone changes Wi-Fi. */
export function subscribeToSsid(onChange: (ssid: string | null) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  listeners.add(onChange);
  startNativeSubscription();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      nativeUnsubscribe?.();
      nativeUnsubscribe = null;
    }
  };
}

/**
 * Requests the current Wi-Fi for automatic selection or a manual retry.
 * Android and iOS require precise foreground location access for the SSID.
 */
export async function requestCurrentSsid(): Promise<SsidLookupResult> {
  if (Platform.OS === 'web') return { ssid: null, issue: 'unavailable' };
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      return { ssid: null, issue: 'location-disabled', canOpenSettings: true };
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      return {
        ssid: null,
        issue: 'permission-denied',
        canOpenSettings: permission.canAskAgain === false,
      };
    }
    if (
      (Platform.OS === 'ios' && permission.ios?.accuracy === 'reduced') ||
      (Platform.OS === 'android' && permission.android?.accuracy !== 'fine')
    ) {
      return { ssid: null, issue: 'precise-location-required', canOpenSettings: true };
    }
    enableSsidLookup();
    const ssid = await refreshSsid();
    return ssid ? { ssid } : { ssid: null, issue: 'unavailable' };
  } catch {
    return { ssid: null, issue: 'unavailable' };
  }
}
