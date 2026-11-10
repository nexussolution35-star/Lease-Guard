import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'leaseguard:isPublic'

/** Exempts a route or controller from the global SupabaseAuthGuard (health checks only). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true)
