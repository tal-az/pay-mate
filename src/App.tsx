import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isDemo, isDesktop } from './api';
import { monthLabel } from './format';
import { isStale, longDate } from './freshness';
import { byCompany, cardLabel, companyName } from '../shared/core/cards';
import type { CardInfo, Category, UpdateStatus } from '../shared/api';
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
  { id: 'tasks', label: 'סומן למעקב' },
  { id: 'insights', label: 'תובנות' },
  { id: 'budgets', label: 'תקציבים' },
  { id: 'mapping', label: 'מיפוי עסקים' },
  { id: 'settings', label: 'ייבוא והגדרות' },
];

// The installer keeps a fixed file name (see build.nsis.artifactName), so this always serves the newest release.
const DESKTOP_DOWNLOAD_URL = 'https://github.com/tal-az/pay-mate/releases/latest/download/PayMate-Setup.exe';
const isWindows = /Windows/i.test(navigator.userAgent);

/** The pages that can show one card. Budgets, mapping and the follow-up list always cover all of them. */
const CARD_PAGES: PageId[] = ['overview', 'transactions', 'insights'];

export interface Shared {
  months: string[];
  month: string | null;
  cards: CardInfo[];
  /** The key of the card being viewed, or empty for all cards. */
  card: string;
  selectCard: (card: string) => void;
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
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [card, setCard] = useState('');
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
    const [ms, cats, cs] = await Promise.all([api.months(), api.categories(), api.cards()]);
    setMonths(ms);
    setCards(cs);
    // The card being viewed can disappear, for example when a backup is restored.
    setCard((cur) => (cs.some((c) => c.key === cur) ? cur : ''));
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
    void Promise.all([api.flags(), api.insightFlags()]).then(([a, b]) => setTaskCount([...a, ...b].filter((f) => !f.resolved).length));
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
  const shared: Shared = { months, month, cards, card, selectCard: setCard, categories, refresh, go, filterCategory, notify, selectMonth: setMonth };
  const companies = byCompany(cards);
  const staleCompanies = staleDismissed || page === 'settings' ? [] : companies.filter((c) => isStale(c.updatedAt));

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
            {n.id === 'tasks' && taskCount > 0 && <span className="badge" aria-label={`${taskCount} פריטים לטיפול`}>{taskCount}</span>}
          </button>
        ))}
        {!isDesktop && !isDemo && isWindows && (
          <a className="get-desktop" href={DESKTOP_DOWNLOAD_URL} download title="גרסה למחשב שמושכת עסקאות ישירות משירות האשראי, בלי לשמור סיסמאות">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2v7m0 0L5 6m3 3 3-3M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>גרסה למחשב: משיכה אוטומטית מהאשראי, בלי לשמור סיסמה</span>
          </a>
        )}
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
          {staleCompanies.length > 0 && (
            <div className="banner stale" role="status">
              <span>
                {companies.length === 1
                  ? `המידע מעודכן עד ${longDate(companies[0].updatedAt!)}.`
                  : `המידע מעודכן: ${staleCompanies.map((c) => `${companyName(c.company)} עד ${longDate(c.updatedAt!)}`).join(', ')}.`}
                {' '}כדי לראות עסקאות חדשות, עדכנו אותו {isDesktop ? 'בסנכרון או ' : ''}בהעלאת קובצי Excel.
              </span>
              <button className="btn primary" onClick={() => go('settings')}>עדכון המידע</button>
              <button className="btn" onClick={() => setStaleDismissed(true)}>אחר כך</button>
            </div>
          )}
          {loaded && months.length > 0 && page !== 'settings' && page !== 'tasks' && (
            <div className="topbar">
              <span className="sub">חיוב לפי חודש</span>
              <div className="topbar-selects">
                {cards.length >= 2 && CARD_PAGES.includes(page) && (
                  <select
                    className="month-select"
                    aria-label="בחירת כרטיס"
                    value={card}
                    onChange={(e) => setCard(e.target.value)}
                  >
                    <option value="">כל הכרטיסים</option>
                    {cards.map((c) => <option key={c.key} value={c.key}>{cardLabel(c.company, c.last4)}</option>)}
                  </select>
                )}
                <select
                  className="month-select"
                  aria-label="בחירת חודש חיוב"
                  value={month ?? ''}
                  onChange={(e) => setMonth(e.target.value)}
                >
                  {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </div>
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
