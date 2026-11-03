import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isDemo, isDesktop } from './api';
import { monthLabel } from './format';
import { isStale, longDate } from './freshness';
import type { Category, LastUpdate, UpdateStatus } from '../shared/api';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Tasks } from './pages/Tasks';
import { Insights } from './pages/Insights';
import { Budgets } from './pages/Budgets';
import { ImportPage } from './pages/ImportPage';
import { Mapping } from './pages/Mapping';
import { AccentPicker } from './components/AccentPicker';
import { MappingNudge } from './components/MappingNudge';

export type PageId = 'overview' | 'transactions' | 'tasks' | 'insights' | 'budgets' | 'mapping' | 'settings';

const NAV: Array<{ id: PageId; label: string }> = [
  { id: 'overview', label: 'סקירה' },
  { id: 'transactions', label: 'עסקאות' },
  { id: 'tasks', label: 'משימות פתוחות' },
  { id: 'insights', label: 'תובנות' },
  { id: 'budgets', label: 'תקציבים' },
  { id: 'mapping', label: 'מיפוי עסקים' },
  { id: 'settings', label: 'ייבוא והגדרות' },
];

export interface Shared {
  months: string[];
  month: string | null;
  categories: Category[];
  refresh: () => void;
  go: (page: PageId, categoryKey?: string) => void;
  filterCategory: string;
  /** Shows a message at the top of every page until the user closes it. */
  notify: (text: string) => void;
  selectMonth: (month: string) => void;
}

export function App() {
  const [page, setPage] = useState<PageId>('overview');
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<LastUpdate | null>(null);
  const [staleDismissed, setStaleDismissed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [unknownCount, setUnknownCount] = useState(0);
  const [taskCount, setTaskCount] = useState(0);
  const [nudge, setNudge] = useState(false);
  const [tick, setTick] = useState(0);
  const pageRef = useRef<PageId>('overview');
  pageRef.current = page;

  const load = useCallback(async () => {
    const [ms, cats, last] = await Promise.all([api.months(), api.categories(), api.lastUpdate()]);
    setMonths(ms);
    setLastUpdate(last);
    setCategories(cats);
    setMonth((cur) => (cur && ms.includes(cur) ? cur : ms[0] ?? null));
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A file dropped outside the drop zone would otherwise make the browser open it and leave the app.
  useEffect(() => {
    const stop = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);
  useEffect(() => api.desktop?.onUpdateStatus(setUpdate), []);

  const refresh = useCallback(() => { setTick((t) => t + 1); void load(); }, [load]);

  // The count behind the rail badge follows every change.
  useEffect(() => {
    if (!month) { setUnknownCount(0); return; }
    void api.unknownMerchants(month).then((l) => setUnknownCount(l.length));
  }, [month, tick]);

  // Open tasks span all months, so their count does not depend on the selected month.
  useEffect(() => {
    void api.flags().then((l) => setTaskCount(l.filter((f) => !f.resolved).length));
  }, [tick]);

  // The corner offer appears when a month's window opens (or new months arrive), once, and never while playing.
  const monthsKey = months.join(',');
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    void api.unknownMerchants(month).then((l) => {
      if (!cancelled && l.length > 0 && pageRef.current !== 'mapping') setNudge(true);
    });
    return () => { cancelled = true; };
  }, [month, monthsKey]);
  const go = useCallback((p: PageId, categoryKey?: string) => {
    setFilterCategory(categoryKey ?? '');
    setPage(p);
    if (p === 'mapping') setNudge(false);
  }, []);

  const notify = useCallback((text: string) => setNotice(text), []);
  const shared: Shared = { months, month, categories, refresh, go, filterCategory, notify, selectMonth: setMonth };
  const stale = isStale(lastUpdate?.at) && !staleDismissed && page !== 'settings';

  return (
    <div className="app">
      <nav className="rail" aria-label="ניווט ראשי">
        <div className="brand">
          <AccentPicker />
          PayMate
        </div>
        {NAV.map((n) => (
          <button key={n.id} className="nav-item" aria-current={page === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            <span>{n.label}</span>
            {n.id === 'mapping' && unknownCount > 0 && <span className="badge" aria-label={`${unknownCount} עסקים לא ממופים`}>{unknownCount}</span>}
            {n.id === 'tasks' && taskCount > 0 && <span className="badge" aria-label={`${taskCount} משימות פתוחות`}>{taskCount}</span>}
          </button>
        ))}
        <p className="privacy">
          {isDemo ? 'תצוגת דוגמה עם נתונים מומצאים. ' : ''}
          {isDesktop ? 'הנתונים נשארים במחשב הזה. סיסמאות לא נשמרות.' : 'הנתונים נשמרים בדפדפן הזה בלבד ולא נשלחים לשום שרת.'}
        </p>
      </nav>
      <main className="main">
        <div className="page" key={page}>
          {update?.state === 'ready' && (
            <div className="banner stale" role="status">
              <span>יש גרסה חדשה של PayMate ({update.version}). הפעילו מחדש כדי להתקין אותה. הנתונים שלכם לא נמחקים.</span>
              <button className="btn primary" onClick={() => void api.desktop?.installUpdate()}>הפעלה מחדש ועדכון</button>
            </div>
          )}
          {update?.state === 'downloading' && (
            <div className="banner done" role="status">
              <span>מורידים גרסה חדשה ({update.version}) ברקע. תופיע הודעה כשהיא מוכנה.</span>
            </div>
          )}
          {notice && (
            <div className="banner done" role="status">
              <span>{notice}</span>
              <button className="btn" onClick={() => setNotice(null)}>סגירה</button>
            </div>
          )}
          {stale && lastUpdate && (
            <div className="banner stale" role="status">
              <span>
                המידע מעודכן עד {longDate(lastUpdate.at)}. כדי לראות עסקאות חדשות, עדכנו אותו {isDesktop ? 'בסנכרון או ' : ''}בהעלאת קובצי Excel.
              </span>
              <button className="btn primary" onClick={() => go('settings')}>עדכון המידע</button>
              <button className="btn" onClick={() => setStaleDismissed(true)}>אחר כך</button>
            </div>
          )}
          {loaded && months.length > 0 && page !== 'settings' && page !== 'tasks' && (
            <div className="topbar">
              <span className="sub">חיוב לפי חודש</span>
              <select
                className="month-select"
                aria-label="בחירת חודש חיוב"
                value={month ?? ''}
                onChange={(e) => setMonth(e.target.value)}
              >
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
          )}
          {!loaded ? null : page === 'overview' ? (
            <Dashboard {...shared} />
          ) : page === 'transactions' ? (
            <Transactions {...shared} />
          ) : page === 'tasks' ? (
            <Tasks {...shared} />
          ) : page === 'insights' ? (
            <Insights {...shared} />
          ) : page === 'budgets' ? (
            <Budgets {...shared} />
          ) : page === 'mapping' ? (
            <Mapping {...shared} />
          ) : (
            <ImportPage {...shared} />
          )}
        </div>
      </main>
      {nudge && month && unknownCount > 0 && page !== 'mapping' && (
        <MappingNudge
          count={unknownCount}
          monthName={monthLabel(month)}
          onStart={() => go('mapping')}
          onClose={() => setNudge(false)}
        />
      )}
    </div>
  );
}
