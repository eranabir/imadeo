import { ApiPropertyOptional } from '@nestjs/swagger';
import { AlbumUserRole } from '../../db';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['1', 'true', 'yes'].includes(value.toLowerCase()) : value;

export class CreateAlbumDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  albumName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Folder to create the album in. Null puts it at the root.' })
  @IsOptional()
  @IsUUID()
  folderId?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  assetIds?: string[];

  @ApiPropertyOptional({ description: 'User ids to share the new album with' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlbumUserDto)
  albumUsers?: AlbumUserDto[];
}

export class AlbumUserDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsEnum(AlbumUserRole)
  role?: AlbumUserRole;
}

export class UpdateAlbumDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  albumName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  albumThumbnailAssetId?: string;

  @ApiPropertyOptional({ description: 'Move the album to a different folder' })
  @IsOptional()
  folderId?: string | null;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @IsBoolean()
  isActivityEnabled?: boolean;
}

export class AlbumAssetsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class UpdateAlbumUserDto {
  @IsEnum(AlbumUserRole)
  role!: AlbumUserRole;
}

export class InviteToAlbumDto {
  @ApiPropertyOptional({ description: 'An account is created if this address is unknown' })
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(AlbumUserRole)
  role?: AlbumUserRole;
}

export class AlbumQueryDto {
  @ApiPropertyOptional({ description: 'Only albums inside this folder' })
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional({ description: 'Only albums shared with me / by me' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  shared?: boolean;

  @ApiPropertyOptional({ description: 'Albums that contain this asset' })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeLocked?: boolean;
}

export class AlbumAssetsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsInt()
  size?: number;

  @IsOptional()
  @IsIn(['date', 'name', 'size', 'added'])
  sortBy?: 'date' | 'name' | 'size' | 'added';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class CreateActivityDto {
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsIn(['COMMENT', 'LIKE'])
  type!: 'COMMENT' | 'LIKE';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class SetAlbumLockDto {
  @Transform(toBool)
  @IsBoolean()
  isLocked!: boolean;
}
