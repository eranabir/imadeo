import { Bonjour } from 'bonjour-service';

const port = Number.parseInt(process.env.DISCOVERY_PORT ?? '6666', 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('DISCOVERY_PORT must be a valid TCP port.');
}

const bonjour = new Bonjour();
const service = bonjour.publish({
  name: process.env.IMADEO_DISCOVERY_NAME?.trim() || 'Imadeo',
  type: 'imadeo',
  protocol: 'tcp',
  port,
  txt: { path: '/api', version: process.env.IMADEO_VERSION ?? 'unknown' },
});

function stop() {
  service.stop(() => bonjour.destroy());
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
