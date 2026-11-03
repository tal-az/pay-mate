import type { FlagKind } from '../shared/api';

export const FLAG_LABEL: Record<FlagKind, string> = {
  suspicious: 'עסקה חשודה',
  mistake: 'עסקה בטעות',
  attention: 'דורשת תשומת לב',
};

/** What a failed call says, without the prefix Electron adds to errors that cross the IPC boundary. */
export const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : fallback;
