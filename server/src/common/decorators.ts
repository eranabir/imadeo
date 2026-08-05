import {
  ExecutionContext,
  SetMetadata,
  UseGuards,
  applyDecorators,
  createParamDecorator,
} from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from './auth.guard';
import type { AuthDto } from './auth.types';

export const METADATA = {
  PUBLIC: 'imadeo:public',
  ADMIN: 'imadeo:admin',
  SHARED_LINK: 'imadeo:sharedLink',
  VAULT: 'imadeo:vault',
} as const;

export interface AuthOptions {
  /** No credentials required at all. */
  public?: boolean;
  /** Caller must be an administrator. */
  admin?: boolean;
  /** A public share key is an acceptable credential for this route. */
  sharedLink?: boolean;
  /** Route touches vault content, so the session must be unlocked. */
  vault?: boolean;
}

/**
 * Single entry point for route protection. Applied at the controller level and
 * narrowed per route where needed.
 */
export const Auth = (options: AuthOptions = {}) =>
  applyDecorators(
    SetMetadata(METADATA.PUBLIC, options.public ?? false),
    SetMetadata(METADATA.ADMIN, options.admin ?? false),
    SetMetadata(METADATA.SHARED_LINK, options.sharedLink ?? false),
    SetMetadata(METADATA.VAULT, options.vault ?? false),
    UseGuards(AuthGuard),
    ApiBearerAuth(),
    ApiSecurity('api_key'),
  );

/** Injects the resolved caller. Only valid on routes guarded by `@Auth`. */
export const Authed = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthDto => {
  const request = ctx.switchToHttp().getRequest<Request & { auth?: AuthDto }>();
  if (!request.auth) {
    throw new Error('@Authed() used on a route without @Auth()');
  }
  return request.auth;
});

/** Injects just the caller's user id — the common case. */
export const AuthedUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request & { auth?: AuthDto }>();
  if (!request.auth) {
    throw new Error('@AuthedUserId() used on a route without @Auth()');
  }
  return request.auth.user.id;
});
