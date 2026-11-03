export interface Accent { key: string; name: string; color: string; hot: string }

export const ACCENTS: Accent[] = [
  { key: 'green', name: 'ירוק בהיר', color: '#8ee6a3', hot: '#e8458f' },
  { key: 'pink', name: 'ורוד', color: '#ffa8cf', hot: '#e8458f' },
  { key: 'yellow', name: 'צהוב', color: '#ffd23f', hot: '#ff7a6b' },
  { key: 'mint', name: 'מנטה', color: '#4fe3c9', hot: '#ff7a6b' },
  { key: 'sky', name: 'תכלת', color: '#8ec5ff', hot: '#e8458f' },
  { key: 'peach', name: 'אפרסק', color: '#ffb48a', hot: '#e8458f' },
  { key: 'lilac', name: 'לילך', color: '#c9b6ff', hot: '#e8458f' },
  { key: 'lime', name: 'ליים', color: '#c8ff2e', hot: '#ff7a6b' },
];

const KEY = 'paymate.accent';

export function currentAccent(): Accent {
  try {
    const saved = localStorage.getItem(KEY);
    return ACCENTS.find((a) => a.key === saved) ?? ACCENTS[0];
  } catch {
    return ACCENTS[0];
  }
}

/** Sets the accent colours on the page and remembers the choice on this device. */
export function applyAccent(accent: Accent, remember = false): void {
  const root = document.documentElement.style;
  root.setProperty('--tag', accent.color);
  root.setProperty('--tag-hot', accent.hot);
  if (!remember) return;
  try { localStorage.setItem(KEY, accent.key); } catch { /* the choice just won't persist */ }
}
