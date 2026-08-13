import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import type { AppConfig } from '../../config/configuration';
import { FaceRecognitionSettingsService } from './face-recognition-settings.service';

export interface DetectedFace {
  boundingBox: { x1: number; y1: number; x2: number; y2: number };
  score: number;
  embedding: number[];
  yaw: number | null;
}

export interface FaceDetectionResult {
  imageWidth: number;
  imageHeight: number;
  faces: DetectedFace[];
}

export interface DetectedPet {
  boundingBox: { x1: number; y1: number; x2: number; y2: number };
  score: number;
  /** "cat" or "dog". */
  label: string;
  embedding: number[];
}

export interface PetDetectionResult {
  imageWidth: number;
  imageHeight: number;
  pets: DetectedPet[];
}

export interface PetFaceCandidate {
  label: string;
  score: number;
  embedding: number[];
}

@Injectable()
export class MachineLearningService {
  private readonly logger = new Logger(MachineLearningService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly faceRecognition: FaceRecognitionSettingsService,
  ) {
    this.http = axios.create({
      baseURL: this.config.get('machineLearning.url', { infer: true }),
      timeout: this.config.get('machineLearning.timeoutMs', { infer: true }),
      // A batch of faces with 512 floats each is larger than the default cap.
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  }

  get enabled() {
    return this.config.get('machineLearning.enabled', { infer: true });
  }

  /** Face and pet scans can be paused without disabling visual search. */
  get faceRecognitionEnabled() {
    return this.faceRecognition.enabled;
  }

  /** Whether the service is up and has finished loading its model. */
  async isReady(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const { data } = await this.http.get<{ status: string }>('/health', { timeout: 5_000 });
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  async isFaceRecognitionReady(): Promise<boolean> {
    if (!this.faceRecognitionEnabled) return false;
    try {
      const { data } = await this.http.get<{ status: string }>('/health', { timeout: 5_000 });
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Detects faces in an image on disk.
   *
   * The *preview* is sent rather than the original: it is already downscaled, so
   * this avoids pushing a 60 MB file over the wire, and detection at ~1440px is
   * as accurate as it needs to be for grouping. Bounding boxes come back in the
   * preview's coordinate space, which is why that space is stored alongside them.
   */
  async detectFaces(path: string): Promise<FaceDetectionResult | null> {
    if (!this.faceRecognitionEnabled) return null;

    const stream = createReadStream(path);

    try {
      // `postForm` with a stream lets axios build the multipart body without
      // reading the whole file into memory first.
      const { data } = await this.http.postForm<FaceDetectionResult>('/predict/faces', {
        image: stream,
      });
      return data;
    } catch (error) {
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : (error as Error).message;
      this.logger.warn(`Face detection failed for ${basename(path)}: ${detail}`);
      throw error;
    } finally {
      stream.destroy();
    }
  }

  /**
   * Finds cats and dogs. Returns null when the server has pet recognition
   * switched off, which is a supported configuration rather than a fault — the
   * models are large and not everyone wants them.
   */
  async detectPets(path: string): Promise<PetDetectionResult | null> {
    if (!this.faceRecognitionEnabled) return null;

    const stream = createReadStream(path);

    try {
      const { data } = await this.http.postForm<PetDetectionResult>('/predict/pets', {
        image: stream,
      });
      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 503) {
        // Not configured. Said once at debug level rather than warned about for
        // every photo in the library.
        this.logger.debug('Pet recognition is not available on the ML service');
        return null;
      }
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : (error as Error).message;
      this.logger.warn(`Pet detection failed for ${basename(path)}: ${detail}`);
      throw error;
    } finally {
      stream.destroy();
    }
  }

  /**
   * YuNet can find a cat's face when the whole-animal detector misses a close
   * crop. Ask the pet model whether that particular face-shaped crop is a cat
   * or dog before storing it as a person.
   */
  async classifyPetFaceCandidate(
    path: string,
    boundingBox: { x1: number; y1: number; x2: number; y2: number },
  ): Promise<PetFaceCandidate | null> {
    const stream = createReadStream(path);
    try {
      const { data } = await this.http.postForm<{ pet: PetFaceCandidate | null }>(
        '/predict/pets/candidate',
        { image: stream, ...boundingBox },
      );
      return data.pet;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 503) return null;
      const detail = axios.isAxiosError(error)
        ? JSON.stringify(error.response?.data ?? error.message)
        : (error as Error).message;
      this.logger.warn(`Pet candidate classification failed for ${basename(path)}: ${detail}`);
      throw error;
    } finally {
      stream.destroy();
    }
  }

  /** A 512-d embedding describing the contents of one picture. */
  async encodeImage(path: string): Promise<number[] | null> {
    if (!this.enabled) return null;
    const stream = createReadStream(path);
    try {
      const { data } = await this.http.postForm<{ embedding: number[] }>('/encode/image', {
        image: stream,
      });
      return data.embedding;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 503) return null;
      this.logger.warn(`Encoding failed for ${basename(path)}: ${(error as Error).message}`);
      return null;
    } finally {
      stream.destroy();
    }
  }

  /** The same space as `encodeImage`, so a phrase can be matched against photos. */
  async encodeText(text: string): Promise<number[] | null> {
    if (!this.enabled) return null;
    try {
      const { data } = await this.http.post<{ embedding: number[] }>('/encode/text', { text });
      return data.embedding;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 503) return null;
      this.logger.warn(`Encoding text failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Whether the loaded ML service actually has the pet models. */
  async hasPets(): Promise<boolean> {
    try {
      const { data } = await this.http.get<{ pets?: { loaded?: boolean } }>('/health');
      return Boolean(data.pets?.loaded);
    } catch {
      return false;
    }
  }
}
