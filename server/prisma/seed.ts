import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEFAULT_PREFERENCES = {
  theme: 'system',
  tileSize: 235,
  showAssetsInSubfolders: true,
  timelineLayout: 'justified',
  autoplayVideos: true,
  loopVideos: false,
  videoQuality: 'transcoded',
  showMemories: true,
  locale: 'en',
};

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? 'eranabir@gmail.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? '1234';

  const existingAdmin = await prisma.user.findFirst({ where: { isAdmin: true } });
  if (existingAdmin) {
    console.log(`Administrator already exists (${existingAdmin.email}); nothing to seed.`);
    return;
  }

  const admin = await prisma.user.create({
    data: {
      email,
      name: 'Administrator',
      password: await bcrypt.hash(password, 12),
      isAdmin: true,
      storageLabel: 'admin',
      // Force a change on first login unless the operator supplied one.
      shouldChangePassword: !process.env.ADMIN_PASSWORD,
      preferences: DEFAULT_PREFERENCES,
    },
  });

  console.log(`Created administrator ${admin.email}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`Temporary password: ${password} — change it after signing in.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
