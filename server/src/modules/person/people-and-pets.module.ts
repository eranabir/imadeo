import { Module } from '@nestjs/common';
import { PROCESSORS_AUTORUN } from '../../infra/job/job.constants';
import { FaceClusteringService } from './face-clustering.service';
import { FaceClusterProcessor, FaceDetectionProcessor } from './face.processor';
import { PeopleAndPetsController } from './person.controller';
import { SubjectService } from './subject.service';

@Module({
  controllers: [PeopleAndPetsController],
  providers: [
    SubjectService,
    FaceClusteringService,
    ...(PROCESSORS_AUTORUN ? [FaceDetectionProcessor, FaceClusterProcessor] : []),
  ],
  exports: [SubjectService, FaceClusteringService],
})
export class PeopleAndPetsModule {}
