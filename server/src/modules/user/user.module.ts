import { Module } from '@nestjs/common';
import { PROCESSORS_AUTORUN } from '../../infra/job/job.constants';
import { UserDeletionProcessor, UserDeletionService } from './user-deletion.service';
import { UserAdminController, UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController, UserAdminController],
  providers: [UserService, UserDeletionService, ...(PROCESSORS_AUTORUN ? [UserDeletionProcessor] : [])],
  exports: [UserService, UserDeletionService],
})
export class UserModule {}
