import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

// BigInt is used for file sizes and quotas; Express serialises with JSON.stringify.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<AppConfig, true>);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(
    helmet({
      // Media is served from the same origin but embedded in <img>/<video>.
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: false,
    }),
  );
  app.enableCors({
    origin: [config.get('publicUrl', { infer: true }), /^http:\/\/localhost:\d+$/],
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

  /**
   * Serves the built web client from this same process when it is present.
   *
   * A packaged install is then a single container rather than an app image plus
   * a separate web server, which matters most on a NAS: one thing to start, one
   * port to forward, and no reverse proxy to configure before anything renders.
   *
   * Absent in development, where Vite serves the client on its own port — hence
   * the existence check rather than an unconditional mount.
   */
  const clientDir = join(__dirname, '..', 'www');
  if (existsSync(clientDir)) {
    app.useStaticAssets(clientDir, { index: false, maxAge: '1y' });

    // A client-side route is not a file on disk. Without this, a refresh on
    // /albums/<id> looks for that path, finds nothing and 404s before React
    // ever loads. Everything under /api is left alone so a genuinely unknown
    // endpoint still returns a 404 instead of a page of HTML.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(clientDir, 'index.html'));
    });

    logger.log(`Serving the web client from ${clientDir}`);
  }

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
