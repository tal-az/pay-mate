import { describe, expect, it } from 'vitest';
import { emptyData, makeBackup, parseBackup } from '../shared/backup';
import { ENCRYPTED_FORMAT, decryptBackup, encryptBackup, isEncryptedBackup } from '../shared/backupCrypto';
import { stmt, tx, webStore } from './helpers/stores';

const PASSWORD = 'סיסמה-חזקה-123';

function sample(): string {
  const s = webStore();
  s.importStatement(stmt([tx({ id: 'a1', merchant: 'חנות סודית', chargedAmount: 100.5 })]), 'file.xlsx', 'excel');
  return JSON.stringify(makeBackup(s.exportData()));
}

describe('password-protected backup', () => {
  it('round-trips with a Hebrew password and still validates', async () => {
    const plain = sample();
    const file = await encryptBackup(plain, PASSWORD);
    expect(await decryptBackup(file, PASSWORD)).toBe(plain);
    expect(parseBackup(await decryptBackup(file, PASSWORD)).transactions).toHaveLength(1);
  });

  it('writes neither the data nor the password in the clear', async () => {
    const file = await encryptBackup(sample(), PASSWORD);
    expect(file).not.toContain('חנות סודית');
    expect(file).not.toContain(PASSWORD);
    expect(JSON.parse(file).format).toBe(ENCRYPTED_FORMAT);
  });

  it('uses a fresh salt and IV every time', async () => {
    const plain = sample();
    const [a, b] = [await encryptBackup(plain, PASSWORD), await encryptBackup(plain, PASSWORD)];
    expect(JSON.parse(a).kdf.salt).not.toBe(JSON.parse(b).kdf.salt);
    expect(JSON.parse(a).cipher.iv).not.toBe(JSON.parse(b).cipher.iv);
    expect(JSON.parse(a).data).not.toBe(JSON.parse(b).data);
  });

  it('refuses a wrong password and a changed file', async () => {
    const file = await encryptBackup(sample(), PASSWORD);
    await expect(decryptBackup(file, 'wrong-password')).rejects.toThrow('הסיסמה שגויה');
    const root = JSON.parse(file);
    const bytes = Uint8Array.from(atob(root.data), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 1;
    root.data = btoa(String.fromCharCode(...bytes));
    await expect(decryptBackup(JSON.stringify(root), PASSWORD)).rejects.toThrow('הסיסמה שגויה');
  });

  it('refuses newer, malformed and out-of-range files', async () => {
    const root = JSON.parse(await encryptBackup(sample(), PASSWORD));
    await expect(decryptBackup(JSON.stringify({ ...root, version: 99 }), PASSWORD)).rejects.toThrow('גרסה חדשה');
    await expect(decryptBackup(JSON.stringify({ ...root, data: 5 }), PASSWORD)).rejects.toThrow('פגום');
    await expect(decryptBackup(JSON.stringify({ ...root, kdf: { ...root.kdf, iterations: 1 } }), PASSWORD)).rejects.toThrow('פגום');
    await expect(decryptBackup(JSON.stringify({ ...root, kdf: { ...root.kdf, iterations: 1e12 } }), PASSWORD)).rejects.toThrow('פגום');
    await expect(decryptBackup('not json', PASSWORD)).rejects.toThrow();
  });

  it('tells encrypted files from plain ones', async () => {
    expect(isEncryptedBackup(await encryptBackup(sample(), PASSWORD))).toBe(true);
    expect(isEncryptedBackup(JSON.stringify(makeBackup(emptyData())))).toBe(false);
    expect(isEncryptedBackup('garbage')).toBe(false);
  });
});
