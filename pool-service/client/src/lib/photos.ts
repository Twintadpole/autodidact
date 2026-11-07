/**
 * Shrinks a phone photo before upload: longest side ≤ 1600 px, JPEG quality 0.8
 * (typically 200–500 KB instead of 3–8 MB). Keeps upright orientation.
 */
export async function compressPhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const { default: imageCompression } = await import('browser-image-compression');
  const blob = await imageCompression(file, {
    maxWidthOrHeight: 1600,
    initialQuality: 0.8,
    fileType: 'image/jpeg',
    useWebWorker: true,
  });
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return { blob, ...size };
}

export const thumbUrl = (id: string) => `/api/photos/${id}/thumb`;
export const photoUrl = (id: string) => `/api/photos/${id}`;
