import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, OAuthAdminController } from './auth.controller';
import { AuthService } from './auth.service';
import { InvitationService } from './invitation.service';
import { OAuthSettingsService } from './oauth-settings.service';
import { OAuthService } from './oauth.service';
import { VaultService } from './vault.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, OAuthAdminController],
  providers: [AuthService, OAuthService, OAuthSettingsService, VaultService, InvitationService],
  exports: [AuthService, OAuthService, OAuthSettingsService, VaultService, InvitationService],
})
export class AuthModule {}
