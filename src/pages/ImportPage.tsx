import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { monthLabel } from '../format';
import type { ImportResult, SyncResult } from '../../shared/api';
import type { Shared } from '../App';

export function ImportPage({ refresh, notify }: Shared) {
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [version, setVersion] = useState('');

  useEffect(() => api.onSyncProgress(setSyncProgress), []);
  useEffect(() => { void api.appVersion().then(setVersion); }, []);

  async function runSync(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const request = {
      id: String(form.get('id') ?? '').trim(),
      card6Digits: String(form.get('card') ?? '').trim(),
      password: String(form.get('password') ?? ''),
      months: Number(form.get('months')),
    };
    setSyncBusy(true);
    setSyncResult(null);
    setSyncProgress('מתחיל…');
    const result = await api.sync(request);
    formRef.current?.reset();
    setSyncBusy(false);
    setSyncProgress('');
    setSyncResult(result);
    // A failure that looks like a site change may already be fixed in a newer version of the app.
    if (!result.ok && (result.failure === 'site-changed' || result.failure === 'unknown')) void api.checkForUpdates();
    if (result.ok) {
      refresh();
      notify(`הסנכרון הסתיים. נוספו ${result.added} עסקאות${result.skipped ? ` (${result.skipped} כבר היו קיימות)` : ''}.`);
    }
  }

  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);

  async function run(paths: string[]) {
    if (paths.length === 0) return;
    setBusy(true);
    const res = await api.importFiles(paths);
    setResults(res);
    setBusy(false);
    refresh();
    const added = res.filter((r) => r.ok).reduce((n, r) => n + (r.added ?? 0), 0);
    if (res.some((r) => r.ok)) notify(`הייבוא הסתיים. נוספו ${added} עסקאות.`);
  }

  async function pick() {
    await run(await api.pickFiles());
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    void run([...e.dataTransfer.files].map((f) => api.pathForFile(f)));
  }

  return (
    <>
      <h1 className="page-title">ייבוא והגדרות</h1>


      <section className="section" style={{ marginTop: 20 }}>
        <h2 className="section-title">סנכרון מאתר ישראכארט</h2>
        <form ref={formRef} className="sync-form" onSubmit={runSync} autoComplete="off">
          <label>
            תעודת זהות
            <input className="field" name="id" inputMode="numeric" required disabled={syncBusy} />
          </label>
          <label>
            6 ספרות אחרונות של הכרטיס
            <input className="field" name="card" inputMode="numeric" maxLength={6} pattern="\d{6}" required disabled={syncBusy} />
          </label>
          <label>
            סיסמה לאתר
            <input className="field" name="password" type="password" required disabled={syncBusy} autoComplete="new-password" />
          </label>
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
          הפרטים נשלחים רק לאתר ישראכארט, לא נשמרים ולא נרשמים בשום מקום, ותצטרכו להקליד אותם בכל סנכרון.
        </p>
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
      </section>

      <section className="section">
        <h2 className="section-title">או ייבוא מקובץ</h2>
        <div
          className={`drop ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <h2>גררו לכאן את קובץ ה־Excel של ישראכארט</h2>
          <p>אפשר לגרור כמה חודשים בבת אחת. ייבוא חוזר של אותו קובץ לא יוצר כפילויות.</p>
          <button className="btn primary" onClick={() => void pick()} disabled={busy}>
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
        <h2 className="section-title">איך מורידים את הקובץ</h2>
        <p className="help">
          באתר ישראכארט נכנסים לפירוט העסקאות, בוחרים חודש חיוב ולוחצים על ייצוא ל־Excel. הקובץ מכיל חודש אחד לכרטיס אחד.
        </p>
      </section>

      <section className="section">
        <h2 className="section-title">פרטיות</h2>
        <p className="help">כל הנתונים נשמרים בקובץ במחשב הזה בלבד. בסנכרון, האפליקציה מתחברת רק לאתר ישראכארט.</p>
        <p className="help">אם הסנכרון לא עובד, למשל אחרי שינוי באתר, ייבוא מקובץ תמיד זמין.</p>
        <p className="help">האפליקציה בודקת עדכונים בכל פתיחה, ואחרי סנכרון שנכשל. עדכון מגיע רק מהגרסאות של PayMate. גרסה נוכחית: {version}</p>
      </section>
    </>
  );
}
