import { Platform } from 'react-native';
import * as ServiceDiscovery from '@inthepocket/react-native-service-discovery';
import type { Service } from '@inthepocket/react-native-service-discovery';

export interface DiscoveredServer {
  name: string;
  url: string;
}

const MAX_TRANSIENT_RETRIES = 2;

function discoveryErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause || 'Local discovery failed.');
}

function isPermissionError(message: string) {
  return /(?:-72008|polic(?:y|ies).*denied|permission.*denied|not authorized)/i.test(message);
}

function serviceHost(service: Service) {
  const addresses = service.addresses ?? [];
  // iOS commonly returns link-local IPv6 before the LAN IPv4 address. Link-local
  // addresses include an interface scope and do not make a portable server URL,
  // so prefer a usable IPv4 address whenever one was advertised.
  const host = addresses.find((address) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address))
    ?? addresses.find((address) => Boolean(address))
    ?? service.hostName;
  if (!host) return null;
  const withoutScope = host.replace(/%.+$/, '');
  return withoutScope.includes(':') ? `[${withoutScope}]` : withoutScope.replace(/\.$/, '');
}

/** Finds Imadeo installations advertised over Bonjour on the current LAN. */
export function discoverServers(
  onServer: (server: DiscoveredServer) => void,
  onError?: (message: string) => void,
): () => void {
  if (Platform.OS === 'web') return () => undefined;
  let stopped = false;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const resolved = (service: Service) => {
    const host = serviceHost(service);
    if (!host || !service.port) return;
    retryCount = 0;
    onServer({ name: service.name || host, url: `http://${host}:${service.port}` });
  };

  const scan = async () => {
    if (stopped) return;
    try {
      await ServiceDiscovery.startSearch('imadeo');
    } catch (cause) {
      failed(cause);
    }
  };

  const failed = (cause: unknown) => {
    if (stopped) return;
    const message = discoveryErrorMessage(cause);

    // Retry transient browser start failures, but do not turn a single mDNS
    // hiccup into a permanent unavailable state.
    if (!isPermissionError(message) && retryCount < MAX_TRANSIENT_RETRIES) {
      retryCount += 1;
      void ServiceDiscovery.stopSearch('imadeo')
        .catch(() => undefined)
        .finally(() => {
          if (!stopped) retryTimer = setTimeout(() => void scan(), 500);
        });
      return;
    }

    // Only a denied local-network permission makes discovery truly unavailable.
    // Other failures fall through to the normal "No server found" state, where
    // the user can retry without being told discovery itself is disabled.
    if (isPermissionError(message)) onError?.(message);
  };

  const foundSubscription = ServiceDiscovery.addEventListener('serviceFound', resolved);
  void scan();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    foundSubscription.remove();
    void ServiceDiscovery.stopSearch('imadeo').catch(() => undefined);
  };
}
