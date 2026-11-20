import { format, parseISO } from 'date-fns';

/** 3725 → "1:02:05", 125 → "2:05". */
export function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** 3725 → "1 h 2 min", 600 → "10 min". */
export function humanDuration(totalSeconds: number): string {
  const m = Math.round(totalSeconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const clock = (iso: string | null | undefined) => (iso ? format(parseISO(iso), 'h:mm a') : '…');

/** ISO → value for <input type="datetime-local"> in the phone's own time zone. */
export function toLocalInput(iso: string | null): string {
  return iso ? format(parseISO(iso), "yyyy-MM-dd'T'HH:mm") : '';
}

/** <input type="datetime-local"> value → ISO (UTC). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
