jest.mock('../src/services/cacheService', () => ({
  redisClient: {
    set: jest.fn(),
    eval: jest.fn(),
  },
}))

import { redisClient } from '../src/services/cacheService'
import { DistributedLock } from '../src/services/distributedLock'

const mockedRedis = redisClient as unknown as {
  set: jest.Mock
  eval: jest.Mock
}

describe('DistributedLock', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockedRedis.set.mockResolvedValueOnce('OK').mockResolvedValue(null)
    mockedRedis.eval.mockResolvedValue(1)
  })

  it('allows only one owner to acquire a key', async () => {
    const first = new DistributedLock('lock:test')
    const second = new DistributedLock('lock:test')

    await expect(first.acquire()).resolves.toBe(true)
    await expect(second.acquire()).resolves.toBe(false)

    await first.release()
  })

  it('releases through the token-checking Redis script', async () => {
    const lock = new DistributedLock('lock:test')

    await lock.acquire()
    await lock.release()

    expect(mockedRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1])"),
      1,
      'lock:test',
      expect.any(String)
    )
  })
})