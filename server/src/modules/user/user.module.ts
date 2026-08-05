import { Module } from '@nestjs/common';
import { UserAdminController, UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController, UserAdminController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
