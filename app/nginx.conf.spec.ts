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

  it('keeps every startup script compatible with the strict CSP', () => {
    const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script(?<attributes>[^>]*)>/g)];

    expect(scripts).not.toHaveLength(0);
    expect(scripts.every((script) => /\bsrc=/.test(script.groups?.attributes ?? ''))).toBe(true);
    expect(html).toContain('<script src="/theme-init.js"></script>');
  });
});
