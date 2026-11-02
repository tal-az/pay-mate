import { useCallback, useEffect, useState } from 'react';
import { api, isDemo } from './api';
import { monthLabel } from './format';
import { isStale, longDate } from './freshness';
import type { Category, LastUpdate, UpdateStatus } from '../shared/api';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { Insights } from './pages/Insights';
import { Budgets } from './pages/Budgets';
import { ImportPage } from './pages/ImportPage';

export type PageId = 'overview' | 'transactions' | 'insights' | 'budgets' | 'settings';

const NAV: Array<{ id: PageId; label: string }> = [
  { id: 'overview', label: 'סקירה' },
  { id: 'transactions', label: 'עסקאות' },
  { id: 'insights', label: 'תובנות' },
  { id: 'budgets', label: 'תקציבים' },
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

  const load = useCallback(async () => {
    const [ms, cats, last] = await Promise.all([api.months(), api.categories(), api.lastUpdate()]);
    setMonths(ms);
    setLastUpdate(last);
    setCategories(cats);
    setMonth((cur) => (cur && ms.includes(cur) ? cur : ms[0] ?? null));
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => api.onUpdateStatus(setUpdate), []);

  const refresh = useCallback(() => { void load(); }, [load]);
  const go = useCallback((p: PageId, categoryKey?: string) => {
    setFilterCategory(categoryKey ?? '');
    setPage(p);
  }, []);

  const notify = useCallback((text: string) => setNotice(text), []);
  const shared: Shared = { months, month, categories, refresh, go, filterCategory, notify, selectMonth: setMonth };
  const stale = isStale(lastUpdate?.at) && !staleDismissed && page !== 'settings';

  return (
    <div className="app">
      <nav className="rail" aria-label="ניווט ראשי">
        <div className="brand">PayMate</div>
        {NAV.map((n) => (
          <button key={n.id} className="nav-item" aria-current={page === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            {n.label}
          </button>
        ))}
        <p className="privacy">
          {isDemo ? 'תצוגת דוגמה עם נתונים מומצאים. ' : ''}
          הנתונים נשארים במחשב הזה. סיסמאות לא נשמרות.
        </p>
      </nav>
      <main className="main">
        <div className="page" key={page}>
          {update?.state === 'ready' && (
            <div className="banner stale" role="status">
              <span>יש גרסה חדשה של PayMate ({update.version}). הפעילו מחדש כדי להתקין אותה. הנתונים שלכם לא נמחקים.</span>
              <button className="btn primary" onClick={() => void api.installUpdate()}>הפעלה מחדש ועדכון</button>
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
                המידע מעודכן עד {longDate(lastUpdate.at)}. כדי לראות עסקאות חדשות, עדכנו אותו בסנכרון או בהעלאת קובצי Excel.
              </span>
              <button className="btn primary" onClick={() => go('settings')}>עדכון המידע</button>
              <button className="btn" onClick={() => setStaleDismissed(true)}>אחר כך</button>
            </div>
          )}
          {loaded && months.length > 0 && page !== 'settings' && (
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
          ) : page === 'insights' ? (
            <Insights {...shared} />
          ) : page === 'budgets' ? (
            <Budgets {...shared} />
          ) : (
            <ImportPage {...shared} />
          )}
        </div>
      </main>
    </div>
  );
}
