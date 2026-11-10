import { Module } from '@nestjs/common'

import { StorageService } from './storage.service'

/** API-side Supabase Storage access (signed uploads and object metadata through the caller's client). */
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
