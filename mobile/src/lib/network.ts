import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

function ssidFrom(state: Awaited<ReturnType<typeof NetInfo.fetch>>): string | null {
  const ssid = (state.details as { ssid?: string | null } | null)?.ssid?.trim();
  return ssid || null;
}

/** Reads the current network name without prompting. It can be unavailable by design. */
export async function currentSsid(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return ssidFrom(await NetInfo.fetch());
  } catch {
    return null;
  }
}

/** Updates the selected server while the app is open and the phone changes Wi-Fi. */
export function subscribeToSsid(onChange: (ssid: string | null) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  return NetInfo.addEventListener((state) => onChange(ssidFrom(state)));
}

/**
 * Asks only when the person taps "Use current Wi-Fi". Android and iOS require
 * foreground location access before they expose an SSID to an app.
 */
export async function requestCurrentSsid(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') return null;
  return currentSsid();
}
