import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Prisma 7 connects through a driver adapter; the URL is supplied here
    // rather than in schema.prisma.
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: Number.parseInt(process.env.DB_POOL_MAX ?? '10', 10),
      }),
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * pgvector wants a `[1,2,3]` string literal. Prisma has no vector type, so
   * every embedding write funnels through here.
   */
  static toVector(values: number[]): string {
    return `[${values.join(',')}]`;
  }
}
