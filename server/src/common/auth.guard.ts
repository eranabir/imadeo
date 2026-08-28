import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from '../modules/auth/auth.service';
import { AUTH_COOKIE, AUTH_HEADER, type AuthDto } from './auth.types';
import { METADATA } from './decorators';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(METADATA.PUBLIC, targets);
    const requireAdmin = this.reflector.getAllAndOverride<boolean>(METADATA.ADMIN, targets);
    const allowSharedLink = this.reflector.getAllAndOverride<boolean>(METADATA.SHARED_LINK, targets);
    const requireVault = this.reflector.getAllAndOverride<boolean>(METADATA.VAULT, targets);

    const request = context.switchToHttp().getRequest<Request & { auth?: AuthDto }>();

    if (isPublic) {
      // Still attach an identity when one happens to be present, so public
      // endpoints can personalise their response.
      request.auth = (await this.tryAuthenticate(request, allowSharedLink)) ?? undefined;
      return true;
    }

    const auth = await this.tryAuthenticate(request, allowSharedLink);
    if (!auth) {
      throw new UnauthorizedException('Authentication required');
    }

    if (requireAdmin && !auth.user.isAdmin) {
      throw new ForbiddenException('Administrator access required');
    }

    if (requireVault) {
      const until = auth.session?.vaultUnlockedUntil;
      if (!until || until.getTime() < Date.now()) {
        throw new ForbiddenException({
          message: 'Locked is locked',
          code: 'VAULT_LOCKED',
        });
      }
    }

    request.auth = auth;
    return true;
  }

  private async tryAuthenticate(request: Request, allowSharedLink: boolean): Promise<AuthDto | null> {
    const apiKey = request.header(AUTH_HEADER.API_KEY);
    if (apiKey) {
      return this.authService.validateApiKey(apiKey);
    }

    if (allowSharedLink) {
      const shareKey =
        request.header(AUTH_HEADER.SHARED_LINK) ??
        (request.query.key as string | undefined) ??
        (request.cookies?.[AUTH_COOKIE.SHARED_LINK] as string | undefined);
      if (shareKey) {
        return this.authService.validateSharedLink(shareKey);
      }
    }

    const bearer = request.header('authorization')?.replace(/^Bearer /i, '');
    const token = bearer || (request.cookies?.[AUTH_COOKIE.ACCESS] as string | undefined);
    if (token) {
      return this.authService.validateAccessToken(token);
    }

    return null;
  }
}
