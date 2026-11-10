import { Global, Module } from '@nestjs/common'

import { QueueProducer } from './queue-producer'

/** API-side access to the background queues (producer only; processing happens in the worker). */
@Global()
@Module({ providers: [QueueProducer], exports: [QueueProducer] })
export class QueuesModule {}
