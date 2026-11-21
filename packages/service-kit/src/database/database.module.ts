import { Global, Module } from '@nestjs/common'

import { RlsClientFactory } from './rls-client.factory'

/** HTTP-service database access. Deliberately does not provide a service-role client. */
@Global()
@Module({ providers: [RlsClientFactory], exports: [RlsClientFactory] })
export class DatabaseModule {}
