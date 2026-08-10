import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certDirectory = resolve(root, '.dev/certs');
const key = resolve(certDirectory, 'localhost-key.pem');
const certificate = resolve(certDirectory, 'localhost.pem');

if (existsSync(key) && existsSync(certificate)) process.exit(0);

mkdirSync(certDirectory, { recursive: true });

const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((network) => network?.family === 'IPv4' && !network.internal)
  .map((network) => network.address);
const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
  keyType: 'rsa',
  keySize: 2048,
  algorithm: 'sha256',
  notAfterDate: new Date(Date.now() + 825 * 86_400_000),
  extensions: [
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
        ...addresses.map((ip) => ({ type: 7, ip })),
      ],
    },
  ],
});

writeFileSync(key, pems.private, { mode: 0o600 });
writeFileSync(certificate, pems.cert);

console.log('Created local HTTPS certificate at .dev/certs/localhost.pem');
