/**
 * Creates the first admin user. Run once: npm run seed
 * ADMIN_EMAIL / ADMIN_PASSWORD may be supplied via env.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@example.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? 'ChangeMe#12345';

  if (password.length < 12) throw new Error('pick a password of at least 12 characters');

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash: await bcrypt.hash(password, 10),
      fullName: process.env.ADMIN_NAME ?? 'System Administrator',
      role: 'ADMIN',
    },
  });

  console.log(`admin ready: ${user.email}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`default password in use: ${password}  <-- change it after first login`);
  }
}

main().finally(() => prisma.$disconnect());
