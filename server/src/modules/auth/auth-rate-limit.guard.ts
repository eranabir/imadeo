import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

interface Limit {
  limit: number;
  windowMs: number;
  /** Include the submitted email/PIN target as well as the client address. */
  subject?: 'email' | 'ip';
}

/**
 * Small, intentionally local limiter for credential-bearing endpoints. Imadeo
 * runs one API process per self-hosted instance; when that changes this is the
 * one place to swap for a Redis-backed implementation.
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  private readonly limits: Record<string, Limit> = {
    'POST /api/auth/login': { limit: 10, windowMs: 15 * 60_000, subject: 'email' },
    'POST /api/auth/refresh': { limit: 30, windowMs: 15 * 60_000 },
    'POST /api/auth/sign-up': { limit: 5, windowMs: 60 * 60_000, subject: 'email' },
    'POST /api/auth/invitations/*/accept': { limit: 5, windowMs: 60 * 60_000 },
    'POST /api/auth/vault/unlock': { limit: 8, windowMs: 15 * 60_000, subject: 'ip' },
  };

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const path = new URL(request.originalUrl, 'http://localhost').pathname;
    const key = `${request.method.toUpperCase()} ${path}`;
    const rule = this.limits[key] ?? this.matchWildcard(key);
    if (!rule) return true;

    const now = Date.now();
    const ip = request.ip || 'unknown';
    const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
    const subjects = rule.subject === 'email' && email ? [ip, `email:${email}`] : [ip];

    for (const subject of subjects) {
      const bucketKey = `${key}:${subject}`;
      const recent = (this.attempts.get(bucketKey) ?? []).filter((time) => time > now - rule.windowMs);
      if (recent.length >= rule.limit) {
        throw new HttpException('Too many attempts. Please wait and try again.', HttpStatus.TOO_MANY_REQUESTS);
      }
      recent.push(now);
      this.attempts.set(bucketKey, recent);
    }

    return true;
  }

  private matchWildcard(key: string) {
    return Object.entries(this.limits).find(([pattern]) => {
      const expression = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '[^/]+')}$`);
      return expression.test(key);
    })?.[1];
  }
}
