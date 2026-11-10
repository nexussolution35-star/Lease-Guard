import { Module } from '@nestjs/common'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

/** The signed-in caller's profile and workspaces (`GET /me`). Sign-in itself is Supabase Auth. */
@Module({ controllers: [AuthController], providers: [AuthService], exports: [AuthService] })
export class AuthModule {}
