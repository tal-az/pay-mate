const DAY_MS = 24 * 60 * 60 * 1000;

/** True when the last sync or import is more than a day old. */
export function isStale(lastUpdateIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastUpdateIso) return false;
  const at = Date.parse(lastUpdateIso);
  return Number.isFinite(at) && now.getTime() - at > DAY_MS;
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}
