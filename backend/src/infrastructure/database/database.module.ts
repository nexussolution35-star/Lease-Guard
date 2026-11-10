import { Global, Module } from '@nestjs/common'

import { RlsClientFactory } from './rls-client.factory'

/** API-process database access. Deliberately does not provide the service-role client. */
@Global()
@Module({ providers: [RlsClientFactory], exports: [RlsClientFactory] })
export class DatabaseModule {}
