import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { UAParser } from 'ua-parser-js';
import { AUTH_COOKIE, type AuthDto } from '../../common/auth.types';
import { Auth, Authed, AuthedUserId } from '../../common/decorators';
import type { AppConfig } from '../../config/configuration';
import { AuthService, type LoginResult } from './auth.service';
import {
  AcceptInviteDto,
  ChangePasswordDto,
  ChangeVaultPinDto,
  CreateApiKeyDto,
  InviteDto,
  LoginDto,
  RefreshDto,
  SignUpDto,
  UpdateOAuthSettingsDto,
  VaultPinDto,
} from './auth.dto';
import { MailService } from '../../infra/mail/mail.service';
import { OAuthSettingsService } from './oauth-settings.service';
import { InvitationService } from './invitation.service';
import { OAuthService, type OAuthProvider } from './oauth.service';
import { VaultService } from './vault.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

@ApiTags('Authentication')
@Controller('auth')
@UseGuards(AuthRateLimitGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly oauthService: OAuthService,
    private readonly vaultService: VaultService,
    private readonly invitations: InvitationService,
    private readonly mail: MailService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private setAuthCookies(req: Request, res: Response, accessToken: string, refreshToken: string) {
    const secure =
      this.config.get('env', { infer: true }) === 'production' ||
      this.config.get('publicUrl', { infer: true }).startsWith('https') ||
      req.secure ||
      req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
    const base = { httpOnly: true, sameSite: 'strict', secure, path: '/' } as const;

    // The access cookie is what authenticates <img> and <video> requests, so in
    // development it has to last as long as the non-expiring token does —
    // otherwise thumbnails start 401ing while the app itself stays signed in.
    const persistent = this.config.get('auth.persistentSession', { infer: true });
    const accessMaxAge = persistent ? 400 * 86_400_000 : 30 * 60 * 1000;

    res.cookie(AUTH_COOKIE.ACCESS, accessToken, { ...base, maxAge: accessMaxAge });
    res.cookie(AUTH_COOKIE.REFRESH, refreshToken, {
      ...base,
      maxAge: persistent ? 400 * 86_400_000 : this.ttlMilliseconds('auth.refreshTtl', 60 * 86_400_000),
    });
  }

  private ttlMilliseconds(path: 'auth.refreshTtl', fallback: number) {
    const match = /^(\d+)(s|m|h|d)$/.exec(this.config.get(path, { infer: true }));
    if (!match) return fallback;
    const multiplier = ({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as Record<string, number>)[
      match[2]
    ];
    return Number(match[1]) * multiplier;
  }

  /** Browser credentials stay in HttpOnly cookies; native clients receive tokens for SecureStore. */
  private isBrowserRequest(req: Request) {
    // Fetch Metadata and the browser's User-Agent cannot be forged by page
    // JavaScript. The marker keeps older browsers on the cookie-only path.
    return (
      Boolean(req.header('sec-fetch-mode')) ||
      req.header('user-agent')?.includes('Mozilla/') === true ||
      req.header('x-imadeo-client') === 'web'
    );
  }

  private sessionResponse(req: Request, session: LoginResult) {
    return this.isBrowserRequest(req) ? { user: session.user } : session;
  }

  private internalReturnTo(value: string | undefined, fallback: string) {
    return value && /^\/(?!\/)/.test(value) && !value.includes('\\') ? value : fallback;
  }

  private deviceInfo(req: Request) {
    const ua = new UAParser(req.header('user-agent') ?? '');
    return {
      type: ua.getDevice().type ?? ua.getBrowser().name ?? 'unknown',
      os: ua.getOS().name ?? 'unknown',
      ip: req.ip ?? '',
    };
  }

  @Auth({ public: true })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange email and password for a session' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password, this.deviceInfo(req));
    this.setAuthCookies(req, res, result.accessToken, result.refreshToken);
    return this.sessionResponse(req, result);
  }

  @Auth({ public: true })
  @Get('registration')
  @ApiOperation({ summary: 'Whether this server currently accepts new sign-ups' })
  registration() {
    return this.authService.canRegister();
  }

  @Auth({ public: true })
  @Post('sign-up')
  @ApiOperation({
    summary: 'Create the first administrator and sign in',
    description:
      'Only available while the server has no accounts. Everyone else joins through an invitation.',
  })
  async signUp(@Body() dto: SignUpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { allowed } = await this.authService.canRegister();
    if (!allowed) {
      throw new BadRequestException(
        'This server is invitation only. Ask an administrator to invite you.',
      );
    }

    const user = await this.authService.register(dto.email, dto.password, dto.name);

    // Sign them straight in — asking someone to retype what they just entered
    // is pure friction.
    const session = await this.authService.loginWithUserId(user.id, this.deviceInfo(req));
    this.setAuthCookies(req, res, session.accessToken, session.refreshToken);
    return this.sessionResponse(req, session);
  }

  // -- invitations ----------------------------------------------------------

  @Auth({ public: true })
  @Get('invitations/:token')
  @ApiOperation({ summary: 'Describe an invitation so the register screen can prefill it' })
  describeInvitation(@Param('token') token: string) {
    return this.invitations.describe(token);
  }

  @Auth({ public: true })
  @Post('invitations/:token/accept')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Complete an invitation and sign in',
    description: 'The invited person chooses their own name and password here.',
  })
  async acceptInvitation(
    @Param('token') token: string,
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.invitations.accept({
      token,
      name: dto.name,
      password: dto.password,
    });

    const session = await this.authService.loginWithUserId(user.id, this.deviceInfo(req));
    this.setAuthCookies(req, res, session.accessToken, session.refreshToken);
    return this.sessionResponse(req, session);
  }

  @Auth({ admin: true })
  @Post('invitations')
  @ApiOperation({
    summary: 'Invite someone to this server',
    description:
      'Sends a link that lets the person set their own name and password. No credential ever travels by email.',
  })
  async invite(@Body() dto: InviteDto, @Authed() auth: AuthDto) {
    // Refused rather than quietly degraded: an invitation that cannot be
    // delivered is not an invitation, and silently handing back a link to pass
    // on by hand is a different thing from what was asked for.
    if (!this.mail.isConfigured) {
      throw new ServiceUnavailableException(
        'Email is not set up on this server yet. Add SMTP details under Settings → Email first.',
      );
    }

    return this.invitations.create({
      email: dto.email,
      invitedById: auth.user.id,
      inviterName: auth.user.name,
    });
  }

  @Auth()
  @Get('invitations')
  listInvitations(@AuthedUserId() userId: string) {
    return this.invitations.list(userId);
  }

  @Auth()
  @Delete('invitations/:id')
  @HttpCode(204)
  revokeInvitation(@AuthedUserId() userId: string, @Param('id') id: string) {
    return this.invitations.revoke(userId, id);
  }

  @Auth({ public: true })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? (req.cookies?.[AUTH_COOKIE.REFRESH] as string | undefined);
    if (!token) throw new UnauthorizedException('No refresh token supplied');

    const result = await this.authService.refresh(token);
    this.setAuthCookies(req, res, result.accessToken, result.refreshToken);
    return this.isBrowserRequest(req) ? { successful: true } : result;
  }

  @Auth()
  @Post('logout')
  @HttpCode(200)
  async logout(@Authed() auth: AuthDto, @Res({ passthrough: true }) res: Response) {
    if (auth.session) await this.authService.logout(auth.session.id);
    res.clearCookie(AUTH_COOKIE.ACCESS, { path: '/' });
    res.clearCookie(AUTH_COOKIE.REFRESH, { path: '/' });
    return { successful: true };
  }

  @Auth()
  @Post('logout-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign out every other device' })
  async logoutAll(@Authed() auth: AuthDto) {
    await this.authService.logoutAll(auth.user.id, auth.session?.id);
    return { successful: true };
  }

  @Auth()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Authed() auth: AuthDto, @Body() dto: ChangePasswordDto) {
    await this.authService.changePassword(auth.user.id, dto.password, dto.newPassword);
    return { successful: true };
  }

  @Auth()
  @Get('sessions')
  sessions(@Authed() auth: AuthDto) {
    return this.authService.listSessions(auth.user.id);
  }

  // -- identity providers ---------------------------------------------------

  @Auth({ public: true })
  @Get('providers')
  @ApiOperation({ summary: 'Which sign-in buttons this server can offer' })
  providers() {
    return this.oauthService.listProviders();
  }

  @Auth({ public: true })
  @Get('oauth/:provider/authorize')
  @ApiOperation({ summary: 'Begin sign-in; redirects the browser to the provider' })
  authorize(
    @Param('provider') provider: OAuthProvider,
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: Response,
  ) {
    this.assertProvider(provider);
    const { url } = this.oauthService.buildAuthorizeUrl(provider, this.internalReturnTo(returnTo, '/'));
    return res.redirect(url);
  }

  @Auth()
  @Get('oauth/:provider/link')
  @ApiOperation({ summary: 'Connect this provider to the signed-in account' })
  link(
    @Param('provider') provider: OAuthProvider,
    @Query('returnTo') returnTo: string | undefined,
    @AuthedUserId() userId: string,
    @Res() res: Response,
  ) {
    this.assertProvider(provider);
    const { url } = this.oauthService.buildAuthorizeUrl(
      provider,
      this.internalReturnTo(returnTo, '/settings?section=account'),
      userId,
    );
    return res.redirect(url);
  }

  @Auth()
  @Delete('oauth/link')
  @ApiOperation({ summary: 'Disconnect the linked provider account' })
  unlink(@AuthedUserId() userId: string) {
    return this.oauthService.unlink(userId);
  }

  /**
   * Google comes back with a GET, Apple with a form POST. Both land here.
   * The browser is redirected into the app carrying the tokens in the URL
   * fragment, which never leaves the client.
   */
  @Auth({ public: true })
  @Get('oauth/:provider/callback')
  googleCallback(
    @Param('provider') provider: OAuthProvider,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.completeOAuth(provider, { code, state, error }, req, res);
  }

  @Auth({ public: true })
  @Post('oauth/:provider/callback')
  appleCallback(
    @Param('provider') provider: OAuthProvider,
    @Body() body: { code?: string; state?: string; error?: string; user?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.completeOAuth(
      provider,
      { code: body.code ?? '', state: body.state ?? '', error: body.error, appleUser: body.user },
      req,
      res,
    );
  }

  private async completeOAuth(
    provider: OAuthProvider,
    input: { code: string; state: string; error?: string; appleUser?: string },
    req: Request,
    res: Response,
  ) {
    const appUrl = this.config.get('publicUrl', { infer: true });

    const fail = (message: string) =>
      res.redirect(`${appUrl}/login?error=${encodeURIComponent(message)}`);

    try {
      this.assertProvider(provider);

      if (input.error) {
        // The person pressed cancel on the provider's consent screen.
        return fail(
          input.error === 'access_denied' ? 'Sign-in was cancelled' : 'Sign-in was not completed',
        );
      }
      if (!input.code || !input.state) {
        return fail('The provider sent an incomplete response');
      }

      const { user, returnTo, linked } = await this.oauthService.handleCallback(
        provider,
        input.code,
        input.state,
        input.appleUser,
      );

      if (linked) {
        // The person was already signed in; connecting an account must not
        // hand out a second session or disturb the one they are using.
        return res.redirect(`${appUrl}${returnTo}${returnTo.includes('?') ? '&' : '?'}linked=${provider}`);
      }

      const session = await this.authService.loginWithUserId(user.id, this.deviceInfo(req));
      this.setAuthCookies(req, res, session.accessToken, session.refreshToken);

      const fragment = new URLSearchParams({ returnTo: this.internalReturnTo(returnTo, '/') });
      return res.redirect(`${appUrl}/auth/callback#${fragment}`);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : 'Sign-in failed';
      return fail(message);
    }
  }

  private assertProvider(provider: string): asserts provider is OAuthProvider {
    if (provider !== 'google' && provider !== 'apple') {
      throw new BadRequestException(`Unknown sign-in provider "${provider}"`);
    }
  }

  // -- API keys -------------------------------------------------------------

  @Auth()
  @Get('api-keys')
  listApiKeys(@Authed() auth: AuthDto) {
    return this.authService.listApiKeys(auth.user.id);
  }

  @Auth()
  @Post('api-keys')
  @ApiOperation({ summary: 'Create an API key. The secret is returned exactly once.' })
  createApiKey(@Authed() auth: AuthDto, @Body() dto: CreateApiKeyDto) {
    return this.authService.createApiKey(auth.user.id, dto.name, dto.permissions ?? []);
  }

  @Auth()
  @Delete('api-keys/:id')
  @HttpCode(204)
  deleteApiKey(@Authed() auth: AuthDto, @Param('id') id: string) {
    return this.authService.deleteApiKey(auth.user.id, id);
  }

  // -- vault ----------------------------------------------------------------

  @Auth()
  @Get('vault')
  vaultStatus(@Authed() auth: AuthDto) {
    return this.vaultService.status(auth.user.id, auth.session?.id);
  }

  @Auth()
  @Post('vault/pin')
  @ApiOperation({ summary: 'Set the vault PIN for the first time' })
  async setVaultPin(@Authed() auth: AuthDto, @Body() dto: VaultPinDto) {
    await this.vaultService.setPin(auth.user.id, dto.pin);
    return { successful: true };
  }

  @Auth()
  @Post('vault/pin/change')
  @HttpCode(200)
  async changeVaultPin(@Authed() auth: AuthDto, @Body() dto: ChangeVaultPinDto) {
    await this.vaultService.changePin(auth.user.id, dto.pin, dto.newPin);
    return { successful: true };
  }

  @Auth()
  @Post('vault/unlock')
  @HttpCode(200)
  unlockVault(@Authed() auth: AuthDto, @Body() dto: VaultPinDto) {
    if (!auth.session) throw new BadRequestException('Vault unlock requires a device session');
    return this.vaultService.unlock(auth.user.id, auth.session.id, dto.pin);
  }

  @Auth()
  @Post('vault/lock')
  @HttpCode(200)
  lockVault(@Authed() auth: AuthDto) {
    return this.vaultService.lock(auth.user.id, auth.session?.id);
  }
}

@ApiTags('Authentication (admin)')
@Auth({ admin: true })
@Controller('admin/oauth')
export class OAuthAdminController {
  constructor(private readonly settings: OAuthSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Google and Apple sign-in configuration, with secrets withheld' })
  get() {
    return this.settings.view();
  }

  @Put()
  @ApiOperation({ summary: 'Save credentials. Takes effect immediately, no restart needed.' })
  update(@Body() dto: UpdateOAuthSettingsDto) {
    return this.settings.save(dto);
  }
}
