import { z } from 'zod';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { idSchema, importOptionsSchema, type ImportOptions } from '@pool/shared';
import { describeFile, MAX_IMPORT_BYTES, readImportFile, type ReadFile } from '../services/importRead.js';
import { applyImport, listImports, previewImport, undoImport } from '../services/importPlan.js';
import { HttpError } from '../util.js';

/**
 * Customer & pool import (GPF item 2). Every step sends the file again (multipart: `file`, plus an
 * `options` JSON field), so the server keeps nothing between steps and always plans from the file:
 *   POST /import/read      → sheets, headers, first rows, guessed column matching
 *   POST /import/preview   → what would be added and merged, conflicts, warnings (writes nothing)
 *   POST /import/apply     → does it, in one transaction; returns the import's id
 *   GET  /imports          → past imports
 *   POST /imports/:id/undo → hides what it added and puts back what it changed
 */
async function readUpload(req: FastifyRequest, needOptions: boolean): Promise<{ file: ReadFile; fileName: string; options: ImportOptions }> {
  if (!req.isMultipart()) throw new HttpError(400, 'Send the file as multipart/form-data');
  let buf: Buffer | undefined;
  let fileName = '';
  let options: unknown = needOptions ? undefined : { mapping: [] };
  for await (const part of req.parts({ limits: { fileSize: MAX_IMPORT_BYTES + 1 } })) {
    if (part.type === 'file' && part.fieldname === 'file') {
      buf = await part.toBuffer();
      fileName = part.filename.slice(0, 200);
      if (part.file.truncated || buf.length > MAX_IMPORT_BYTES) throw new HttpError(413, 'The file is larger than 5 MB. Split it into smaller files.');
    } else if (part.type === 'field' && part.fieldname === 'options') {
      try {
        options = JSON.parse(String(part.value));
      } catch {
        throw new HttpError(400, 'Field "options" is not valid JSON');
      }
    }
  }
  if (!buf) throw new HttpError(400, 'No file');
  const parsed = importOptionsSchema.safeParse(options);
  if (!parsed.success) throw new HttpError(400, `Bad options: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
  return { file: await readImportFile(buf, fileName), fileName, options: parsed.data };
}

export const importRoutes: FastifyPluginAsync = async (app) => {
  app.post('/import/read', async (req) => {
    const { file, fileName } = await readUpload(req, false);
    return describeFile(file, fileName);
  });
  app.post('/import/preview', async (req) => {
    const { file, options } = await readUpload(req, true);
    return previewImport(file, options);
  });
  app.post('/import/apply', async (req) => {
    const { file, fileName, options } = await readUpload(req, true);
    return applyImport(file, options, fileName);
  });
  app.get('/imports', async () => listImports());
  app.post('/imports/:id/undo', async (req) => {
    const { id } = z.object({ id: idSchema }).parse(req.params);
    return undoImport(id);
  });
};
