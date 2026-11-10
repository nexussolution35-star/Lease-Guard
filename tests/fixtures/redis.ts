import { connect, type Socket } from 'node:net'

/**
 * A minimal Redis (RESP2) client: enough to check that Redis is up and to remove the BullMQ keys one
 * integration run created under its own QUEUE_PREFIX. The tests workspace deliberately has no Redis
 * dependency; the API process talks to Redis through BullMQ itself.
 */

type RespValue = string | number | null | RespValue[]

class RespError extends Error {
  override name = 'RespError'
}

interface Parsed {
  value: RespValue | RespError
  end: number
}

/** Parses one reply starting at `start`, or returns undefined when the buffer is incomplete. */
function parseReply(buffer: Buffer, start: number): Parsed | undefined {
  const lineEnd = buffer.indexOf('\r\n', start)
  if (lineEnd === -1) return undefined
  const type = String.fromCharCode(buffer[start] ?? 0)
  const line = buffer.toString('utf8', start + 1, lineEnd)
  const next = lineEnd + 2
  switch (type) {
    case '+':
      return { value: line, end: next }
    case '-':
      return { value: new RespError(line), end: next }
    case ':':
      return { value: Number(line), end: next }
    case '$': {
      const length = Number(line)
      if (length === -1) return { value: null, end: next }
      if (buffer.length < next + length + 2) return undefined
      return { value: buffer.toString('utf8', next, next + length), end: next + length + 2 }
    }
    case '*': {
      const count = Number(line)
      if (count === -1) return { value: null, end: next }
      const items: RespValue[] = []
      let offset = next
      for (let index = 0; index < count; index += 1) {
        const item = parseReply(buffer, offset)
        if (!item) return undefined
        if (item.value instanceof RespError) return { value: item.value, end: item.end }
        items.push(item.value)
        offset = item.end
      }
      return { value: items, end: offset }
    }
    default:
      throw new Error(`Unexpected Redis reply type ${JSON.stringify(type)}`)
  }
}

function encode(args: readonly string[]): string {
  return `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join('')}`
}

export class RedisConnection {
  private buffer = Buffer.alloc(0)
  private readonly waiting: { resolve: (value: RespValue) => void; reject: (error: Error) => void }[] = []

  private readonly socket: Socket

  private constructor(socket: Socket) {
    this.socket = socket
    socket.on('data', (chunk) => this.onData(chunk))
    socket.on('error', (error) => this.failAll(error))
    socket.on('close', () => this.failAll(new Error('Redis connection closed')))
  }

  /** Connects to `redis://[[user]:password@]host:port[/db]`. */
  static async open(url: string, timeoutMs = 5_000): Promise<RedisConnection> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'redis:') throw new Error(`Only redis:// URLs are supported by the test helper, got ${parsed.protocol}`)
    const socket = await new Promise<Socket>((resolve, reject) => {
      const candidate = connect({ host: parsed.hostname.replace(/^\[|\]$/g, ''), port: Number(parsed.port || 6379) })
      const timer = setTimeout(() => {
        candidate.destroy()
        reject(new Error(`Timed out connecting to Redis at ${parsed.host}`))
      }, timeoutMs)
      candidate.once('connect', () => {
        clearTimeout(timer)
        resolve(candidate)
      })
      candidate.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    const connection = new RedisConnection(socket)
    if (parsed.password) {
      const auth = parsed.username ? [decodeURIComponent(parsed.username), decodeURIComponent(parsed.password)] : [decodeURIComponent(parsed.password)]
      await connection.command('AUTH', ...auth)
    }
    const db = parsed.pathname.replace(/^\//, '')
    if (db) await connection.command('SELECT', db)
    return connection
  }

  command(...args: string[]): Promise<RespValue> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject })
      this.socket.write(encode(args))
    })
  }

  close(): void {
    this.socket.end()
    this.socket.destroy()
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const reply = parseReply(this.buffer, 0)
      if (!reply) return
      this.buffer = this.buffer.subarray(reply.end)
      const waiter = this.waiting.shift()
      if (!waiter) continue
      if (reply.value instanceof RespError) waiter.reject(reply.value)
      else waiter.resolve(reply.value)
    }
  }

  private failAll(error: Error): void {
    for (const waiter of this.waiting.splice(0)) waiter.reject(error)
  }
}

async function withRedis<T>(url: string, use: (redis: RedisConnection) => Promise<T>): Promise<T> {
  const redis = await RedisConnection.open(url)
  try {
    return await use(redis)
  } finally {
    redis.close()
  }
}

/** Fails with a clear message when Redis does not answer PING. */
export async function assertRedisReachable(url: string): Promise<void> {
  try {
    const reply = await withRedis(url, (redis) => redis.command('PING'))
    if (reply !== 'PONG') throw new Error(`unexpected PING reply ${JSON.stringify(reply)}`)
  } catch (error) {
    throw new Error(
      `Redis is not reachable at ${new URL(url).host} (${error instanceof Error ? error.message : String(error)}). ` +
        'Start it, e.g. `docker run -d --name leaseguard-redis-dev -p 127.0.0.1:6379:6379 redis:7.4.12` (the compose redis service is not published on the host).',
    )
  }
}

const SAFE_PREFIX = /^[a-z0-9_-]+$/i

/** Every key under `<prefix>:` (BullMQ's key layout), found with SCAN so Redis is never blocked. */
async function scanPrefix(redis: RedisConnection, prefix: string): Promise<string[]> {
  if (!SAFE_PREFIX.test(prefix)) throw new Error(`Unsafe Redis key prefix ${JSON.stringify(prefix)}`)
  const keys: string[] = []
  let cursor = '0'
  do {
    const reply = await redis.command('SCAN', cursor, 'MATCH', `${prefix}:*`, 'COUNT', '500')
    if (!Array.isArray(reply) || typeof reply[0] !== 'string' || !Array.isArray(reply[1])) {
      throw new Error('Unexpected SCAN reply')
    }
    cursor = reply[0]
    for (const key of reply[1]) if (typeof key === 'string') keys.push(key)
  } while (cursor !== '0')
  return keys
}

/** Every key under `<prefix>:`. */
export function listKeysWithPrefix(url: string, prefix: string): Promise<string[]> {
  return withRedis(url, (redis) => scanPrefix(redis, prefix))
}

export function countKeysWithPrefix(url: string, prefix: string): Promise<number> {
  return withRedis(url, async (redis) => (await scanPrefix(redis, prefix)).length)
}

/** Deletes every key under `<prefix>:` and returns how many were deleted. */
export function deleteKeysWithPrefix(url: string, prefix: string): Promise<number> {
  return withRedis(url, async (redis) => {
    const keys = await scanPrefix(redis, prefix)
    let deleted = 0
    for (let index = 0; index < keys.length; index += 200) {
      const reply = await redis.command('DEL', ...keys.slice(index, index + 200))
      if (typeof reply === 'number') deleted += reply
    }
    return deleted
  })
}
