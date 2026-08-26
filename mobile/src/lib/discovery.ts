import { Platform } from 'react-native';
import Zeroconf from 'react-native-zeroconf';

export interface DiscoveredServer {
  name: string;
  url: string;
}

/** Finds Imadeo installations advertised over Bonjour on the current LAN. */
export function discoverServers(onServer: (server: DiscoveredServer) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const zeroconf = new Zeroconf();
  const resolved = (service: { name?: string; host?: string; addresses?: string[]; port?: number }) => {
    const host = service.addresses?.find(Boolean) ?? service.host;
    if (!host || !service.port) return;
    onServer({ name: service.name || host, url: `http://${host}:${service.port}` });
  };
  zeroconf.on('resolved', resolved);
  zeroconf.scan('imadeo', 'tcp', 'local.');
  return () => {
    zeroconf.removeListener('resolved', resolved);
    zeroconf.stop();
  };
}
