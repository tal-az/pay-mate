import { useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../api';
import { monthLabel } from '../format';
import type { ImportResult, SyncResult } from '../../shared/api';
import { PROVIDERS, findProvider, type ProviderKey } from '../../shared/providers';
import type { Shared } from '../App';
import { BackupError } from '../../shared/backup';
import { MIN_PASSWORD_LENGTH, decryptBackup, encryptBackup, isEncryptedBackup } from '../../shared/backupCrypto';

const COMPANY_KEY = 'paymate.syncCompany';

/** Only the company's name is remembered, for convenience. Credentials are never saved. */
function loadCompany(): ProviderKey | null {
  try {
    return findProvider(localStorage.getItem(COMPANY_KEY))?.key ?? null;
  } catch {
    return null;
  }
}

function saveCompany(key: ProviderKey) {
  try {
    localStorage.setItem(COMPANY_KEY, key);
  } catch {
    // Without storage the choice just isn't remembered.
  }
}

export function ImportPage({ refresh, notify }: Shared) {
  const [company, setCompany] = useState<ProviderKey | null>(loadCompany);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [version, setVersion] = useState('');
  const desktop = api.desktop;

  useEffect(() => desktop?.onSyncProgress(setSyncProgress), [desktop]);
  useEffect(() => { void desktop?.appVersion().then(setVersion); }, [desktop]);

  const provider = findProvider(company);

  function chooseCompany(key: ProviderKey) {
    if (key === company) return;
    setCompany(key);
    saveCompany(key);
    setSyncResult(null);
  }

  async function runSync(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!provider || !desktop) return;
    const form = new FormData(e.currentTarget);
    const request = {
      company: provider.key,
      credentials: Object.fromEntries(provider.fields.map((f) => {
        const value = String(form.get(f.name) ?? '');
        return [f.name, f.secret ? value : value.trim()];
      })),
      months: Number(form.get('months')),
    };
    setSyncBusy(true);
    setSyncResult(null);
    setSyncProgress('מתחיל…');
    const result = await desktop.sync(request);
    formRef.current?.reset();
    setSyncBusy(false);
    setSyncProgress('');
    setSyncResult(result);
    // A failure that looks like a site change may already be fixed in a newer version of the app.
    if (!result.ok && (result.failure === 'site-changed' || result.failure === 'unknown')) void desktop.checkForUpdates();
    if (result.ok) {
      refresh();
      notify(`הסנכרון הסתיים. נוספו ${result.added} עסקאות${result.skipped ? ` (${result.skipped} כבר היו קיימות)` : ''}.`);
    }
  }

  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);

  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const [backupMessage, setBackupMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [backupForm, setBackupForm] = useState<{ mode: 'save' } | { mode: 'restore'; text: string } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  async function run(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    const res = await api.importFiles(await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() }))));
    setResults(res);
    setBusy(false);
    refresh();
    const added = res.filter((r) => r.ok).reduce((n, r) => n + (r.added ?? 0), 0);
    if (res.some((r) => r.ok)) notify(`הייבוא הסתיים. נוספו ${added} עסקאות.`);
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    void run(files);
  }

  function closeBackupForm() {
    setBackupForm(null);
    setPassword('');
    setConfirmPassword('');
  }

  async function downloadBackup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setBackupMessage({ ok: false, text: `הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.` });
      return;
    }
    if (password !== confirmPassword) {
      setBackupMessage({ ok: false, text: 'הסיסמאות אינן זהות.' });
      return;
    }
    setBackupBusy(true);
    let text: string;
    try {
      text = await encryptBackup(await api.exportBackup(), password);
    } catch {
      setBackupBusy(false);
      setBackupMessage({ ok: false, text: 'ההצפנה נכשלה, והגיבוי לא ירד.' });
      return;
    }
    setBackupBusy(false);
    closeBackupForm();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `paymate-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setBackupMessage({ ok: true, text: 'הגיבוי ירד, מוצפן בסיסמה שבחרתם. בלי הסיסמה אי אפשר לשחזר אותו.' });
  }

  async function restoreBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('השחזור מחליף את כל הנתונים הקיימים בנתונים שבקובץ. להמשיך?')) return;
    const text = await file.text();
    if (isEncryptedBackup(text)) {
      setBackupMessage(null);
      setBackupForm({ mode: 'restore', text });
      return;
    }
    await finishRestore(text);
  }

  async function restoreEncrypted(e: React.FormEvent) {
    e.preventDefault();
    if (backupForm?.mode !== 'restore') return;
    setBackupBusy(true);
    let plain: string;
    try {
      plain = await decryptBackup(backupForm.text, password);
    } catch (err) {
      setBackupBusy(false);
      setBackupMessage({ ok: false, text: err instanceof BackupError ? err.message : 'פענוח הגיבוי נכשל' });
      return;
    }
    setBackupBusy(false);
    closeBackupForm();
    await finishRestore(plain);
  }

  async function finishRestore(text: string) {
    const res = await api.restoreBackup(text);
    if (res.ok) {
      refresh();
      setBackupMessage({ ok: true, text: `הגיבוי שוחזר: ${res.transactions} עסקאות.` });
      notify(`הגיבוי שוחזר: ${res.transactions} עסקאות.`);
    } else {
      setBackupMessage({ ok: false, text: res.error ?? 'השחזור נכשל, והנתונים לא השתנו' });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    void run([...e.dataTransfer.files]);
  }

  return (
    <>
      <h1 className="page-title">ייבוא והגדרות</h1>


      {desktop && <section className="section" style={{ marginTop: 20 }}>
        <h2 className="section-title">סנכרון מאתר חברת האשראי</h2>
        <div className="provider-choice" role="group" aria-label="חברת האשראי">
          {PROVIDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="provider-chip"
              aria-pressed={p.key === company}
              disabled={syncBusy}
              onClick={() => chooseCompany(p.key)}
            >
              {p.name}
            </button>
          ))}
        </div>
        {!provider && <p className="help">בחרו את חברת האשראי של הכרטיס.</p>}
        {provider && <>
        <form key={provider.key} ref={formRef} className="sync-form" onSubmit={runSync} autoComplete="off">
          {provider.fields.map((f) => (
            <label key={f.name}>
              {f.label}
              <input
                className="field"
                name={f.name}
                type={f.secret ? 'password' : 'text'}
                inputMode={f.numeric ? 'numeric' : undefined}
                maxLength={f.length}
                pattern={f.length ? `\\d{${f.length}}` : undefined}
                required
                disabled={syncBusy}
                autoComplete={f.secret ? 'new-password' : 'off'}
              />
            </label>
          ))}
          <label>
            כמה חודשים אחורה
            <select className="field" name="months" defaultValue="3" disabled={syncBusy}>
              <option value="1">חודש אחד</option>
              <option value="3">3 חודשים</option>
              <option value="6">6 חודשים</option>
              <option value="12">שנה</option>
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={syncBusy}>{syncBusy ? 'מסנכרן…' : 'סנכרון'}</button>
        </form>
        <p className="help" style={{ marginTop: 10 }}>
          הפרטים נשלחים רק לאתר {provider.name}, לא נשמרים ולא נרשמים בשום מקום, ותצטרכו להקליד אותם בכל סנכרון.
        </p>
        </>}
        <div aria-live="polite">
          {syncBusy && <p className="help" style={{ marginTop: 10 }}>{syncProgress}</p>}
          {syncResult && (
            <div className={`result ${syncResult.ok ? '' : 'bad'}`} style={{ marginTop: 12 }}>
              {syncResult.ok ? (
                <p>
                  <b>הסנכרון הסתיים.</b> נוספו {syncResult.added} עסקאות
                  {syncResult.skipped ? `, ${syncResult.skipped} כבר היו קיימות` : ''}.
                </p>
              ) : (
                <p>{syncResult.message}</p>
              )}
            </div>
          )}
        </div>
      </section>}

      <section className="section" style={desktop ? undefined : { marginTop: 20 }}>
        <h2 className="section-title">{desktop ? 'או ייבוא מקובץ של ישראכארט' : 'ייבוא מקובץ של ישראכארט'}</h2>
        <div
          className={`drop ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <h2>גררו לכאן את קובץ ה־Excel של ישראכארט</h2>
          <p>אפשר לגרור כמה חודשים בבת אחת. ייבוא חוזר של אותו קובץ לא יוצר כפילויות.</p>
          <input ref={fileInput} type="file" multiple accept=".xlsx" hidden onChange={onPicked} />
          <button className="btn primary" onClick={() => fileInput.current?.click()} disabled={busy}>
            {busy ? 'מייבא…' : 'בחירת קבצים'}
          </button>
        </div>
      </section>

      {results.length > 0 && (
        <section className="section" aria-live="polite">
          <h2 className="section-title">תוצאות הייבוא</h2>
          {results.map((r, i) => (
            <div key={i} className={`result ${r.ok ? '' : 'bad'}`}>
              <b>{r.file}</b>
              {r.ok ? (
                <p className="meta">
                  {r.month ? `חיוב ${monthLabel(r.month)} · ` : ''}כרטיס ‎{r.cardLast4}‎ · נוספו {r.added} עסקאות
                  {r.skipped ? `, ${r.skipped} כבר היו קיימות` : ''}
                  {r.totalMatches === true ? ' · הסכום תואם לסך החיוב בקובץ' : ''}
                  {r.totalMatches === false ? ' · שימו לב: הסכום לא תואם לסך החיוב בקובץ' : ''}
                </p>
              ) : (
                <p className="meta">{r.error}</p>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="section">
        <h2 className="section-title">גיבוי ושחזור</h2>
        <p className="help">
          קובץ הגיבוי מכיל את כל העסקאות, המיפויים והתקציבים, ואפשר לשחזר אותו גם באפליקציה למחשב וגם באתר.
          הגיבוי מוצפן בסיסמה שתבחרו. את הסיסמה עצמה לא שומרים בשום מקום, ולכן אי אפשר לשחזר אותה אם תישכח.
        </p>
        <p style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={() => { setBackupMessage(null); setBackupForm({ mode: 'save' }); }} disabled={isDemo || backupBusy}>הורדת גיבוי</button>
          <button className="btn" onClick={() => backupInput.current?.click()} disabled={isDemo || backupBusy}>שחזור מגיבוי</button>
          <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={(e) => void restoreBackup(e)} />
        </p>
        {backupForm && (
          <form
            onSubmit={(e) => void (backupForm.mode === 'save' ? downloadBackup(e) : restoreEncrypted(e))}
            style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
          >
            <input
              className="field" type="password" autoComplete={backupForm.mode === 'save' ? 'new-password' : 'current-password'} autoFocus required
              aria-label="סיסמה" placeholder="סיסמה" value={password} onChange={(e) => setPassword(e.target.value)}
            />
            {backupForm.mode === 'save' && (
              <input
                className="field" type="password" autoComplete="new-password" required
                aria-label="אימות סיסמה" placeholder="אימות סיסמה" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              />
            )}
            <button className="btn primary" type="submit" disabled={backupBusy}>
              {backupBusy ? 'מעבד…' : backupForm.mode === 'save' ? 'הצפנה והורדה' : 'פענוח ושחזור'}
            </button>
            <button className="btn" type="button" onClick={closeBackupForm} disabled={backupBusy}>ביטול</button>
          </form>
        )}
        <div aria-live="polite">
          {backupMessage && <div className={`result ${backupMessage.ok ? '' : 'bad'}`} style={{ marginTop: 12 }}><p>{backupMessage.text}</p></div>}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">איך מורידים את הקובץ</h2>
        <p className="help">
          באתר ישראכארט נכנסים לפירוט העסקאות, בוחרים חודש חיוב ולוחצים על ייצוא ל־Excel. הקובץ מכיל חודש אחד לכרטיס אחד.
        </p>
      </section>

      <section className="section">
        <h2 className="section-title">פרטיות</h2>
        {desktop ? (
          <>
            <p className="help">כל הנתונים נשמרים בקובץ במחשב הזה בלבד. בסנכרון, האפליקציה מתחברת רק לאתר של חברת האשראי שבחרתם.</p>
            <p className="help">אם הסנכרון לא עובד, למשל אחרי שינוי באתר, ייבוא מקובץ תמיד זמין.</p>
            <p className="help">האפליקציה בודקת עדכונים בכל פתיחה, ואחרי סנכרון שנכשל. עדכון מגיע רק מהגרסאות של PayMate. גרסה נוכחית: {version}</p>
          </>
        ) : (
          <>
            <p className="help">הקבצים נקראים בדפדפן שלכם, והנתונים נשמרים בדפדפן הזה בלבד. שום דבר לא נשלח לשרת.</p>
            <p className="help">מחיקת נתוני הגלישה של האתר מוחקת גם את הנתונים כאן, והם לא מסתנכרנים בין דפדפנים או מכשירים. כדאי להוריד גיבוי מדי פעם.</p>
            <p className="help">הנתונים בדפדפן אינם מוצפנים. מי שיש לו גישה למחשב ולפרופיל הדפדפן שלכם יכול לראות אותם.</p>
          </>
        )}
      </section>
    </>
  );
}
