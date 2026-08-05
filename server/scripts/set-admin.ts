// Points the existing administrator account at a different email and password.
//
// Deliberately an update rather than a new account: every folder, album and
// photo is owned by a user id, so creating a second admin would leave the whole
// library attached to the old one.
//
//   node scripts/set-admin.mjs <email> <password>
//
// The password is hashed here and bypasses the API's own minimum-length rule,
// which is fine for a local instance but means a short password cannot later be
// re-set through the app's change-password form.
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../src/generated/prisma/client';

const here = dirname(fileURLToPath(import.meta.url));
for (const file of ['../.env', '../../.env']) {
  const path = resolve(here, file);
  if (existsSync(path)) loadEnv({ path, override: false });
}

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node scripts/set-admin.mjs <email> <password>');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const run = async () => {
  const admin = await prisma.user.findFirst({
    where: { isAdmin: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!admin) {
    console.error('No administrator account exists yet. Run the seed first.');
    process.exitCode = 1;
    return;
  }

  const normalised = email.toLowerCase().trim();

  const clash = await prisma.user.findFirst({
    where: { email: normalised, id: { not: admin.id } },
  });
  if (clash) {
    console.error(`Another account already uses ${normalised}.`);
    process.exitCode = 1;
    return;
  }

  const [assets, folders, albums] = await Promise.all([
    prisma.asset.count({ where: { ownerId: admin.id } }),
    prisma.folder.count({ where: { ownerId: admin.id } }),
    prisma.album.count({ where: { ownerId: admin.id } }),
  ]);

  await prisma.user.update({
    where: { id: admin.id },
    data: {
      email: normalised,
      password: await bcrypt.hash(password, 12),
      shouldChangePassword: false,
    },
  });

  console.log(`Administrator is now ${normalised}`);
  console.log(`Library kept: ${assets} assets, ${folders} folders, ${albums} albums`);
};

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
