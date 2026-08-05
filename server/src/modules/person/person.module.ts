import { Module } from '@nestjs/common';
import { FaceClusteringService } from './face-clustering.service';
import { FaceClusterProcessor, FaceDetectionProcessor } from './face.processor';
import { PersonController } from './person.controller';
import { PersonService } from './person.service';

@Module({
  controllers: [PersonController],
  providers: [
    PersonService,
    FaceClusteringService,
    FaceDetectionProcessor,
    FaceClusterProcessor,
  ],
  exports: [PersonService, FaceClusteringService],
})
export class PersonModule {}
