import type { EntityId } from '@leaseguard/domain'

/**
 * Hands a number's registration PIN from the API (where the company admin types it) to the worker (which
 * calls Meta's register endpoint with the business token only the worker can read).
 *
 * The PIN is never stored: not in Postgres, not in the job payload (job payloads are recorded in job_runs
 * and kept in BullMQ's history), not in logs. It passes through one Redis key under the queue prefix that
 * expires after REGISTRATION_PIN_TTL_SECONDS and that the worker deletes as it reads it (GETDEL), so a PIN is
 * used for at most one registration attempt and a retried job never re-sends it to Meta.
 */
export const REGISTRATION_PIN_TTL_SECONDS = 600

/** A 6-digit two-step verification PIN, as Meta's register endpoint requires. */
export const REGISTRATION_PIN = /^\d{6}$/

/** The Redis commands the handoff needs (ioredis). */
export interface PinRedis {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>
  getdel(key: string): Promise<string | null>
}

export function registrationPinKey(queuePrefix: string, companyId: EntityId, numberId: EntityId): string {
  return `${queuePrefix}:whatsapp-registration-pin:${companyId.toLowerCase()}:${numberId.toLowerCase()}`
}

export class RegistrationPins {
  constructor(
    private readonly redis: PinRedis,
    private readonly queuePrefix: string,
  ) {}

  /** API: keeps the PIN for the next verification of the number (replacing an unused earlier one). */
  async put(companyId: EntityId, numberId: EntityId, pin: string): Promise<void> {
    if (!REGISTRATION_PIN.test(pin)) throw new Error('A registration PIN is 6 digits')
    await this.redis.set(registrationPinKey(this.queuePrefix, companyId, numberId), pin, 'EX', REGISTRATION_PIN_TTL_SECONDS)
  }

  /** Worker: the PIN if one is waiting, removed as it is read. */
  async take(companyId: EntityId, numberId: EntityId): Promise<string | null> {
    const pin = await this.redis.getdel(registrationPinKey(this.queuePrefix, companyId, numberId))
    return pin !== null && REGISTRATION_PIN.test(pin) ? pin : null
  }
}
