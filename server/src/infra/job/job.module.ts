import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { ALL_QUEUES } from './job.constants';
import { BackgroundTaskGate } from './background-task-gate.service';
import { JobService } from './job.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        connection: {
          host: config.get('redis.host', { infer: true }),
          port: config.get('redis.port', { infer: true }),
          password: config.get('redis.password', { infer: true }),
          db: config.get('redis.db', { infer: true }),
          // BullMQ requires this; without it a blocked worker throws on reconnect.
          maxRetriesPerRequest: null,
        },
      }),
    }),
    ...ALL_QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  providers: [JobService, BackgroundTaskGate],
  exports: [JobService, BackgroundTaskGate, BullModule],
})
export class JobModule {}
