/**
 * Tests for chatService's missed-message replay on reconnect (#934).
 *
 * A client that was only briefly disconnected must not silently lose chat
 * messages broadcast during the gap — Socket.IO only delivers `new_message`
 * to sockets connected at emit time. These tests exercise the replay path
 * directly (bypassing the real Socket.IO/Redis-adapter setup in `init()`,
 * which isn't needed to verify this logic) following this repo's existing
 * private-method testing convention (see webhookService.test.ts).
 */
jest.mock('../../src/config/database', () => ({
  prisma: {
    chatParticipant: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    chatMessage: {
      findMany: jest.fn(),
    },
  },
}))

jest.mock('../../src/services/realtimePresence', () => ({
  presenceService: {
    joinGroup: jest.fn().mockResolvedValue(undefined),
    leaveGroup: jest.fn().mockResolvedValue(undefined),
    addConnection: jest.fn().mockResolvedValue(1),
    removeConnection: jest.fn().mockResolvedValue(0),
  },
}))

import { chatService } from '../../src/services/chatService'
import { prisma } from '../../src/config/database'
import { presenceService } from '../../src/services/realtimePresence'

const mockPrisma = prisma as unknown as {
  chatParticipant: { findMany: jest.Mock; update: jest.Mock }
  chatMessage: { findMany: jest.Mock }
}

function fakeSocket() {
  return {
    join: jest.fn(),
    emit: jest.fn(),
  } as unknown as { join: jest.Mock; emit: jest.Mock }
}

describe('chatService missed-message replay', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.chatParticipant.update.mockResolvedValue({})
  })

  it('replays messages created since lastSeenAt on reconnect', async () => {
    const lastSeenAt = new Date('2026-08-24T10:00:00Z')
    mockPrisma.chatParticipant.findMany.mockResolvedValue([
      { roomId: 'room-1', userId: 'user-1', lastSeenAt },
    ])
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      {
        id: 'msg-1',
        roomId: 'room-1',
        userId: 'user-2',
        content: 'missed while you were away',
        type: 'TEXT',
        metadata: null,
        isEdited: false,
        createdAt: new Date('2026-08-24T10:05:00Z'),
        user: { walletAddress: 'GABC...' },
      },
    ])

    const socket = fakeSocket()
    await (chatService as any).joinUserRooms(socket, 'user-1')

    expect(socket.join).toHaveBeenCalledWith('room-1')
    expect(presenceService.joinGroup).toHaveBeenCalledWith('user-1', 'room-1')

    // Queried for messages strictly after the participant's last-seen mark.
    expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roomId: 'room-1',
          deletedAt: null,
          createdAt: { gt: lastSeenAt },
        }),
      })
    )

    expect(socket.emit).toHaveBeenCalledWith('missed_messages', {
      roomId: 'room-1',
      truncated: false,
      messages: [
        expect.objectContaining({ id: 'msg-1', content: 'missed while you were away', walletAddress: 'GABC...' }),
      ],
    })

    // lastSeenAt is refreshed after the replay, not before (so the replay
    // window is computed against the *previous* connection, not "now").
    expect(mockPrisma.chatParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId_userId: { roomId: 'room-1', userId: 'user-1' } },
        data: { lastSeenAt: expect.any(Date) },
      })
    )
  })

  it('does not emit missed_messages when nothing was missed', async () => {
    mockPrisma.chatParticipant.findMany.mockResolvedValue([
      { roomId: 'room-1', userId: 'user-1', lastSeenAt: new Date() },
    ])
    mockPrisma.chatMessage.findMany.mockResolvedValue([])

    const socket = fakeSocket()
    await (chatService as any).joinUserRooms(socket, 'user-1')

    expect(socket.emit).not.toHaveBeenCalledWith('missed_messages', expect.anything())
  })

  it('skips replay entirely on a participant\'s first-ever join (no lastSeenAt)', async () => {
    mockPrisma.chatParticipant.findMany.mockResolvedValue([
      { roomId: 'room-1', userId: 'user-1', lastSeenAt: null },
    ])

    const socket = fakeSocket()
    await (chatService as any).joinUserRooms(socket, 'user-1')

    expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled()
    expect(socket.emit).not.toHaveBeenCalled()
  })

  it('caps replay at MISSED_MESSAGES_REPLAY_LIMIT and marks the batch truncated', async () => {
    const lastSeenAt = new Date('2026-08-24T10:00:00Z')
    mockPrisma.chatParticipant.findMany.mockResolvedValue([
      { roomId: 'room-1', userId: 'user-1', lastSeenAt },
    ])

    const REPLAY_LIMIT = 200
    const overflow = Array.from({ length: REPLAY_LIMIT + 1 }, (_, i) => ({
      id: `msg-${i}`,
      roomId: 'room-1',
      userId: 'user-2',
      content: `message ${i}`,
      type: 'TEXT',
      metadata: null,
      isEdited: false,
      createdAt: new Date(lastSeenAt.getTime() + i * 1000),
      user: { walletAddress: 'GABC...' },
    }))
    mockPrisma.chatMessage.findMany.mockResolvedValue(overflow)

    const socket = fakeSocket()
    await (chatService as any).joinUserRooms(socket, 'user-1')

    // Asked Prisma for one more than the cap, to detect overflow.
    expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: REPLAY_LIMIT + 1 })
    )

    const [, payload] = socket.emit.mock.calls.find(([event]) => event === 'missed_messages')!
    expect(payload.truncated).toBe(true)
    expect(payload.messages).toHaveLength(REPLAY_LIMIT)
  })
})
