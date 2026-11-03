import { BackupError } from './backup';

/**
 * Password protection for backup files. The user only ever types a password: a fresh random salt turns it into an
 * AES-256 key with PBKDF2, and the key is thrown away after use. Nothing secret is written to the file; the salt and
 * IV are not secret. AES-GCM authenticates the data, so a wrong password or a changed file fails the same way.
 */
export const ENCRYPTED_FORMAT = 'paymate-backup-encrypted';
export const ENCRYPTED_VERSION = 1;
export const MIN_PASSWORD_LENGTH = 8;

const ITERATIONS = 600_000;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const WRONG_PASSWORD = 'הסיסמה שגויה, או שהקובץ שונה';
const BAD_FILE = 'קובץ הגיבוי המוצפן פגום';

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string') throw new BackupError(BAD_FILE);
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    throw new BackupError(BAD_FILE);
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number, usage: KeyUsage): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

export async function encryptBackup(plainJson: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, ITERATIONS, 'encrypt');
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, encoder.encode(plainJson)));
  return JSON.stringify({
    format: ENCRYPTED_FORMAT,
    version: ENCRYPTED_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(data),
  });
}

function envelope(fileText: string): Record<string, unknown> | null {
  try {
    const root = JSON.parse(fileText);
    return typeof root === 'object' && root !== null && root.format === ENCRYPTED_FORMAT ? root : null;
  } catch {
    return null;
  }
}

export const isEncryptedBackup = (fileText: string): boolean => envelope(fileText) !== null;

/** Returns the plain backup JSON. Throws BackupError for a wrong password, a changed file or a malformed one. */
export async function decryptBackup(fileText: string, password: string): Promise<string> {
  const root = envelope(fileText);
  if (!root) throw new BackupError('זה לא קובץ גיבוי מוצפן של PayMate');
  if (typeof root.version !== 'number' || root.version > ENCRYPTED_VERSION) {
    throw new BackupError('הגיבוי נוצר בגרסה חדשה יותר של PayMate. עדכנו את האפליקציה ונסו שוב.');
  }
  const kdf = root.kdf as Record<string, unknown> | undefined;
  const cipher = root.cipher as Record<string, unknown> | undefined;
  if (!kdf || !cipher || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher.name !== 'AES-GCM') throw new BackupError(BAD_FILE);
  const iterations = kdf.iterations;
  if (typeof iterations !== 'number' || !Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new BackupError(BAD_FILE);
  }
  const salt = fromBase64(kdf.salt);
  const iv = fromBase64(cipher.iv);
  const data = fromBase64(root.data);
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || data.length < 16) throw new BackupError(BAD_FILE);

  const key = await deriveKey(password, salt, iterations, 'decrypt');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    throw new BackupError(WRONG_PASSWORD);
  }
}
