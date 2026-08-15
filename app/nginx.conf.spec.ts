import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production upload proxy', () => {
  it('streams uploads without the default 60-second gateway timeout', () => {
    const config = readFileSync(new URL('./nginx.conf', import.meta.url), 'utf8');
    const uploadLocation = config.match(
      /location = \/api\/assets\/upload \{(?<directives>[\s\S]*?)\n  \}/,
    )?.groups?.directives;

    expect(uploadLocation).toContain('proxy_request_buffering off;');
    expect(uploadLocation).toContain('proxy_read_timeout 1h;');
    expect(uploadLocation).toContain('proxy_send_timeout 1h;');
    expect(uploadLocation).toContain('client_body_timeout 1h;');
  });
});
