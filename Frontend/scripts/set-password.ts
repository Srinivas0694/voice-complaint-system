/**
 * Changes a user's password. seed.ts deliberately won't do this — it upserts
 * with `update: {}` so re-running it can never clobber a live account.
 *
 *   npx tsx scripts/set-password.ts admin@example.com "new password here"
 *
 * Also revokes every refresh token for that user, so any session opened with
 * the old password stops working within one access-token lifetime (15 min).
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const [emailArg, password] = process.argv.slice(2);

  if (!emailArg || !password) {
    console.error('usage: tsx scripts/set-password.ts <email> "<new password>"');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('pick a password of at least 12 characters');
    process.exit(1);
  }

  const email = emailArg.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`no user with email ${email}`);
    const all = await prisma.user.findMany({ select: { email: true, role: true } });
    if (all.length) {
      console.error('existing users:');
      all.forEach((u) => console.error(`  ${u.email}  (${u.role})`));
    }
    process.exit(1);
  }

  await prisma.user.update({
    where: { email },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });

  const { count } = await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  console.log(`\npassword updated for ${email}`);
  console.log(`${count} active session${count === 1 ? '' : 's'} revoked\n`);
}

main().finally(() => prisma.$disconnect());
