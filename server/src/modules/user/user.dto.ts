import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'Bytes. Omit or null for unlimited.' })
  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : BigInt(value)))
  quotaSizeInBytes?: bigint | null;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  @ApiPropertyOptional({ description: 'Used as the top-level directory name for this user.' })
  @IsOptional()
  @IsString()
  storageLabel?: string;

  @IsOptional()
  @IsBoolean()
  shouldChangePassword?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : BigInt(value)))
  quotaSizeInBytes?: bigint | null;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  @IsOptional()
  @IsString()
  storageLabel?: string;

  @IsOptional()
  @IsBoolean()
  shouldChangePassword?: boolean;
}

/**
 * What a user may change about their own account.
 *
 * Deliberately a separate, much smaller shape than UpdateUserDto: routing self
 * edits through the admin DTO would let anyone grant themselves `isAdmin` or
 * lift their own quota.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}

export class ConfirmEmailChangeDto {
  @IsString()
  @MinLength(10)
  token!: string;
}

/** Client-side settings the server only stores and echoes back. */
export class UpdatePreferencesDto {
  @ApiPropertyOptional({ enum: ['light', 'dark', 'system'] })
  @IsOptional()
  @IsIn(['light', 'dark', 'system'])
  theme?: 'light' | 'dark' | 'system';

  @ApiPropertyOptional({ description: 'Grid tile target height in px' })
  @IsOptional()
  @IsInt()
  @Min(60)
  tileSize?: number;

  @IsOptional()
  @IsBoolean()
  showAssetsInSubfolders?: boolean;

  @IsOptional()
  @IsIn(['justified', 'grid'])
  timelineLayout?: 'justified' | 'grid';

  @IsOptional()
  @IsBoolean()
  autoplayVideos?: boolean;

  @IsOptional()
  @IsBoolean()
  loopVideos?: boolean;

  @IsOptional()
  @IsIn(['original', 'transcoded'])
  videoQuality?: 'original' | 'transcoded';

  @IsOptional()
  @IsBoolean()
  showMemories?: boolean;

  @IsOptional()
  @IsString()
  locale?: string;
}
