import { api, ApiError } from '@/stores/api';
import { lang } from '@/i18n';

/**
 * "Send feedback" (beta). Sent straight away when there's signal; otherwise kept on this device and
 * sent when it's back online (each note has its own id, so a resend never makes a second copy).
 */
export type FeedbackKind = 'problem' | 'idea' | 'question' | 'other';
export interface FeedbackNote {
  _id: string;
  kind: FeedbackKind;
  text: string;
  screen?: string;
  appVersion: string;
  language: string;
  userAgent: string;
  createdAt: string;
}
export interface FeedbackItem extends Omit<FeedbackNote, 'userAgent'> {
  userName?: string;
  role?: string;
  doneAt?: string | null;
}

const KEY = 'pool.feedbackQueue';
const read = (): FeedbackNote[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as FeedbackNote[];
  } catch {
    return [];
  }
};
const write = (q: FeedbackNote[]) => {
  try {
    if (q.length) localStorage.setItem(KEY, JSON.stringify(q));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode
  }
};
export const waitingFeedback = () => read().length;

export function makeNote(kind: FeedbackKind, text: string, screen?: string): FeedbackNote {
  return {
    _id: crypto.randomUUID(),
    kind,
    text: text.trim(),
    ...(screen && { screen }),
    appVersion: __APP_VERSION__,
    language: lang.value,
    userAgent: navigator.userAgent.slice(0, 300),
    createdAt: new Date().toISOString(),
  };
}

/** 'sent', or 'queued' when there's no signal. Other errors (e.g. logged out) are thrown. */
export async function sendFeedback(note: FeedbackNote): Promise<'sent' | 'queued'> {
  try {
    await api('/feedback', { method: 'POST', body: note });
    return 'sent';
  } catch (e) {
    if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
      write([...read().filter((n) => n._id !== note._id), note]);
      return 'queued';
    }
    throw e;
  }
}

let flushing = false;
/** Sends what's waiting. Best effort; called at start and when the phone comes back online. */
export async function flushFeedback(): Promise<void> {
  if (flushing || !read().length) return;
  flushing = true;
  try {
    for (const note of read()) {
      try {
        await api('/feedback', { method: 'POST', body: note });
        write(read().filter((n) => n._id !== note._id));
      } catch (e) {
        // Bad note (refused): drop it rather than retry forever. No signal: try again later.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401) write(read().filter((n) => n._id !== note._id));
        else break;
      }
    }
  } finally {
    flushing = false;
  }
}

export const listFeedback = () => api<{ items: FeedbackItem[] }>('/feedback');
export const markFeedback = (id: string, done: boolean) => api(`/feedback/${id}`, { method: 'PATCH', body: { done } });
