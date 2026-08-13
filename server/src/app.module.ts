import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { configuration } from './config/configuration';
import { InfraModule } from './infra/infra.module';
import { JobModule } from './infra/job/job.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AlbumModule } from './modules/album/album.module';
import { AssetModule } from './modules/asset/asset.module';
import { AuthModule } from './modules/auth/auth.module';
import { FolderModule } from './modules/folder/folder.module';
import { PeopleAndPetsModule } from './modules/person/people-and-pets.module';
import { ShareModule } from './modules/share/share.module';
import { SystemModule } from './modules/system/system.module';
import { UserModule } from './modules/user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
      // In Docker the environment is injected; running locally the shared .env
      // sits at the repository root, one level above this workspace.
      envFilePath: ['.env', '../.env'],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    InfraModule,
    JobModule,
    AuthModule,
    UserModule,
    FolderModule,
    AlbumModule,
    AssetModule,
    PeopleAndPetsModule,
    ShareModule,
    SystemModule,
  ],
})
export class AppModule {}
