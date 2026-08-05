import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// The Prisma CLI does not read .env by itself in v7. Load the workspace file
// first, then the shared one at the repository root, without overwriting
// anything already set in the real environment (which is how Docker runs).
for (const file of ['.env', '../.env']) {
  const path = resolve(__dirname, file);
  if (existsSync(path)) loadEnv({ path, override: false });
}

/**
 * Prisma 7 moved the datasource URL out of `schema.prisma`. The CLI (migrate,
 * studio, db push) reads it from here; the application itself connects through
 * the `@prisma/adapter-pg` driver adapter in `src/infra/prisma/prisma.service.ts`.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
});
