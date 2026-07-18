/**
 * One-off seed for scripts/verify-cross-instance-realtime.ts: creates the two
 * test users and a group they can share a chat room in. Idempotent (upserts),
 * safe to run before every verification pass.
 */
import { prisma } from '../src/config/database'

export const USER_A = { walletAddress: 'GVERIFYA000000000000000000000000000000000000000000000A', userId: 'GVERIFYA000000000000000000000000000000000000000000000A' }
export const USER_B = { walletAddress: 'GVERIFYB000000000000000000000000000000000000000000000B', userId: 'GVERIFYB000000000000000000000000000000000000000000000B' }
export const GROUP_ID = 'verify-group-cross-instance'

export async function seed(): Promise<void> {
  for (const u of [USER_A, USER_B]) {
    await prisma.user.upsert({
      where: { walletAddress: u.walletAddress },
      update: {},
      create: { walletAddress: u.walletAddress },
    })
  }
  await prisma.group.upsert({
    where: { id: GROUP_ID },
    update: {},
    create: {
      id: GROUP_ID,
      name: 'Cross-instance verification group',
      contributionAmount: 100,
      frequency: 30,
      maxMembers: 10,
    },
  })
}

if (require.main === module) {
  seed()
    .then(() => prisma.$disconnect())
    .then(() => process.stdout.write('seeded verification users + group\n'))
    .catch((err) => {
      process.stderr.write(`seed failed: ${err}\n`)
      process.exit(1)
    })
}
