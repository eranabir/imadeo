import { Platform } from 'react-native';
import Zeroconf from 'react-native-zeroconf';

export interface DiscoveredServer {
  name: string;
  url: string;
}

interface ZeroconfService {
  name?: string;
  host?: string;
  addresses?: string[];
  port?: number;
}

function serviceHost(service: ZeroconfService) {
  const addresses = service.addresses ?? [];
  // iOS commonly returns link-local IPv6 before the LAN IPv4 address. Link-local
  // addresses include an interface scope and do not make a portable server URL,
  // so prefer a usable IPv4 address whenever one was advertised.
  const host = addresses.find((address) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address))
    ?? addresses.find((address) => Boolean(address))
    ?? service.host;
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
  const zeroconf = new Zeroconf();
  const resolved = (service: ZeroconfService) => {
    const host = serviceHost(service);
    if (!host || !service.port) return;
    onServer({ name: service.name || host, url: `http://${host}:${service.port}` });
  };
  const failed = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause || 'Local discovery failed.');
    onError?.(message);
  };
  zeroconf.on('resolved', resolved);
  zeroconf.on('error', failed);
  zeroconf.scan('imadeo', 'tcp', 'local.');
  return () => {
    zeroconf.removeListener('resolved', resolved);
    zeroconf.removeListener('error', failed);
    zeroconf.stop();
  };
}
