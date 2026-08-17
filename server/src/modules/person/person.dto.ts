import { ApiPropertyOptional } from '@nestjs/swagger';
import { SubjectKind } from '../../generated/prisma/enums';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
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

export class SubjectQueryDto {
  @ApiPropertyOptional({
    enum: ['PERSON', 'PET'],
    description: 'Limit to people or to pets. Omit for both.',
  })
  @IsOptional()
  @IsIn(['PERSON', 'PET'])
  kind?: 'PERSON' | 'PET';

  @ApiPropertyOptional({ description: 'Include people and pets that have been hidden' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  withHidden?: boolean;

  @ApiPropertyOptional({
    description: 'Hide unnamed groups below this size. Named people and pets always show.',
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

export class UpdateSubjectDto {
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

  /**
   * Moves a subject between People and Pets.
   *
   * Detection decides this and detection gets it wrong — a dog photographed
   * face-on is grouped with the people often enough to be worth a correction.
   * The faces, name and cover move with it. A pet-only species is cleared when
   * the group becomes a person.
   */
  @ApiPropertyOptional({ enum: SubjectKind })
  @IsOptional()
  @IsEnum(SubjectKind)
  kind?: SubjectKind;
}

export class MergeSubjectsDto {
  @ApiPropertyOptional({ description: 'The matching subjects folded into this one.' })
  @IsArray()
  @IsUUID('4', { each: true })
  sourceIds!: string[];
}

export class FaceIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  faceIds!: string[];
}

export class SubjectIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  subjectIds!: string[];
}

export class ReassignFacesDto extends FaceIdsDto {
  @IsUUID()
  personId!: string;
}
