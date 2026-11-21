import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'leaseguard:isPublic'

/**
 * Exempts a route or controller from the global SupabaseAuthGuard: health checks, and Meta's WhatsApp webhook,
 * which authenticates Meta itself (verify token, app-secret signature).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true)
