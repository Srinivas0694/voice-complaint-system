/**
 * Registers a device directly against the database and prints a ready-to-paste
 * secrets.ini block. Avoids needing a logged-in dashboard before the first
 * device exists.
 *
 *   npx tsx scripts/register-device.ts DEVICE_001 "Kitchen freezer" FREEZER \
 *     --lat 17.4126 --lng 78.4482 --site "Khrana, Banjara Hills"
 *
 *   npx tsx scripts/register-device.ts DEVICE_001 --rotate
 *
 * Location is PROVISIONED here rather than measured by the device. An appliance
 * monitor is glued to a freezer and never moves, so its position is known once
 * at installation — and an installer dropping a pin beats a GPS receiver in a
 * basement kitchen, where a fix often never arrives at all.
 */
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const KEY = Buffer.from(process.env.DEVICE_SECRET_ENC_KEY!, 'hex');

function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

/** Pulls `--name value` out of argv and returns the remaining positionals. */
function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = 'true';
    } else positional.push(argv[i]);
  }
  return { flags, positional };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [deviceId, name, applianceType] = positional;

  if (!deviceId) {
    console.error(`usage:
  tsx scripts/register-device.ts <DEVICE_ID> [name] [APPLIANCE_TYPE] [options]

options:
  --lat <n>       installation latitude
  --lng <n>       installation longitude
  --site <text>   site name, e.g. "Khrana, Banjara Hills"
  --address <t>   full postal address
  --rotate        issue a new secret, keep everything else`);
    process.exit(1);
  }
  if (!process.env.DEVICE_SECRET_ENC_KEY) {
    console.error('DEVICE_SECRET_ENC_KEY is not set — load .env first');
    process.exit(1);
  }

  const lat = flags.lat ? Number(flags.lat) : undefined;
  const lng = flags.lng ? Number(flags.lng) : undefined;
  if ((lat !== undefined && Number.isNaN(lat)) || (lng !== undefined && Number.isNaN(lng))) {
    console.error('--lat and --lng must be numbers');
    process.exit(1);
  }

  const secret = crypto.randomBytes(32).toString('hex');

  // On --rotate, touch only the secret. Otherwise apply whatever was supplied
  // and leave the rest of the record alone.
  const shared = flags.rotate === 'true' ? {} : {
    ...(name ? { name } : {}),
    ...(applianceType ? { applianceType: applianceType as never } : {}),
    ...(lat !== undefined ? { latitude: lat } : {}),
    ...(lng !== undefined ? { longitude: lng } : {}),
    ...(flags.site ? { siteName: flags.site } : {}),
    ...(flags.address ? { siteAddress: flags.address } : {}),
  };

  const device = await prisma.device.upsert({
    where: { deviceId },
    update: { ...shared, secretEnc: encryptSecret(secret), status: 'PROVISIONED' },
    create: {
      deviceId,
      name: name ?? deviceId,
      applianceType: (applianceType as never) ?? 'OTHER',
      ...shared,
      secretEnc: encryptSecret(secret),
      status: 'PROVISIONED',
    },
  });

  console.log(`\nregistered ${device.deviceId} (${device.id})`);
  if (device.latitude && device.longitude) {
    console.log(`location    ${device.latitude}, ${device.longitude}` +
                (device.siteName ? `  — ${device.siteName}` : ''));
  } else {
    console.log('location    not set. Complaints will have no coordinates.');
    console.log('            add with:  --lat 17.4126 --lng 78.4482 --site "Site name"');
  }

  console.log('\npaste into Firmware/secrets.ini:\n');
  console.log('[secrets]');
  console.log('wifi_ssid     = YOUR_WIFI');
  console.log('wifi_password = YOUR_PASSWORD');
  console.log(`device_id     = ${device.deviceId}`);
  console.log(`device_secret = ${secret}`);
  console.log('api_base_url  = https://YOUR-APP.vercel.app/api/v1\n');
  console.log('This secret is shown once. It is encrypted at rest and cannot be read back.\n');
}

main().finally(() => prisma.$disconnect());
