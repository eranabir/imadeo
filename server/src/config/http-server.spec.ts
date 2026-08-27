import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { allowLongRunningUploads } from './http-server';

describe('HTTP server upload timeout', () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(() => {
    for (const server of servers) server.close();
    servers.length = 0;
  });

  it('does not terminate an active large upload after Node’s default five minutes', () => {
    const server = createServer();
    servers.push(server);
    expect(server.requestTimeout).toBe(300_000);

    allowLongRunningUploads(server);

    expect(server.requestTimeout).toBe(0);
    expect(server.headersTimeout).toBe(60_000);
  });
});
