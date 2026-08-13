import { Module } from '@nestjs/common';
import { FaceClusteringService } from './face-clustering.service';
import { FaceClusterProcessor, FaceDetectionProcessor } from './face.processor';
import { PeopleAndPetsController } from './person.controller';
import { SubjectService } from './subject.service';

@Module({
  controllers: [PeopleAndPetsController],
  providers: [
    SubjectService,
    FaceClusteringService,
    FaceDetectionProcessor,
    FaceClusterProcessor,
  ],
  exports: [SubjectService, FaceClusteringService],
})
export class PeopleAndPetsModule {}
