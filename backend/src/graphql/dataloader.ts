import DataLoader from 'dataloader'
import { prisma } from '@/config/database'

export const createDataLoaders = () => {
  const groupLoader = new DataLoader(async (groupIds: readonly string[]) => {
    const groups = await prisma.group.findMany({
      where: { id: { in: groupIds as string[] } },
    })
    const groupMap = new Map(groups.map(g => [g.id, g]))
    return groupIds.map(id => groupMap.get(id as string) || null)
  })

  const userLoader = new DataLoader(async (userIds: readonly string[]) => {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds as string[] } },
    })
    const userMap = new Map(users.map(u => [u.id, u]))
    return userIds.map(id => userMap.get(id as string) || null)
  })

  const memberCountLoader = new DataLoader(async (groupIds: readonly string[]) => {
    const counts = await prisma.groupMember.groupBy({
      by: ['groupId'],
      where: { groupId: { in: groupIds as string[] } },
      _count: true,
    })
    const countMap = new Map(counts.map(c => [c.groupId, c._count]))
    return groupIds.map(id => countMap.get(id as string) || 0)
  })

  // Batches "give me this group's members" across every Group in a single
  // result page into one query, instead of one query per group (N+1).
  const membersByGroupLoader = new DataLoader(async (groupIds: readonly string[]) => {
    const members = await prisma.groupMember.findMany({
      where: { groupId: { in: groupIds as string[] } },
      orderBy: { joinedAt: 'asc' },
    })
    const byGroup = new Map<string, typeof members>()
    for (const member of members) {
      const bucket = byGroup.get(member.groupId)
      if (bucket) bucket.push(member)
      else byGroup.set(member.groupId, [member])
    }
    return groupIds.map(id => byGroup.get(id as string) ?? [])
  })

  // Same batching as above, for a group's contributions.
  const contributionsByGroupLoader = new DataLoader(async (groupIds: readonly string[]) => {
    const contributions = await prisma.contribution.findMany({
      where: { groupId: { in: groupIds as string[] } },
      orderBy: { createdAt: 'desc' },
    })
    const byGroup = new Map<string, typeof contributions>()
    for (const contribution of contributions) {
      const bucket = byGroup.get(contribution.groupId)
      if (bucket) bucket.push(contribution)
      else byGroup.set(contribution.groupId, [contribution])
    }
    return groupIds.map(id => byGroup.get(id as string) ?? [])
  })

  return {
    groupLoader,
    userLoader,
    memberCountLoader,
    membersByGroupLoader,
    contributionsByGroupLoader,
  }
}

export type DataLoaders = ReturnType<typeof createDataLoaders>
