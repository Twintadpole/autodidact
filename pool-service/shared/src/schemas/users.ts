import { z } from 'zod';
import { BUSINESS_SETTINGS_ID } from './collections.js';
import { LANGUAGE_CODES, type LanguageCode } from '../languages.js';

/**
 * User accounts and roles (GPF item 3). An owner sees and does everything. A tech sees the field
 * work on their own route (pools assigned to them) and no money. The server enforces this on every
 * route and on sync; the app only hides what the server would refuse anyway.
 */
export const ROLES = ['owner', 'tech'] as const;
export type Role = (typeof ROLES)[number];

/** Login names are email addresses (the first owner of an app may still be "owner"). */
export const loginNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(200)
  .refine((v) => v === 'owner' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Use an email address');
export const passwordSchema = z.string().min(8, 'Use at least 8 characters').max(200);

export const loginBodySchema = z.object({
  email: loginNameSchema,
  password: z.string().min(1).max(200),
  remember: z.boolean().default(false),
});

export interface Me {
  _id: string;
  email: string;
  name: string;
  role: Role;
  /** Set after an owner resets the password: the app asks for a new one. */
  mustChangePassword: boolean;
  /** The app's language for this person (GPF item 5); null = the phone's own. */
  language: LanguageCode | null;
  /** Getting started steps this person ticked by hand (beta onboarding); follows them to any device. */
  onboardingTicks: string[];
}
/** What people change about themselves (My account). */
export const mePatchSchema = z.object({
  language: z.enum(LANGUAGE_CODES).nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  onboardingTicks: z.array(z.string().regex(/^[a-z]{2,20}$/)).max(20).optional(),
});
/** Team list (owner only), and the names every phone gets with each pull. */
export interface TeamMember {
  _id: string;
  name: string;
  role: Role;
  active: boolean;
}
export interface TeamMemberFull extends TeamMember {
  email: string;
  lastLoginAt: string | null;
  activeMonths: string[];
  mustChangePassword: boolean;
}
export const teamCreateSchema = z.object({
  email: loginNameSchema,
  name: z.string().trim().min(1).max(100),
  role: z.enum(ROLES).default('tech'),
});
export const teamPatchSchema = z.object({
  email: loginNameSchema.optional(),
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
});
export const changePasswordSchema = z.object({ current: z.string().min(1).max(200), password: passwordSchema });
export const assignPoolsSchema = z.object({ poolIds: z.array(z.string()).min(1).max(5000), techId: z.string().nullable() });

export interface Device {
  id: string;
  current: boolean;
  device: string;
  signedInAt: string | null;
  lastSeenAt: string | null;
}

// ---------------------------------------------------------------- what a tech never receives
/** Whole collections a tech never gets. */
export const OWNER_ONLY_COLLECTIONS = ['invoices', 'ledger'] as const;
/** Fields removed from what a tech gets (and ignored when a tech sends them). */
export const OWNER_ONLY_FIELDS = {
  customers: ['monthlyRate', 'billingEmail', 'paymentMethod', 'distanceMiles'],
  chemicals: ['price', 'priceUnit'],
} as const;
/** Business details a tech's phone needs (visit recaps); everything else in settings is the owner's. */
export const TECH_SETTINGS_FIELDS = ['_id', 'businessName', 'address', 'phone', 'email', 'logoDataUrl', 'createdAt', 'updatedAt', 'deletedAt'] as const;

/** The copy of a record a tech may see, or null if none of it. */
export function redactForTech(collection: string, doc: Record<string, any>): Record<string, any> | null {
  if ((OWNER_ONLY_COLLECTIONS as readonly string[]).includes(collection)) return null;
  if (collection === 'settings') {
    if (doc._id !== BUSINESS_SETTINGS_ID) return null;
    return Object.fromEntries(TECH_SETTINGS_FIELDS.filter((k) => k in doc).map((k) => [k, doc[k]]));
  }
  if (collection === 'visits') {
    return { ...doc, doses: (doc.doses ?? []).map(({ cost: _c, ...d }: Record<string, any>) => d) };
  }
  const hidden = (OWNER_ONLY_FIELDS as Record<string, readonly string[]>)[collection];
  if (!hidden) return doc;
  const out = { ...doc };
  for (const k of hidden) delete out[k];
  return out;
}
