const MAX_EDGE = 480;
const JPEG_QUALITY = 0.74;
const DECODE_TIMEOUT_MS = 5_000;

async function withinDecodeTimeout<T>(operation: Promise<T>) {
  let timer: number | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error('Browser preview decoding timed out')),
          DECODE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

function drawToJpeg(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return Promise.resolve<Blob | null>(null);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
}

async function imageThumbnail(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await withinDecodeTimeout(image.decode());
    return drawToJpeg(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function videoThumbnail(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.src = url;
    await withinDecodeTimeout(new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('The browser cannot decode this video'));
      video.load();
    }));
    if (video.duration > 1.5) {
      video.currentTime = 1;
      await withinDecodeTimeout(new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error('The browser cannot seek this video'));
      }));
    }
    return drawToJpeg(video, video.videoWidth, video.videoHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Best-effort fast preview. Canonical derivatives are still made by the server. */
export async function createBrowserThumbnail(file: File): Promise<Blob | null> {
  try {
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      return await imageThumbnail(file);
    }
    if (file.type.startsWith('video/')) return await videoThumbnail(file);
  } catch {
    // HEIC, RAW and some MOV codecs are not browser-decodable. Their normal
    // server job remains queued and the UI keeps its processing placeholder.
  }
  return null;
}
