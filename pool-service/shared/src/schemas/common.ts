import { z } from 'zod';

/** Client-generated record ID (UUID, v7 preferred so IDs sort by creation time). */
export const idSchema = z.uuid();

/** Accepts ISO strings or Date objects (JSON over the wire, Date in Mongo). */
export const dateSchema = z.coerce.date();

/** E.164 phone number, e.g. +15125550123. */
export const e164Schema = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format, e.g. +15125550123');

/** Fields every stored document carries. */
export const baseDocFields = {
  _id: idSchema,
  createdAt: dateSchema,
  updatedAt: dateSchema,
  deletedAt: dateSchema.nullable().default(null),
};

export const addressSchema = z.object({
  line1: z.string().trim().min(1),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
  zip: z.string().trim().min(1),
});
export type Address = z.infer<typeof addressSchema>;

export const SERVICE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ServiceDay = (typeof SERVICE_DAYS)[number];

export const UNITS = ['lb', 'oz', 'fl oz', 'gal', 'tabs'] as const;
export type Unit = (typeof UNITS)[number];

/**
 * Builds the three schemas each collection needs:
 *  - `doc`: a full stored document (used in sync packages and pull responses)
 *  - `create`: body for POST (client may supply its own `_id`)
 *  - `patch`: body for PATCH (any subset of fields)
 */
export function collectionSchemas<T extends z.ZodRawShape>(fields: T) {
  const fieldsObject = z.object(fields);
  return {
    fields: fieldsObject,
    doc: fieldsObject.extend(baseDocFields),
    create: fieldsObject.extend({ _id: idSchema.optional() }),
    patch: z.object(withoutDefaults(fields)).partial() as unknown as z.ZodObject<{
      [K in keyof T]: z.ZodOptional<T[K]>;
    }>,
  };
}

/**
 * Zod 4 applies `.default()` values even inside `.partial()`, which would make
 * a PATCH of one field reset every defaulted field. Strip top-level defaults
 * so omitted fields stay omitted.
 */
function withoutDefaults(shape: z.ZodRawShape): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema instanceof z.ZodDefault ? schema.unwrap() : schema]),
  ) as z.ZodRawShape;
}
