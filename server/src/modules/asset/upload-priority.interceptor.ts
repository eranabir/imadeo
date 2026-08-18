import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { finalize, type Observable } from 'rxjs';
import { BackgroundTaskGate } from '../../infra/job/background-task-gate.service';

/** Wraps Multer too, so ML yields while the request body is still reaching disk. */
@Injectable()
export class UploadPriorityInterceptor implements NestInterceptor {
  constructor(private readonly backgroundTasks: BackgroundTaskGate) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const finish = this.backgroundTasks.beginUpload();
    return next.handle().pipe(finalize(finish));
  }
}
