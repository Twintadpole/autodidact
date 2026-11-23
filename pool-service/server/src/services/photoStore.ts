import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { HttpError, newId } from '../util.js';

/**
 * Photos live at PHOTO_DIR/YYYY/MM/<photoId>.jpg. Thumbnails (Phase 5, sharp)
 * will sit next to them as <photoId>.thumb.jpg.
 */
export class PhotoStore {
  constructor(public readonly root: string) {}

  relPath(photoId: string, takenAt: Date): string {
    const yyyy = String(takenAt.getUTCFullYear());
    const mm = String(takenAt.getUTCMonth() + 1).padStart(2, '0');
    return path.posix.join(yyyy, mm, `${photoId}.jpg`);
  }

  thumbRelPath(rel: string): string {
    return rel.replace(/\.jpg$/, '.thumb.jpg');
  }

  absPath(rel: string): string {
    const abs = path.resolve(this.root, rel);
    if (!abs.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Path escapes photo directory');
    return abs;
  }

  /** Stream an upload to a temp file; returns its absolute path. */
  async writeTemp(stream: Readable): Promise<string> {
    const dir = path.join(this.root, '.tmp');
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `${newId()}.part`);
    await pipeline(stream, createWriteStream(tmp));
    return tmp;
  }

  /**
   * Saves an upload in its final place as a clean JPEG (security hardening, Nov 23): the picture is
   * decoded and written again, so only a real image is kept, it is turned upright, and anything
   * hidden in the file (GPS location, camera details, other data) is dropped. Not a picture: 400.
   */
  async place(tmp: string, rel: string): Promise<void> {
    const abs = this.absPath(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const part = `${abs}.part`;
    try {
      await sharp(tmp, { failOn: 'error', limitInputPixels: 100_000_000 }).rotate().jpeg({ quality: 88 }).toFile(part);
    } catch {
      await fs.rm(part, { force: true });
      throw new HttpError(400, 'A photo file is not a picture');
    } finally {
      await fs.rm(tmp, { force: true });
    }
    await fs.rename(part, abs);
  }

  /**
   * Writes the 400 px thumbnail next to the image. Also applies the photo's EXIF
   * rotation so thumbnails are upright. Never throws: a missing thumbnail falls
   * back to the original when served.
   */
  async makeThumb(rel: string): Promise<boolean> {
    try {
      await sharp(this.absPath(rel))
        .rotate()
        .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toFile(this.absPath(this.thumbRelPath(rel)));
      return true;
    } catch {
      return false;
    }
  }

  async remove(absOrTmp: string): Promise<void> {
    await fs.rm(absOrTmp, { force: true });
  }

  async exists(rel: string): Promise<boolean> {
    return fs
      .access(this.absPath(rel))
      .then(() => true)
      .catch(() => false);
  }
}
