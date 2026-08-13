import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AssetType, AssetVisibility } from '../../db';

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['1', 'true', 'yes'].includes(value.toLowerCase()) : value;

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number.parseInt(String(value), 10);

/** Multipart fields that accompany an upload. */
export class UploadAssetDto {
  @ApiPropertyOptional({ description: 'Stable id from the client library, for backup de-duplication' })
  @IsOptional()
  @IsString()
  deviceAssetId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsOptional()
  @IsDateString()
  fileCreatedAt?: string;

  @IsOptional()
  @IsDateString()
  fileModifiedAt?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional({ description: 'Put the upload straight into this folder' })
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional({
    description:
      'Path relative to the dropped directory, e.g. "2024/Iceland/img.jpg". Missing folders are created.',
  })
  @IsOptional()
  @IsString()
  relativePath?: string;

  @ApiPropertyOptional({ description: 'Add the upload to this album once processed' })
  @IsOptional()
  @IsUUID()
  albumId?: string;

  @ApiPropertyOptional({ description: 'Upload straight into the vault' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isLocked?: boolean;

  @ApiPropertyOptional({
    description:
      'Keep a second copy even when these exact bytes are already in the library. Off by default, so repeating a backup still dedupes.',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  allowDuplicate?: boolean;

  @IsOptional()
  @IsString()
  duration?: string;

  @ApiPropertyOptional({ description: 'sha1 of the file, lets the server reject a duplicate early' })
  @IsOptional()
  @IsString()
  checksum?: string;
}

export class UpdateAssetDto {
  @ApiPropertyOptional({
    description:
      'The name shown in the app. The file on disk keeps its own name, which the storage template owns.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalFileName?: string;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsIn([AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE])
  visibility?: AssetVisibility;

  @IsOptional()
  @IsDateString()
  dateTimeOriginal?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  rating?: number;

  @IsOptional()
  latitude?: number;

  @IsOptional()
  longitude?: number;

  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}

export class BulkUpdateAssetsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsIn([AssetVisibility.TIMELINE, AssetVisibility.ARCHIVE])
  visibility?: AssetVisibility;

  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}

export class BulkAssetIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ids!: string[];
}

/** Give existing accounts read-only access to one or more of your assets. */
export class ShareAssetsDto extends BulkAssetIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  userIds!: string[];
}

export class DeleteAssetsDto extends BulkAssetIdsDto {
  @ApiPropertyOptional({ description: 'Skip the trash and delete the files immediately' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  force?: boolean;
}

/** The one query object behind the timeline, search results and folder views. */
export class AssetQueryDto {
  @ApiPropertyOptional({ enum: ['owned', 'shared', 'all'], default: 'owned' })
  @IsOptional()
  @IsIn(['owned', 'shared', 'all'])
  ownership?: 'owned' | 'shared' | 'all';

  @IsOptional()
  @IsIn(Object.values(AssetType))
  type?: AssetType;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional({ enum: AssetVisibility })
  @IsOptional()
  @IsIn(Object.values(AssetVisibility))
  visibility?: AssetVisibility;

  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @IsUUID()
  albumId?: string;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsDateString()
  takenAfter?: string;

  @IsOptional()
  @IsDateString()
  takenBefore?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  lensModel?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: 'Substring match on the caption' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Exact star rating, 0 to 5' })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'Substring match on the stored path, e.g. a folder name' })
  @IsOptional()
  @IsString()
  path?: string;

  /** Filled in by the service from `path`; not accepted from the client. */
  folderIds?: string[];

  @ApiPropertyOptional({ description: 'Photos containing every one of these people or pets' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  subjectIds?: string[];

  /** Legacy query name retained for older clients. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  personIds?: string[];

  @ApiPropertyOptional({ description: 'Only photos that are in no album at all' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  notInAlbum?: boolean;

  @ApiPropertyOptional({ description: 'Substring match on the file name' })
  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  withPeople?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  withGeo?: boolean;

  @ApiPropertyOptional({ enum: ['date', 'added', 'name', 'size', 'rating'] })
  @IsOptional()
  @IsIn(['date', 'added', 'name', 'size', 'rating'])
  sortBy?: 'date' | 'added' | 'name' | 'size' | 'rating';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(1000)
  size?: number;
}

export class TimelineBucketDto {
  @ApiPropertyOptional({ description: 'Bucket key from /assets/timeline/buckets, e.g. "2024-06-01"' })
  @IsString()
  timeBucket!: string;

  @IsOptional()
  @IsIn(Object.values(AssetVisibility))
  visibility?: AssetVisibility;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsUUID()
  personId?: string;

  @IsOptional()
  @IsUUID()
  albumId?: string;
}

export class CheckDuplicateDto {
  @ApiPropertyOptional({ description: 'sha1 checksums the client is about to upload' })
  @IsArray()
  @IsString({ each: true })
  checksums!: string[];
}

export class StackAssetsDto {
  @IsUUID()
  primaryAssetId!: string;

  @IsArray()
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class MediaQueryDto {
  @ApiPropertyOptional({ enum: ['thumbnail', 'preview', 'original'] })
  @IsOptional()
  @IsIn(['thumbnail', 'preview', 'original'])
  size?: 'thumbnail' | 'preview' | 'original';

  @ApiPropertyOptional({ description: 'Share key, when viewing through a public link' })
  @IsOptional()
  @IsString()
  key?: string;
}

export class DownloadArchiveDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @Type(() => String)
  assetIds!: string[];

  @IsOptional()
  @IsString()
  name?: string;
}
