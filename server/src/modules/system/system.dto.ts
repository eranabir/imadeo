import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateFaceRecognitionDto {
  @ApiPropertyOptional({ description: 'Whether this server scans new and existing photos for faces and pets' })
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateMailDto {
  @ApiPropertyOptional({ description: 'The address other people use to reach this server' })
  @IsOptional()
  @IsString()
  publicUrl?: string;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  user?: string;

  @ApiPropertyOptional({ description: 'Omit to keep the stored password unchanged' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ description: 'The From address, e.g. "Imadeo <me@example.com>"' })
  @IsOptional()
  @IsString()
  from?: string;
}

export class TestMailDto {
  @IsEmail()
  to!: string;
}
