import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MailOutbox } from '../models/index.js';

/**
 * Email (beta segment 4). Messages are queued in `mailOutbox`; the server's sender adds From and sends
 * them (deploy/mail.sh, gpf tenant.sh mail). The sender writes MAIL_READY in the backups folder when a
 * mailbox is set up, which is how the app knows email works.
 */
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

/** A plain-text message (no From: the sender adds it). */
const EMAIL = /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/;
export function buildMessage(to: string[], subject: string, text: string, replyTo?: string): string {
  const body = b64(text.replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
  return [
    `To: ${to.map(clean).join(', ')}`,
    ...(replyTo && EMAIL.test(replyTo) ? [`Reply-To: ${clean(replyTo)}`] : []),
    `Subject: ${encodeHeader(clean(subject))}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@greatpoolfriend>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

export async function queueMail(to: string[], subject: string, text: string, kind: string, flagDir?: string, replyTo?: string): Promise<void> {
  const list = to.map((t) => t.trim().toLowerCase()).filter((t) => /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(t));
  if (!list.length) return;
  await MailOutbox.create({ _id: crypto.randomUUID(), to: list, subject, raw: buildMessage(list, subject, text, replyTo), kind, createdAt: new Date() });
  // Tell the sender there is mail (it then reads the outbox; without the flag it looks only now and then).
  if (flagDir) {
    await fs.promises
      .mkdir(flagDir, { recursive: true })
      .then(() => fs.promises.writeFile(path.join(flagDir, 'pending'), new Date().toISOString()))
      .catch(() => undefined);
  }
}

/** True when the server's sender has a mailbox set up (it touches MAIL_READY at most ~1 day ago). */
export async function mailReady(backupDir: string | undefined): Promise<boolean> {
  if (!backupDir) return false;
  try {
    const st = await fs.promises.stat(path.join(backupDir, 'MAIL_READY'));
    return Date.now() - st.mtimeMs < 2 * 24 * 3600 * 1000;
  } catch {
    return false;
  }
}
