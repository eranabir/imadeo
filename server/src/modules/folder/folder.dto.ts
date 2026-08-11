import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['1', 'true', 'yes'].includes(value.toLowerCase()) : value;

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ description: 'Omit to create a folder at the root' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class MoveFolderDto {
  @ApiPropertyOptional({ description: 'New parent. Null moves the folder to the root.' })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class FolderAssetsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class ShareFolderDto {
  @IsArray()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class FolderTreeQueryDto {
  @ApiPropertyOptional({ description: 'Include folders that live in the vault' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeLocked?: boolean;

  @ApiPropertyOptional({ description: 'Count assets in sub-folders too' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  recursiveCounts?: boolean;
}

export class FolderContentsQueryDto {
  @ApiPropertyOptional({ description: 'Also list assets from every sub-folder' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  recursive?: boolean;

  @ApiPropertyOptional({ enum: ['date', 'name', 'size', 'added'] })
  @IsOptional()
  @IsString()
  sortBy?: 'date' | 'name' | 'size' | 'added';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  order?: 'asc' | 'desc';

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value, 10))
  @IsInt()
  size?: number;
}

export class SetFolderLockDto {
  @Transform(toBool)
  @IsBoolean()
  isLocked!: boolean;
}
