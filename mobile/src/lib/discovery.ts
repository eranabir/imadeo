import { Platform } from 'react-native';
import * as ServiceDiscovery from '@inthepocket/react-native-service-discovery';
import type { Service } from '@inthepocket/react-native-service-discovery';
import * as Network from 'expo-network';

export interface DiscoveredServer {
  name: string;
  url: string;
}

const MAX_TRANSIENT_RETRIES = 2;
const SUBNET_SCAN_DELAY_MS = 1_200;
const LOCAL_PROBE_TIMEOUT_MS = 700;
const LOCAL_PROBE_CONCURRENCY = 48;
const IMADEO_PORTS = [1111, 6666] as const;

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

function privateIpv4(value: string) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  const [first, second] = parts;
  if (
    first !== 10 &&
    !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && second === 168)
  ) return null;
  return parts;
}

async function probeLocalServer(
  host: string,
  port: number,
  controllers: Set<AbortController>,
): Promise<DiscoveredServer | null> {
  const controller = new AbortController();
  controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), LOCAL_PROBE_TIMEOUT_MS);
  const url = `http://${host}:${port}`;
  try {
    const response = await fetch(`${url}/api`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    if (typeof body?.message !== 'string' || !body.message.includes('Imadeo')) return null;
    return { name: 'Imadeo', url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controllers.delete(controller);
  }
}

/**
 * Recent iOS simulators can deny Bonjour browsing even when the app is
 * configured correctly. Probe only the phone's current private /24 so local
 * discovery still works there and on networks where multicast is filtered.
 */
async function scanLocalSubnet(
  onServer: (server: DiscoveredServer) => void,
  isStopped: () => boolean,
  controllers: Set<AbortController>,
) {
  const ownAddress = await Network.getIpAddressAsync().catch(() => '0.0.0.0');
  const parts = privateIpv4(ownAddress);
  if (!parts || isStopped()) return;
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
  const ownHost = parts[3];
  let nextHost = 1;

  const worker = async () => {
    while (!isStopped()) {
      const hostNumber = nextHost;
      nextHost += 1;
      if (hostNumber > 254) return;
      if (hostNumber === ownHost) continue;
      const host = `${prefix}.${hostNumber}`;
      const results = await Promise.all(
        IMADEO_PORTS.map((port) => probeLocalServer(host, port, controllers)),
      );
      if (isStopped()) return;
      results.forEach((server) => {
        if (server) onServer(server);
      });
    }
  };

  await Promise.all(Array.from({ length: LOCAL_PROBE_CONCURRENCY }, worker));
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
  let subnetTimer: ReturnType<typeof setTimeout> | null = null;
  const probeControllers = new Set<AbortController>();

  const resolved = (service: Service) => {
    const host = serviceHost(service);
    if (!host || !service.port) return;
    retryCount = 0;
    if (subnetTimer) clearTimeout(subnetTimer);
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
  subnetTimer = setTimeout(() => {
    void scanLocalSubnet(onServer, () => stopped, probeControllers);
  }, SUBNET_SCAN_DELAY_MS);

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (subnetTimer) clearTimeout(subnetTimer);
    probeControllers.forEach((controller) => controller.abort());
    probeControllers.clear();
    foundSubscription.remove();
    void ServiceDiscovery.stopSearch('imadeo').catch(() => undefined);
  };
}
