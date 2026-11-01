import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { newId } from '../util.js';

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

  /** Move a temp file into its final place. */
  async place(tmp: string, rel: string): Promise<void> {
    const abs = this.absPath(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.rename(tmp, abs);
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
