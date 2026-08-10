import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { AUTH_COOKIE } from './common/auth.types';
import type { AppConfig } from './config/configuration';

// BigInt is used for file sizes and quotas; Express serialises with JSON.stringify.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isProduction = process.env.NODE_ENV === 'production';
  const certDirectory = [
    resolve(process.cwd(), '.dev/certs'),
    resolve(process.cwd(), '../.dev/certs'),
  ].find((directory) => existsSync(resolve(directory, 'localhost-key.pem')));
  const httpsOptions =
    !isProduction && certDirectory
      ? {
          key: readFileSync(resolve(certDirectory, 'localhost-key.pem')),
          cert: readFileSync(resolve(certDirectory, 'localhost.pem')),
        }
      : undefined;
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    ...(httpsOptions ? { httpsOptions } : {}),
  });
  const config = app.get(ConfigService<AppConfig, true>);
  const publicUrl = config.get('publicUrl', { infer: true });
  const developmentOrigins = ['https://localhost:5173', 'https://127.0.0.1:5173'];
  const browserOrigins =
    config.get('env', { infer: true }) === 'production' ? [publicUrl] : [publicUrl, ...developmentOrigins];

  if (config.get('env', { infer: true }) === 'production') {
    if (!publicUrl.startsWith('https://')) {
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
    if (!unsafe || !hasAuthCookie) return next();

    const origin = req.header('origin');
    const referer = req.header('referer');
    if (
      browserOrigins.includes(origin ?? '') ||
      (!origin && browserOrigins.some((allowed) => referer?.startsWith(`${allowed}/`)))
    ) {
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
      storage.upload,
      storage.incoming,
      storage.thumbs,
      storage.encodedVideo,
      storage.profile,
      storage.backups,
      storage.vault,
    ].map((dir) => mkdir(dir, { recursive: true })),
  );

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
