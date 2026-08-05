import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import axios from 'axios';
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { UserStatus } from '../../db';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OAuthSettingsService } from './oauth-settings.service';

export type OAuthProvider = 'google' | 'apple';

interface ProviderProfile {
  subject: string;
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
}

interface JsonWebKey {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n?: string;
  e?: string;
}

const ENDPOINTS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
  },
  apple: {
    authorize: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    jwks: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    scope: 'name email',
  },
} as const;

/** How long a pending authorization request stays valid. */
const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  /**
   * Pending authorization requests, keyed by the `state` value. Held in memory
   * because they live for minutes and are worthless after a single use; a
   * restart mid-login simply asks the person to press the button again.
   */
  private readonly pending = new Map<
    string,
    {
      provider: OAuthProvider;
      nonce: string;
      returnTo: string;
      expiresAt: number;
      /**
       * Set when the round trip is "connect this provider to the account I am
       * already signed in as" rather than "sign me in". Carried through the
       * provider so the callback cannot be talked into linking a different
       * account than the one that started the request.
       */
      linkUserId?: string;
    }
  >();

  /** Cached provider signing keys, refreshed when an unknown `kid` shows up. */
  private readonly jwksCache = new Map<OAuthProvider, { keys: JsonWebKey[]; fetchedAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly settings: OAuthSettingsService,
  ) {}

  // -- availability ---------------------------------------------------------

  /** Credentials come from OAuthSettingsService, which merges the database over `.env`. */
  isConfigured(provider: OAuthProvider): boolean {
    const oauth = this.settings.get();
    if (provider === 'google') {
      return Boolean(oauth.google.clientId && oauth.google.clientSecret);
    }
    return Boolean(
      oauth.apple.clientId && oauth.apple.teamId && oauth.apple.keyId && oauth.apple.privateKey,
    );
  }

  listProviders() {
    return {
      google: this.isConfigured('google'),
      apple: this.isConfigured('apple'),
    };
  }

  private redirectUri(provider: OAuthProvider) {
    // Always routed through the public origin so the session cookie the
    // callback sets belongs to the same site the app is served from.
    return `${this.config.get('publicUrl', { infer: true })}/api/auth/oauth/${provider}/callback`;
  }

  // -- step 1: send the browser to the provider -----------------------------

  buildAuthorizeUrl(provider: OAuthProvider, returnTo = '/', linkUserId?: string) {
    if (!this.isConfigured(provider)) {
      throw new BadRequestException(
        `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured on this server`,
      );
    }

    this.pruneExpiredState();

    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    this.pending.set(state, {
      provider,
      nonce,
      returnTo,
      expiresAt: Date.now() + STATE_TTL_MS,
      linkUserId,
    });

    const oauth = this.settings.get();
    const params = new URLSearchParams({
      client_id: provider === 'google' ? oauth.google.clientId : oauth.apple.clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      scope: ENDPOINTS[provider].scope,
      state,
      nonce,
    });

    if (provider === 'apple') {
      // Apple only returns the name and email in the POST body, and only when
      // form_post is requested.
      params.set('response_mode', 'form_post');
    } else {
      params.set('access_type', 'offline');
      params.set('prompt', 'select_account');
    }

    return { url: `${ENDPOINTS[provider].authorize}?${params}`, state };
  }

  // -- step 2: the provider sends the browser back --------------------------

  async handleCallback(
    provider: OAuthProvider,
    code: string,
    state: string,
    appleUser?: string,
  ) {
    const request = this.pending.get(state);
    if (!request || request.provider !== provider || request.expiresAt < Date.now()) {
      throw new UnauthorizedException('This sign-in request expired. Please try again.');
    }
    // Single use: a replayed state must not mint a second session.
    this.pending.delete(state);

    const idToken = await this.exchangeCode(provider, code);
    const claims = await this.verifyIdToken(provider, idToken, request.nonce);

    const profile = this.toProfile(provider, claims, appleUser);

    if (request.linkUserId) {
      const user = await this.linkToUser(provider, profile, request.linkUserId);
      return { user, returnTo: request.returnTo, linked: true as const };
    }

    const user = await this.resolveUser(provider, profile);
    return { user, returnTo: request.returnTo, linked: false as const };
  }

  // -- linking an existing account ------------------------------------------

  /**
   * Attaches a provider identity to an account that is already signed in.
   *
   * Unlike `resolveUser` this never creates an account and never falls back to
   * matching on email — the caller has already proved who they are, and the
   * only question is whether this identity is free to claim.
   */
  private async linkToUser(provider: OAuthProvider, profile: ProviderProfile, userId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { oauthProvider_oauthId: { oauthProvider: provider, oauthId: profile.subject } },
      select: { id: true },
    });
    if (existing && existing.id !== userId) {
      throw new BadRequestException(
        `That ${provider === 'google' ? 'Google' : 'Apple'} account is already connected to another user`,
      );
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { oauthProvider: provider, oauthId: profile.subject },
    });
  }

  /**
   * Detaches the provider. Refused when there is no password to fall back on,
   * because that would leave the account with no way in at all.
   */
  async unlink(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { password: true, oauthProvider: true },
    });

    if (!user.oauthProvider) {
      throw new BadRequestException('No account is connected');
    }
    if (!user.password) {
      throw new BadRequestException(
        'Set a password first — disconnecting now would leave you locked out',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { oauthProvider: null, oauthId: null },
    });

    return { connected: null };
  }

  private async exchangeCode(provider: OAuthProvider, code: string): Promise<string> {
    const oauth = this.settings.get();

    const body = new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri(provider),
      client_id: provider === 'google' ? oauth.google.clientId : oauth.apple.clientId,
      client_secret:
        provider === 'google' ? oauth.google.clientSecret : await this.appleClientSecret(),
    });

    try {
      const { data } = await axios.post<{ id_token?: string }>(
        ENDPOINTS[provider].token,
        body.toString(),
        {
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          timeout: 15_000,
        },
      );
      if (!data.id_token) throw new Error('the provider did not return an id_token');
      return data.id_token;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : (error as Error).message;
      this.logger.error(`${provider} token exchange failed: ${detail}`);
      throw new UnauthorizedException('Could not complete sign-in with that provider');
    }
  }

  /**
   * Apple has no static client secret. It wants a short-lived ES256 JWT signed
   * with the private key downloaded from the developer portal.
   */
  private appleClientSecret() {
    const { apple } = this.settings.get();
    const now = Math.floor(Date.now() / 1000);

    return this.jwt.signAsync(
      {
        iss: apple.teamId,
        iat: now,
        exp: now + 300,
        aud: 'https://appleid.apple.com',
        sub: apple.clientId,
      },
      {
        algorithm: 'ES256',
        keyid: apple.keyId,
        privateKey: apple.privateKey,
      },
    );
  }

  // -- id_token verification ------------------------------------------------

  private async getSigningKey(provider: OAuthProvider, kid: string) {
    const cached = this.jwksCache.get(provider);
    // Providers rotate keys, so an unknown kid means refetch rather than fail.
    const stale = !cached || Date.now() - cached.fetchedAt > 3_600_000;
    const missing = !cached?.keys.some((key) => key.kid === kid);

    if (stale || missing) {
      const { data } = await axios.get<{ keys: JsonWebKey[] }>(ENDPOINTS[provider].jwks, {
        timeout: 10_000,
      });
      this.jwksCache.set(provider, { keys: data.keys, fetchedAt: Date.now() });
    }

    const key = this.jwksCache.get(provider)?.keys.find((k) => k.kid === kid);
    if (!key) throw new UnauthorizedException('Unknown signing key on the identity token');

    // jsonwebtoken (behind @nestjs/jwt) takes a PEM string, not a KeyObject.
    return createPublicKey({ key: key as object, format: 'jwk' })
      .export({ type: 'spki', format: 'pem' })
      .toString();
  }

  private async verifyIdToken(provider: OAuthProvider, idToken: string, nonce: string) {
    const header = JSON.parse(
      Buffer.from(idToken.split('.')[0], 'base64url').toString('utf8'),
    ) as { kid: string };

    const publicKey = await this.getSigningKey(provider, header.kid);
    const oauth = this.settings.get();
    const audience = provider === 'google' ? oauth.google.clientId : oauth.apple.clientId;

    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync(idToken, {
        publicKey,
        audience,
        issuer: [...ENDPOINTS[provider].issuers],
        algorithms: provider === 'google' ? ['RS256'] : ['RS256', 'ES256'],
      });
    } catch (error) {
      this.logger.error(`${provider} id_token rejected: ${(error as Error).message}`);
      throw new UnauthorizedException('The identity token from that provider was not valid');
    }

    // Binding the token to the nonce we generated stops a token minted for
    // another site being replayed here.
    if (claims.nonce !== nonce) {
      throw new UnauthorizedException('Sign-in response did not match the request');
    }

    return claims;
  }

  private toProfile(
    provider: OAuthProvider,
    claims: Record<string, unknown>,
    appleUser?: string,
  ): ProviderProfile {
    const email = String(claims.email ?? '').toLowerCase();
    if (!email) {
      throw new BadRequestException('That provider did not share an email address');
    }

    let name = String(claims.name ?? '').trim();

    // Apple sends the display name exactly once, in a JSON field beside the
    // code, and never again — so take it while it is there.
    if (provider === 'apple' && appleUser) {
      try {
        const parsed = JSON.parse(appleUser) as { name?: { firstName?: string; lastName?: string } };
        const parts = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean);
        if (parts.length > 0) name = parts.join(' ');
      } catch {
        // Malformed extra data is not worth failing a sign-in over.
      }
    }

    return {
      subject: String(claims.sub),
      email,
      name: name || email.split('@')[0],
      picture: typeof claims.picture === 'string' ? claims.picture : undefined,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    };
  }

  // -- account resolution ---------------------------------------------------

  private async resolveUser(provider: OAuthProvider, profile: ProviderProfile) {
    // 1. Someone who has signed in with this provider before.
    const linked = await this.prisma.user.findUnique({
      where: { oauthProvider_oauthId: { oauthProvider: provider, oauthId: profile.subject } },
    });
    if (linked) {
      if (linked.status !== UserStatus.ACTIVE || linked.deletedAt) {
        throw new UnauthorizedException('That account is no longer active');
      }
      return linked;
    }

    // 2. An existing local account with the same verified email — link them, so
    //    an admin who set up a password can later switch to Google.
    const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      if (!profile.emailVerified) {
        throw new UnauthorizedException(
          'That email already has an account, but the provider has not verified it',
        );
      }
      if (byEmail.status !== UserStatus.ACTIVE || byEmail.deletedAt) {
        throw new UnauthorizedException('That account is no longer active');
      }
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: { oauthProvider: provider, oauthId: profile.subject },
      });
    }

    // 3. Brand new person.
    if (!this.config.get('auth.oauthAutoRegister', { infer: true })) {
      throw new UnauthorizedException(
        'This server does not create accounts automatically. Ask an administrator for an invite.',
      );
    }

    const isFirstUser = (await this.prisma.user.count()) === 0;

    return this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        oauthProvider: provider,
        oauthId: profile.subject,
        // The very first person to sign in owns the server.
        isAdmin: isFirstUser,
        shouldChangePassword: false,
        storageLabel: this.storageLabelFor(profile.email),
      },
    });
  }

  /** A stable, filesystem-safe directory name derived from the email. */
  private storageLabelFor(email: string) {
    const base = email.split('@')[0].replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const suffix = createHash('sha1').update(email).digest('hex').slice(0, 6);
    return `${base || 'user'}-${suffix}`;
  }

  private pruneExpiredState() {
    const now = Date.now();
    for (const [state, request] of this.pending) {
      if (request.expiresAt < now) this.pending.delete(state);
    }
  }
}
