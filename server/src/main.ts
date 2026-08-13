import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { mkdir } from 'node:fs/promises';
import { AppModule } from './app.module';
import { AUTH_COOKIE } from './common/auth.types';
import type { AppConfig } from './config/configuration';
import { PrismaService } from './infra/prisma/prisma.service';
import { StorageService } from './infra/storage/storage.service';

// BigInt is used for file sizes and quotas; Express serialises with JSON.stringify.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

function isPrivateHttpUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:') return false;
    const parts = url.hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return url.hostname === 'localhost' || url.hostname.endsWith('.local');
    }
    const [first, second] = parts;
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  } catch {
    return false;
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isProduction = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<AppConfig, true>);
  const publicUrl = config.get('publicUrl', { infer: true });
  const localHttpEnabled = config.get('auth.localHttpEnabled', { infer: true });
  const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const browserOrigins =
    config.get('env', { infer: true }) === 'production' ? [publicUrl] : [publicUrl, ...developmentOrigins];

  if (config.get('env', { infer: true }) === 'production') {
    if (!publicUrl.startsWith('https://') && !localHttpEnabled) {
      throw new Error('PUBLIC_URL must use https:// in production. Refusing to expose private media over HTTP.');
    }
    const jwtSecret = config.get('auth.jwtSecret', { infer: true });
    if (jwtSecret === 'insecure-development-secret' || jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be a unique value of at least 32 characters in production.');
    }
  }

  app.setGlobalPrefix('api');
  // Production traffic passes through Caddy and the web proxy. Only those two
  // hops may supply a forwarded address; never trust a caller-provided header.
  app.set('trust proxy', config.get('env', { infer: true }) === 'production' ? 2 : 1);
  app.use(cookieParser());
  app.use((req: Request, res: Response, next: NextFunction) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const hasAuthCookie = Boolean(
      req.cookies?.[AUTH_COOKIE.ACCESS] || req.cookies?.[AUTH_COOKIE.REFRESH],
    );
    const hasBearerToken = /^Bearer\s+\S+/i.test(req.header('authorization') ?? '');
    const nativeClient =
      req.header('x-imadeo-client') === 'native' &&
      !req.header('origin') &&
      !req.header('referer');
    // CSRF applies only when a browser cookie is the credential. Native apps
    // authenticate with a bearer token; Android may still retain Set-Cookie
    // headers from an older login, but that must not turn it into a browser.
    if (!unsafe || !hasAuthCookie || hasBearerToken || nativeClient) return next();

    const origin = req.header('origin');
    const referer = req.header('referer');
    const allowedOrigin = browserOrigins.includes(origin ?? '');
    const allowedReferer = !origin && browserOrigins.some((allowed) => referer?.startsWith(`${allowed}/`));
    const localOrigin = localHttpEnabled && isPrivateHttpUrl(origin);
    const localReferer = !origin && localHttpEnabled && isPrivateHttpUrl(referer);
    if (allowedOrigin || allowedReferer || localOrigin || localReferer) {
      return next();
    }

    return res.status(403).json({ message: 'Cross-site request blocked' });
  });
  app.use(
    helmet({
      // Media is served from the same origin but embedded in <img>/<video>.
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: false,
    }),
  );
  app.enableCors({
    origin: [...browserOrigins, /^http:\/\/localhost:\d+$/],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      // Implicit conversion is deliberately OFF. It coerces query strings with
      // Boolean(), which turns "false" into true and would silently invert every
      // boolean filter. The DTOs declare explicit @Transform decorators instead.
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Every directory the server writes into must exist before the first upload.
  const storage = config.get('storage', { infer: true });
  await Promise.all(
    [
      storage.users,
      storage.backups,
    ].map((dir) => mkdir(dir, { recursive: true })),
  );

  // Backfill account directories for installations created before per-user
  // storage was introduced. This is idempotent on every boot.
  const prisma = app.get(PrismaService);
  const storageService = app.get(StorageService);
  const users = await prisma.user.findMany({ select: { id: true } });
  await Promise.all(users.map(({ id }) => storageService.ensureUserRoot(id)));

  const swagger = new DocumentBuilder()
    .setTitle('Imadeo API')
    .setDescription('Self-hosted photo and video backup')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api_key')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`Imadeo server listening on port ${port}`);
  logger.log(`API documentation at /api/docs`);

  if (config.get('auth.persistentSession', { infer: true })) {
    logger.warn(
      'Development sign-in is persistent: access tokens are issued without an expiry. ' +
        'This is disabled automatically when NODE_ENV=production.',
    );
  }
}

void bootstrap();
