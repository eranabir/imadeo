import { ApiPropertyOptional } from '@nestjs/swagger';
import { SharedLinkType } from '../../db';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateSharedLinkDto {
  @IsEnum(SharedLinkType)
  type!: SharedLinkType;

  @ApiPropertyOptional({ description: 'Required when type is ALBUM' })
  @IsOptional()
  @IsUUID()
  albumId?: string;

  @ApiPropertyOptional({ description: 'Required when type is INDIVIDUAL' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assetIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ description: 'Visitors must enter this to open the link' })
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  allowUpload?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDownload?: boolean;

  @IsOptional()
  @IsBoolean()
  showExif?: boolean;

  @ApiPropertyOptional({ description: 'Friendly URL segment, e.g. "iceland-2024"' })
  @IsOptional()
  @Matches(/^[a-z0-9-]{3,64}$/, { message: 'Slug may contain lowercase letters, numbers and dashes' })
  slug?: string;
}

export class UpdateSharedLinkDto {
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Empty string removes the password' })
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  allowUpload?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDownload?: boolean;

  @IsOptional()
  @IsBoolean()
  showExif?: boolean;
}

export class SharedLinkPasswordDto {
  @IsString()
  password!: string;
}
