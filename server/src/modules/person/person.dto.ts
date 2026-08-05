import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['1', 'true', 'yes'].includes(value.toLowerCase()) : value;

const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number.parseInt(String(value), 10);

export class AssetIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  assetIds!: string[];
}

export class CreateSubjectDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsIn(['PERSON', 'PET'])
  kind?: 'PERSON' | 'PET';
}

export class SetCoverDto {
  @IsUUID()
  assetId!: string;
}

export class PersonQueryDto {
  @ApiPropertyOptional({
    enum: ['PERSON', 'PET'],
    description: 'Limit to people or to pets. Omit for both.',
  })
  @IsOptional()
  @IsIn(['PERSON', 'PET'])
  kind?: 'PERSON' | 'PET';

  @ApiPropertyOptional({ description: 'Include people that have been hidden' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  withHidden?: boolean;

  @ApiPropertyOptional({
    description: 'Hide unnamed groups with fewer faces than this. Named people always show.',
  })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  minFaces?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  size?: number;
}

export class UpdatePersonDto {
  @ApiPropertyOptional({ description: 'Empty string clears the name again' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsString()
  color?: string;
}

export class MergePeopleDto {
  @ApiPropertyOptional({ description: 'The people folded into this one. They are then removed.' })
  @IsArray()
  @IsUUID('4', { each: true })
  sourceIds!: string[];
}

export class FaceIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  faceIds!: string[];
}

export class ReassignFacesDto extends FaceIdsDto {
  @IsUUID()
  personId!: string;
}
