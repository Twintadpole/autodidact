/**
 * Shrinks a phone photo before upload: longest side ≤ 1600 px, JPEG quality 0.8
 * (typically 200–500 KB instead of 3–8 MB). Keeps upright orientation.
 *
 * Runs in the page (no web worker: the library's worker downloads code from a
 * CDN, which fails offline). If the library can't read the file, falls back to
 * the browser's own decoder, then to uploading a plain JPEG/PNG/WebP as-is.
 */
const MAX_SIDE = 1600;
const DIRECT_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function compressPhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
    throw new Error(
      'this photo is in HEIC format, which the phone’s browser can’t read. Use the Camera button, or turn off “High efficiency pictures” in your camera settings.',
    );
  }
  try {
    const { default: imageCompression } = await import('browser-image-compression');
    const blob = await imageCompression(file, { maxWidthOrHeight: MAX_SIDE, initialQuality: 0.8, fileType: 'image/jpeg', useWebWorker: false });
    return { blob, ...(await dimensions(blob)) };
  } catch {
    // fall through to the browser's own decoder
  }
  try {
    return await canvasShrink(file);
  } catch {
    // fall through
  }
  if (DIRECT_UPLOAD_TYPES.includes(file.type) && file.size <= 12 * 1024 * 1024) {
    return { blob: file, ...(await dimensions(file).catch(() => ({ width: 0, height: 0 }))) };
  }
  throw new Error(`couldn’t read this image (${file.type || 'unknown type'}, ${Math.round(file.size / 1024)} KB)`);
}

async function dimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function canvasShrink(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  if (!blob) throw new Error('could not encode JPEG');
  return { blob, width, height };
}

export const thumbUrl = (id: string) => `/api/photos/${id}/thumb`;
export const photoUrl = (id: string) => `/api/photos/${id}`;
