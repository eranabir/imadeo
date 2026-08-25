import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Prisma file sizes can appear in processor results and logs.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

async function bootstrapWorker() {
  if (process.env.IMADEO_ROLE !== 'worker') {
    throw new Error('The processing worker must start with IMADEO_ROLE=worker');
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  new Logger('Worker').log('Imadeo media-processing worker is ready');
}

void bootstrapWorker();
