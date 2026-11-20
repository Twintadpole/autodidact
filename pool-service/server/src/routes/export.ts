import { z } from 'zod';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type ExcelJS from 'exceljs';
import { addSheet, everythingWorkbook, newWorkbook, type CellType } from '../services/exportWorkbook.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileName = (s: string) => s.replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, 80) || 'export';

async function sendWorkbook(reply: FastifyReply, wb: ExcelJS.Workbook, name: string) {
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return reply.header('content-type', XLSX).header('content-disposition', `attachment; filename="${fileName(name)}.xlsx"`).header('cache-control', 'no-store').send(buf);
}

/** Excel exports (Phase 7E). Read only. */
export const exportRoutes: FastifyPluginAsync = async (parent) => {
  const app = parent.withTypeProvider<ZodTypeProvider>();

  /** Everything, one sheet per kind of record. */
  app.get('/export/everything.xlsx', { schema: { querystring: z.object({ tzOffsetMin: z.coerce.number().int().min(-840).max(840).default(0) }) } }, async (req, reply) => {
    const wb = await everythingWorkbook(req.query.tzOffsetMin);
    return sendWorkbook(reply, wb, `pool-service-everything-${new Date(Date.now() - req.query.tzOffsetMin * 60_000).toISOString().slice(0, 10)}`);
  });

  /** One table as the app shows it (a desktop table or a dashboard card), sent by the app. */
  app.post(
    '/export/table.xlsx',
    {
      bodyLimit: 20 * 1024 * 1024,
      schema: {
        body: z.object({
          name: z.string().trim().min(1).max(80),
          sheet: z.string().trim().max(31).optional(),
          columns: z.array(z.object({ header: z.string().max(80), type: z.enum(['text', 'number', 'money', 'date', 'datetime', 'yesno']).optional() })).min(1).max(60),
          rows: z.array(z.array(z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]))).max(50_000),
        }),
      },
    },
    async (req, reply) => {
      const { name, sheet, columns, rows } = req.body;
      const wb = newWorkbook();
      addSheet(wb, sheet || name, columns as { header: string; type?: CellType }[], rows, { naiveTimes: true });
      return sendWorkbook(reply, wb, name);
    },
  );
};
