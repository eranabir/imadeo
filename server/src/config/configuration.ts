import { join } from 'node:path';

const bool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const int = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const num = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * All runtime configuration in one place. `MEDIA_ROOT` is the single directory
 * that must be backed up — everything the server writes lives underneath it.
 */
export const configuration = () => {
  const mediaRoot = process.env.MEDIA_LOCATION ?? '/data';

  return {
    env: process.env.NODE_ENV ?? 'development',
    port: int(process.env.SERVER_PORT, 6666),
    publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:1111').replace(/\/$/, ''),
    logLevel: process.env.LOG_LEVEL ?? 'log',

    database: {
      url: process.env.DATABASE_URL ?? '',
    },

    redis: {
      host: process.env.REDIS_HOSTNAME ?? 'localhost',
      port: int(process.env.REDIS_PORT, 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      db: int(process.env.REDIS_DBINDEX, 0),
    },

    auth: {
      jwtSecret: process.env.JWT_SECRET ?? 'insecure-development-secret',
      accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: process.env.JWT_REFRESH_TTL ?? '60d',
      publicRegistration: bool(process.env.PUBLIC_REGISTRATION, false),
      // Local-only installations can use HTTP between devices on the same LAN
      // or a VPN. Never enable this when the API port is forwarded to the
      // internet: HTTP exposes account credentials and media in transit.
      localHttpEnabled: bool(process.env.LOCAL_HTTP_ENABLED, false),
      vaultMasterKey: process.env.VAULT_MASTER_KEY ?? '',
      /// How long a vault stays unlocked on a device after the private password is entered.
      vaultUnlockMinutes: int(process.env.VAULT_UNLOCK_MINUTES, 15),
      /// Create an account the first time an unknown identity signs in. When
      /// false only people who already have an account can use OAuth.
      // A configured identity provider proves an email address, not that the
      // person has been invited to this private server.
      oauthAutoRegister: bool(process.env.OAUTH_AUTO_REGISTER, false),

      /// Development convenience: issue access tokens with no `exp` claim and
      /// sessions that do not lapse, so a long day of work is never interrupted
      /// by the login screen.
      ///
      /// Hard-gated on NODE_ENV rather than on the flag alone. A token with no
      /// expiry is valid forever if it ever leaks, so it must be impossible to
      /// turn on in production even by setting the variable.
      persistentSession:
        process.env.NODE_ENV !== 'production' && bool(process.env.DEV_PERSISTENT_SESSION, true),
    },

    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: int(process.env.SMTP_PORT, 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
      from: process.env.SMTP_FROM ?? 'Imadeo <no-reply@imadeo.local>',
    },

    oauth: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      },
      apple: {
        /// The Services ID, not the app bundle id.
        clientId: process.env.APPLE_CLIENT_ID ?? '',
        teamId: process.env.APPLE_TEAM_ID ?? '',
        keyId: process.env.APPLE_KEY_ID ?? '',
        /// Contents of the .p8 file. Newlines may be escaped as \n in .env.
        privateKey: (process.env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
      },
    },

    storage: {
      root: mediaRoot,
      /// Every account owns one complete subtree below this directory.
      users: join(mediaRoot, 'users'),
      backups: join(mediaRoot, 'backups'),
      /// Template applied when moving an original out of `incoming`.
      template: process.env.STORAGE_TEMPLATE ?? '{{y}}/{{y}}-{{MM}}-{{dd}}/{{filename}}',
      maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 50 * 1024 * 1024 * 1024),
    },

    trash: {
      enabled: bool(process.env.TRASH_ENABLED, true),
      retentionDays: int(process.env.TRASH_RETENTION_DAYS, 30),
    },

    thumbnail: {
      /// Small square-ish image for grid tiles.
      thumbnailSize: int(process.env.THUMBNAIL_SIZE, 250),
      /// Larger image used by the detail viewer before the original loads.
      previewSize: int(process.env.PREVIEW_SIZE, 1440),
      quality: int(process.env.THUMBNAIL_QUALITY, 80),
      format: (process.env.THUMBNAIL_FORMAT ?? 'webp') as 'webp' | 'jpeg',
    },

    ffmpeg: {
      crf: int(process.env.FFMPEG_CRF, 23),
      preset: process.env.FFMPEG_PRESET ?? 'veryfast',
      targetResolution: int(process.env.FFMPEG_TARGET_RESOLUTION, 720),
      targetVideoCodec: process.env.FFMPEG_VIDEO_CODEC ?? 'h264',
      targetAudioCodec: process.env.FFMPEG_AUDIO_CODEC ?? 'aac',
      accel: process.env.FFMPEG_ACCEL ?? 'disabled',
      /// Skip transcoding when the original is already a web-playable h264/aac mp4.
      transcodePolicy: process.env.FFMPEG_TRANSCODE_POLICY ?? 'required',
    },

    geocoding: {
      /// Turning this off leaves latitude and longitude untouched and the map
      /// working; only the place *names* go, and with them the ability to search
      /// for a city. It is a switch because a lookup sends a photo's coordinates
      /// to a third party, which not every self-hoster will accept.
      enabled: bool(process.env.GEOCODING_ENABLED, true),
      url: process.env.GEOCODING_URL ?? 'https://nominatim.openstreetmap.org',
      /// Nominatim's policy is one request per second per application, enforced
      /// by blocking those that ignore it. Raise this, never lower it, unless
      /// you are pointing GEOCODING_URL at your own instance.
      minIntervalMs: int(process.env.GEOCODING_MIN_INTERVAL_MS, 1_100),
      /// The same policy requires an application to identify itself.
      userAgent: process.env.GEOCODING_USER_AGENT ?? 'Imadeo/0.1 (self-hosted photo server)',
      /// Place names come back in this language, so a photo from Tokyo reads
      /// "Tokyo" rather than "東京都" unless you would rather it did not.
      language: process.env.GEOCODING_LANGUAGE ?? 'en',
    },

    machineLearning: {
      enabled: bool(process.env.ML_ENABLED, true),
      url: process.env.ML_URL ?? 'http://localhost:3003',
      timeoutMs: int(process.env.ML_TIMEOUT_MS, 120_000),
      clipModel: process.env.ML_CLIP_MODEL ?? 'clip-ViT-B-32',
      faceModel: process.env.ML_FACE_MODEL ?? 'yunet+sface',
      faceMinScore: num(process.env.ML_FACE_MIN_SCORE, 0.7),
      videoRecognitionEnabled: bool(process.env.ML_VIDEO_RECOGNITION_ENABLED, true),
      videoSampleIntervalSeconds: int(process.env.ML_VIDEO_SAMPLE_INTERVAL_SECONDS, 30),
      videoMaxFrames: int(process.env.ML_VIDEO_MAX_FRAMES, 20),
      // Video frames are commonly blurred, partly off-screen, or contain face-like
      // patterns. Keep their acceptance stricter than deliberately taken photos.
      videoFaceMinScore: num(process.env.ML_VIDEO_FACE_MIN_SCORE, 0.9),
      videoFaceMinSharpness: num(process.env.ML_VIDEO_FACE_MIN_SHARPNESS, 0.5),
      videoPetMinScore: num(process.env.ML_VIDEO_PET_MIN_SCORE, 0.55),
      videoPetMinSharpness: num(process.env.ML_VIDEO_PET_MIN_SHARPNESS, 0.5),
      // YuNet is extremely confident on real human faces. Only its weaker,
      // animal-shaped candidates should be allowed through the CLIP pet fallback.
      petCandidateMaxFaceScore: num(process.env.ML_PET_CANDIDATE_MAX_FACE_SCORE, 0.88),
      // SFace keeps the same person close across photos, but a 0.50 limit
      // fragmented ordinary changes of angle and lighting into new people.
      faceClusterDistance: num(process.env.ML_FACE_CLUSTER_DISTANCE, 0.55),
      // Borderline matches are accepted only when the nearest subject is
      // unambiguous. This remains below SFace's published 0.637 distance.
      faceClusterRelaxedDistance: num(process.env.ML_FACE_CLUSTER_RELAXED_DISTANCE, 0.6),
      // Tighter than faces on purpose. Pets are matched on how they look rather
      // than on facial geometry, so a loose threshold folds every black cat in
      // the library into one animal.
      petClusterDistance: num(process.env.ML_PET_CLUSTER_DISTANCE, 0.12),
      /// A person is only surfaced in the UI once it has this many faces.
      faceMinCount: int(process.env.ML_FACE_MIN_COUNT, 3),
    },

    duplicates: {
      enabled: bool(process.env.DUPLICATE_DETECTION_ENABLED, true),
      /// Cosine distance under which two assets are considered near-duplicates.
      maxDistance: num(process.env.DUPLICATE_MAX_DISTANCE, 0.03),
    },

    jobs: {
      thumbnailConcurrency: int(process.env.JOB_THUMBNAIL_CONCURRENCY, 3),
      metadataConcurrency: int(process.env.JOB_METADATA_CONCURRENCY, 5),
      videoConcurrency: int(process.env.JOB_VIDEO_CONCURRENCY, 1),
      mlConcurrency: int(process.env.JOB_ML_CONCURRENCY, 1),
      uploadIdleMs: int(process.env.JOB_UPLOAD_IDLE_MS, 10_000),
    },
  };
};

export type AppConfig = ReturnType<typeof configuration>;
