import { Server as HTTPServer } from 'http'
import { Server as SocketIOServer, Socket } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import Redis from 'ioredis'
import { prisma } from '../config/database'
import { logger } from '../utils/logger'
import { presenceService } from './realtimePresence'

interface SocketData {
  userId: string
  walletAddress: string
}

class ChatService {
  private io: SocketIOServer | null = null

  /**
   * Initializes the Socket.IO server with CORS configuration and authentication middleware.
   * Sets up connection handlers for authorized users.
   *
   * Attaches the Redis adapter so that `io.to(room).emit(...)` calls (here and
   * in notificationService, which shares this same `io` via getIO()) reach
   * sockets connected to ANY backend instance, not just this one — without
   * it, a user connected to instance B never receives an event triggered on
   * instance A. Presence/room-membership bookkeeping is delegated to
   * `presenceService` (Redis-backed) for the same reason: an in-memory Map
   * here would only ever reflect this instance's own connections.
   *
   * @param server - The HTTP server instance to attach to
   */
  init(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    })

    const pubClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
    const subClient = pubClient.duplicate()
    pubClient.on('error', (err) => logger.error('Redis adapter pub client error', { error: err.message }))
    subClient.on('error', (err) => logger.error('Redis adapter sub client error', { error: err.message }))
    this.io.adapter(createAdapter(pubClient, subClient))

    this.io.use(async (socket, next) => {
      try {
        const walletAddress = socket.handshake.auth.walletAddress
        const userId = socket.handshake.auth.userId

        if (!walletAddress || !userId) {
          return next(new Error('Authentication required'))
        }

        // Verify user exists
        const user = await prisma.user.findUnique({
          where: { walletAddress },
        })

        if (!user) {
          return next(new Error('User not found'))
        }

        (socket.data as SocketData) = { userId, walletAddress }
        next()
      } catch (error) {
        logger.error('Socket authentication error:', error)
        next(new Error('Authentication failed'))
      }
    })

    this.io.on('connection', (socket: Socket<any, any, any, SocketData>) => {
      logger.info(`User connected: ${socket.data.userId}`)
      this.handleConnection(socket)
    })

    logger.info('Socket.IO initialized')
  }

  private handleConnection(socket: Socket<any, any, any, SocketData>) {
    const { userId, walletAddress } = socket.data

    // Track presence in shared (Redis) state, not per-instance memory.
    presenceService.addConnection(userId).catch((err) => logger.error('Failed to record presence', { userId, err }))

    // Join user to their chat rooms
    this.joinUserRooms(socket, userId)

    // Handle joining a specific room
    socket.on('join_room', async (data: { roomId: string }) => {
      try {
        await this.joinRoom(socket, data.roomId, userId)
      } catch (error) {
        logger.error('Error joining room:', error)
        socket.emit('error', { message: 'Failed to join room' })
      }
    })

    // Handle leaving a room
    socket.on('leave_room', (data: { roomId: string }) => {
      this.leaveRoom(socket, data.roomId)
    })

    // Handle chat messages
    socket.on('send_message', async (data: { roomId: string; content: string; type?: string; metadata?: any }) => {
      try {
        await this.handleMessage(socket, userId, walletAddress, data)
      } catch (error) {
        logger.error('Error sending message:', error)
        socket.emit('error', { message: 'Failed to send message' })
      }
    })

    // Handle typing indicators
    socket.on('typing_start', (data: { roomId: string }) => {
      socket.to(data.roomId).emit('user_typing', { userId, roomId: data.roomId })
    })

    socket.on('typing_stop', (data: { roomId: string }) => {
      socket.to(data.roomId).emit('user_stopped_typing', { userId, roomId: data.roomId })
    })

    // Handle disconnect
    socket.on('disconnect', () => {
      this.handleDisconnect(socket, userId)
    })
  }

  private async joinUserRooms(socket: Socket, userId: string) {
    try {
      const participantRooms = await prisma.chatParticipant.findMany({
        where: { userId },
        include: { room: true },
      })

      for (const participant of participantRooms) {
        socket.join(participant.roomId)
        await presenceService.joinGroup(userId, participant.roomId)

        // Update last seen
        await prisma.chatParticipant.update({
          where: {
            roomId_userId: {
              roomId: participant.roomId,
              userId,
            },
          },
          data: { lastSeenAt: new Date() },
        })
      }

      logger.info(`User ${userId} joined ${participantRooms.length} rooms`)
    } catch (error) {
      logger.error('Error joining user rooms:', error)
    }
  }

  private async joinRoom(socket: Socket, roomId: string, userId: string) {
    // Verify user is a participant
    const participant = await prisma.chatParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    })

    if (!participant) {
      throw new Error('User is not a participant in this room')
    }

    socket.join(roomId)
    await presenceService.joinGroup(userId, roomId)

    // Update last seen
    await prisma.chatParticipant.update({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
      data: { lastSeenAt: new Date() },
    })

    logger.info(`User ${userId} joined room ${roomId}`)
  }

  private leaveRoom(socket: Socket, roomId: string) {
    socket.leave(roomId)
    const { userId } = (socket as Socket<any, any, any, SocketData>).data
    presenceService
      .leaveGroup(userId, roomId)
      .catch((err) => logger.error('Failed to record presence', { userId, roomId, err }))
    logger.info(`User left room ${roomId}`)
  }

  private async handleMessage(
    socket: Socket,
    userId: string,
    walletAddress: string,
    data: { roomId: string; content: string; type?: string; metadata?: any }
  ) {
    const { roomId, content, type = 'TEXT', metadata } = data

    // Verify user is a participant
    const participant = await prisma.chatParticipant.findUnique({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    })

    if (!participant) {
      throw new Error('User is not a participant in this room')
    }

    // Save message to database
    const message = await prisma.chatMessage.create({
      data: {
        roomId,
        userId,
        content,
        type,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
      include: {
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
    })

    // Broadcast message to room
    this.io?.to(roomId).emit('new_message', {
      id: message.id,
      roomId: message.roomId,
      userId: message.userId,
      walletAddress: message.user.walletAddress,
      content: message.content,
      type: message.type,
      metadata: message.metadata ? JSON.parse(message.metadata) : null,
      isEdited: message.isEdited,
      createdAt: message.createdAt,
    })

    logger.info(`Message sent in room ${roomId} by user ${userId}`)
  }

  private handleDisconnect(socket: Socket, userId: string) {
    presenceService
      .removeConnection(userId)
      .catch((err) => logger.error('Failed to clear presence', { userId, err }))

    logger.info(`User disconnected: ${userId}`)
  }

  // Public methods for external use
  /**
   * Creates a new chat room associated with a specific savings group.
   * 
   * @param groupId - The ID of the group
   * @param name - Display name for the chat room
   * @param description - Optional room description
   * @returns Promise resolving to the created chat room
   */
  public async createChatRoom(groupId: string, name: string, description?: string) {
    const chatRoom = await prisma.chatRoom.create({
      data: {
        groupId,
        name,
        description,
      },
    })

    logger.info(`Chat room created for group ${groupId}`)
    return chatRoom
  }

  /**
   * Adds a user to a specific chat room and notifies other participants.
   * 
   * @param roomId - The target chat room ID
   * @param userId - The ID of the user to add
   * @returns Promise resolving when the participant is added
   */
  public async addParticipant(roomId: string, userId: string) {
    const participant = await prisma.chatParticipant.upsert({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
      update: {},
      create: {
        roomId,
        userId,
      },
    })

    // Notify room about new participant
    this.io?.to(roomId).emit('participant_joined', { userId, roomId })

    logger.info(`User ${userId} added as participant to room ${roomId}`)
    return participant
  }

  /**
   * Removes a user from a chat room and notifies other participants.
   * 
   * @param roomId - The target chat room ID
   * @param userId - The ID of the user to remove
   * @returns Promise resolving when the participant is removed
   */
  public async removeParticipant(roomId: string, userId: string) {
    await prisma.chatParticipant.delete({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
    })

    // Notify room about participant leaving
    this.io?.to(roomId).emit('participant_left', { userId, roomId })

    logger.info(`User ${userId} removed from room ${roomId}`)
  }

  /**
   * Fetches historical messages for a chat room with pagination.
   * 
   * @param roomId - The chat room ID
   * @param limit - Maximum messages to retrieve (default: 50)
   * @param before - Optional timestamp to retrieve messages older than this date
   * @returns Promise resolving to an array of messages in ascending order
   */
  public async getMessages(roomId: string, limit: number = 50, before?: Date) {
    const messages = await prisma.chatMessage.findMany({
      where: {
        roomId,
        deletedAt: null,
        createdAt: before ? { lt: before } : undefined,
      },
      include: {
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return messages.reverse() // Return in ascending order
  }

  /**
   * Modifies the content of an existing chat message and notifies participants.
   * 
   * @param messageId - The ID of the message to edit
   * @param userId - ID of the user attempting the edit (for authorization)
   * @param content - New message content
   * @returns Promise resolving to the updated message
   */
  public async editMessage(messageId: string, userId: string, content: string) {
    const message = await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        content,
        isEdited: true,
      },
      include: {
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
    })

    // Broadcast updated message
    this.io?.to(message.roomId).emit('message_edited', {
      id: message.id,
      roomId: message.roomId,
      content: message.content,
      isEdited: message.isEdited,
      updatedAt: message.updatedAt,
    })

    logger.info(`Message ${messageId} edited`)
    return message
  }

  /**
   * Soft-deletes a chat message by marking it with a [Deleted] placeholder.
   * 
   * @param messageId - The ID of the message to delete
   * @param userId - ID of the user attempting the deletion
   * @returns Promise resolving to the deleted message record
   */
  public async deleteMessage(messageId: string, userId: string) {
    const message = await prisma.chatMessage.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        content: '[Deleted]',
      },
    })

    // Broadcast deletion
    this.io?.to(message.roomId).emit('message_deleted', {
      id: message.id,
      roomId: message.roomId,
    })

    logger.info(`Message ${messageId} deleted`)
    return message
  }

  /**
   * Updates a user's 'lastReadAt' timestamp for a specific chat room.
   * 
   * @param roomId - The chat room ID
   * @param userId - The user ID
   * @returns Promise resolving when the timestamp is updated
   */
  public async markAsRead(roomId: string, userId: string) {
    await prisma.chatParticipant.update({
      where: {
        roomId_userId: {
          roomId,
          userId,
        },
      },
      data: { lastReadAt: new Date() },
    })
  }

  public getIO() {
    return this.io
  }
}

export const chatService = new ChatService()
