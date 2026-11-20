import type { Unit } from '@pool/shared';
import { Chemical } from '../models/index.js';
import { newId } from '../util.js';

export const SEED_CHEMICALS: { name: string; defaultUnit: Unit }[] = [
  { name: 'Liquid chlorine', defaultUnit: 'gal' },
  { name: 'Cal-hypo', defaultUnit: 'lb' },
  { name: 'Trichlor tabs', defaultUnit: 'tabs' },
  { name: 'Muriatic acid', defaultUnit: 'fl oz' },
  { name: 'Sodium bicarb', defaultUnit: 'lb' },
  { name: 'Soda ash', defaultUnit: 'lb' },
  { name: 'Calcium chloride', defaultUnit: 'lb' },
  { name: 'CYA / stabilizer', defaultUnit: 'lb' },
  { name: 'Salt', defaultUnit: 'lb' },
  { name: 'Phosphate remover', defaultUnit: 'fl oz' },
  { name: 'Algaecide', defaultUnit: 'fl oz' },
];

/** Inserts the default chemicals the first time the server starts (empty collection). */
export async function seedChemicals(): Promise<number> {
  if ((await Chemical.estimatedDocumentCount()) > 0) return 0;
  const now = new Date();
  await Chemical.insertMany(
    SEED_CHEMICALS.map((c) => ({ ...c, _id: newId(), active: true, createdAt: now, updatedAt: now, deletedAt: null, syncedAt: now })),
  );
  return SEED_CHEMICALS.length;
}
