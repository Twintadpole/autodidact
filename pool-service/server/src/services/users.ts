import crypto from 'node:crypto';
import argon2 from 'argon2';
import type { Me, Role, TeamMember, TeamMemberFull } from '@pool/shared';
import { User } from '../models/index.js';
import { newId } from '../util.js';

/** Who is making a request (set by requireAuth). */
export interface Actor {
  userId: string;
  role: Role;
  name: string;
}
export const isOwner = (a: Actor | undefined) => a?.role === 'owner';

/* eslint-disable @typescript-eslint/no-explicit-any */
type UserDoc = Record<string, any>;

/** Per-account guard on top of the per-address limit: 10 wrong passwords → locked 15 minutes. */
const MAX_FAILED = 10;
const LOCK_MS = 15 * 60 * 1000;

/**
 * The first start after accounts arrive: today's single password becomes the first owner
 * (login name OWNER_EMAIL, else "owner"). Additive: nothing else changes, sessions stay valid.
 */
export async function ensureFirstOwner(passwordHash: string, ownerEmail?: string): Promise<void> {
  if (await User.exists({})) return;
  const now = new Date();
  await User.create({ _id: newId(), email: (ownerEmail || 'owner').toLowerCase(), name: 'Owner', role: 'owner', passwordHash, createdAt: now, updatedAt: now }).catch((err: { code?: number }) => {
    if (err?.code !== 11000) throw err; // another process made it first
  });
}
export async function firstOwnerId(): Promise<string | null> {
  const u = await User.findOne({ role: 'owner', active: true }).sort({ createdAt: 1 }).lean<UserDoc>();
  return u?._id ?? null;
}

let dummyHash: Promise<string> | undefined;
/** Checks a login. Same work whether or not the account exists, so timing doesn't tell. */
export async function verifyLogin(email: string, password: string): Promise<{ user: UserDoc } | { error: 'wrong' | 'locked' }> {
  dummyHash ??= argon2.hash(crypto.randomBytes(16).toString('hex'));
  const user = await User.findOne({ email: email.toLowerCase() }).lean<UserDoc>();
  const ok = await argon2.verify(user?.passwordHash ?? (await dummyHash), password).catch(() => false);
  if (!user || !user.active) return { error: 'wrong' };
  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) return { error: 'locked' };
  if (!ok) {
    const failed = (user.failedLogins ?? 0) + 1;
    await User.updateOne({ _id: user._id }, { $set: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MS) : null } });
    return { error: 'wrong' };
  }
  await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } });
  return { user };
}

const monthSeen = new Map<string, string>();
/** Records that this user was active this month (billing counts techs per month). Cheap: once per month per process. */
export async function touchActive(userId: string, now = new Date()): Promise<void> {
  const month = now.toISOString().slice(0, 7);
  if (monthSeen.get(userId) === month) return;
  monthSeen.set(userId, month);
  await User.updateOne({ _id: userId }, { $addToSet: { activeMonths: month } });
}

/** Their set of visible pools changed: the next pull on their phones is a full one. */
export async function bumpAccess(userIds: (string | null | undefined)[], at = new Date()): Promise<void> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length) await User.updateMany({ _id: { $in: ids } }, { $set: { accessChangedAt: at } });
}

/** A temporary password the owner reads out or texts: 12 letters and digits, no look-alikes. */
export function tempPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(12), (b) => chars[b % chars.length]).join('');
}
export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

export const toMe = (u: UserDoc): Me => ({ _id: u._id, email: u.email, name: u.name, role: u.role, mustChangePassword: !!u.mustChangePassword, language: u.language ?? null, onboardingTicks: u.onboardingTicks ?? [] });
export const toMember = (u: UserDoc): TeamMember => ({ _id: u._id, name: u.name, role: u.role, active: u.active !== false });
export const toMemberFull = (u: UserDoc): TeamMemberFull => ({
  ...toMember(u),
  email: u.email,
  lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
  activeMonths: u.activeMonths ?? [],
  mustChangePassword: !!u.mustChangePassword,
});
