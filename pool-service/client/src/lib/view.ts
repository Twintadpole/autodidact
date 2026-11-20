/**
 * Phone or desktop view, remembered on each device (Phase 7D). The owner picks it:
 * More → Desktop view, and "Phone view" in the desktop menu.
 */
const KEY = 'pool:view';
export type View = 'phone' | 'desk';

export function savedView(): View {
  try {
    return localStorage.getItem(KEY) === 'desk' ? 'desk' : 'phone';
  } catch {
    return 'phone';
  }
}
export function saveView(v: View) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // private mode: the choice just isn't remembered
  }
}
