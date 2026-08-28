import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Permission } from '../../db';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'me@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class SignUpDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  password!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class RefreshDto {
  @ApiPropertyOptional({ description: 'Omit when the refresh token is sent as a cookie' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class CreateApiKeyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ enum: Permission, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];
}

export class VaultPinDto {
  @ApiProperty({ description: 'Private password: at least 8 characters.' })
  @IsString()
  @MinLength(8, { message: 'The private password must be at least 8 characters' })
  pin!: string;
}

export class AcceptInviteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ description: 'Omit when joining with Google or Apple instead' })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;
}

export class ChangeVaultPinDto extends VaultPinDto {
  @ApiProperty({ description: 'New private password: at least 8 characters.' })
  @IsString()
  @MinLength(8, { message: 'The private password must be at least 8 characters' })
  newPin!: string;
}

export class InviteDto {
  @ApiProperty({ example: 'friend@example.com' })
  @IsEmail()
  email!: string;
}

class GoogleOAuthDto {
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Omit to keep the stored secret unchanged.' })
  @IsOptional()
  @IsString()
  clientSecret?: string;
}

class AppleOAuthDto {
  @ApiPropertyOptional({ description: 'The Services ID, not the app bundle id.' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  keyId?: string;

  @ApiPropertyOptional({ description: 'Contents of the .p8 file. Omit to keep the stored key.' })
  @IsOptional()
  @IsString()
  privateKey?: string;
}

export class UpdateOAuthSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => GoogleOAuthDto)
  google?: GoogleOAuthDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AppleOAuthDto)
  apple?: AppleOAuthDto;
}
