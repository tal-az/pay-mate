export type ProviderKey = 'isracard' | 'amex' | 'max' | 'visaCal';

export interface LoginField {
  name: 'id' | 'card6Digits' | 'username' | 'password';
  label: string;
  /** Digits only, with this exact length when set. */
  numeric?: boolean;
  length?: number;
  secret?: boolean;
}

export interface Provider {
  key: ProviderKey;
  name: string;
  fields: LoginField[];
}

const ID: LoginField = { name: 'id', label: 'תעודת זהות', numeric: true };
const CARD: LoginField = { name: 'card6Digits', label: '6 ספרות אחרונות של הכרטיס', numeric: true, length: 6 };
const USERNAME: LoginField = { name: 'username', label: 'שם משתמש' };
const PASSWORD: LoginField = { name: 'password', label: 'סיסמה לאתר', secret: true };

export const PROVIDERS: Provider[] = [
  { key: 'isracard', name: 'ישראכארט', fields: [ID, CARD, PASSWORD] },
  { key: 'amex', name: 'אמריקן אקספרס', fields: [ID, CARD, PASSWORD] },
  { key: 'max', name: 'מקס', fields: [USERNAME, PASSWORD] },
  { key: 'visaCal', name: 'כאל', fields: [USERNAME, PASSWORD] },
];

export function findProvider(key: unknown): Provider | undefined {
  return PROVIDERS.find((p) => p.key === key);
}
