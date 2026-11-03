import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { ils, monthLabel, shortDate } from '../format';
import { AddCategory } from '../components/AddCategory';
import { blip, burst, reducedMotion, shower, type Particle } from '../fx';
import type { UnknownMerchant } from '../../shared/api';
import type { Shared } from '../App';

const PRAISE = ['יופי!', 'מעולה.', 'נחתם.', 'אתם על זה.', 'עוד אחד ירד מ"אחר".', 'קלי קלות.'];
const LEAVE_MS = 240;
const CONFETTI = ['#c8ff2e', '#ff3d8b', '#19c9d9', '#4b35ff', '#ffb020', '#ffffff'];

function comboLabel(n: number) {
  if (n >= 10) return 'בלתי עצרים';
  if (n >= 5) return 'על האש';
  return 'רצף';
}

/** Counts up to `value` so money leaving "other" feels like it lands. */
function useCountUp(value: number) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const a = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      const v = a + (value - a) * (1 - (1 - k) ** 3);
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

function Particles({ list, slow }: { list: Particle[]; slow?: boolean }) {
  return (
    <div className="mfx" aria-hidden="true">
      {list.map((p) => (
        <i
          key={p.id}
          className={`mp${p.round ? ' round' : ''}${slow ? ' slow' : ''}`}
          style={{ left: p.x, top: p.y, width: p.size, height: p.size, background: p.color, '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--rot': `${p.rot}deg` } as CSSProperties}
        />
      ))}
    </div>
  );
}

interface Done {
  item: UnknownMerchant;
  label: string;
  kept: boolean;
}

export function Mapping({ month, categories, refresh, go }: Shared) {
  const [queue, setQueue] = useState<UnknownMerchant[] | null>(null);
  const [start, setStart] = useState(0);
  const [history, setHistory] = useState<Done[]>([]);
  const [moved, setMoved] = useState(0);
  const [leaving, setLeaving] = useState<{ label: string; color: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [adding, setAdding] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [fly, setFly] = useState({ x: -90, r: -5 });
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem('paymate.mute') === '1';
    } catch {
      return false;
    }
  });
  const busy = useRef(false);
  const finished = useRef(false);
  const praiseIndex = useRef(0);

  const choices = categories.filter((c) => c.key !== 'other');
  const countedMoved = useCountUp(moved);

  useEffect(() => {
    if (!month) return;
    setQueue(null);
    setHistory([]);
    setMoved(0);
    setStreak(0);
    setBest(0);
    setFeedback('');
    finished.current = false;
    void api.unknownMerchants(month).then((list) => {
      setQueue(list);
      setStart(list.length);
    });
  }, [month]);

  const current = queue?.[0];

  const spawn = useCallback((list: Particle[]) => {
    if (list.length === 0) return;
    const ids = new Set(list.map((p) => p.id));
    setParticles((p) => [...p, ...list]);
    setTimeout(() => setParticles((p) => p.filter((x) => !ids.has(x.id))), 2200);
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem('paymate.mute', next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const choose = useCallback(async (key: string) => {
    if (!current || busy.current) return;
    busy.current = true;
    const cat = categories.find((c) => c.key === key);
    const kept = key === 'other';
    const dir = Math.random() < 0.5 ? -1 : 1;
    setFly({ x: dir * (110 + Math.random() * 60), r: dir * (5 + Math.random() * 8) });
    const rect = document.querySelector<HTMLElement>(`[data-cat="${key}"]`)?.getBoundingClientRect();
    if (rect && !kept) {
      const power = 1 + Math.min(streak, 8) * 0.25;
      spawn(burst(rect.left + rect.width / 2, rect.top + rect.height / 2, [cat?.color ?? '#c8ff2e', ...CONFETTI], power));
    }
    if (!muted) blip(kept ? 0 : streak + 1);
    setLeaving({ label: kept ? 'נשאר באחר' : cat?.name ?? '', color: cat?.color ?? '#898781' });
    await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : LEAVE_MS));
    await api.mapMerchant(current.merchant, key);
    setQueue((q) => q?.slice(1) ?? q);
    setHistory((h) => [...h, { item: current, label: kept ? 'אחר' : cat?.name ?? '', kept }]);
    if (!kept) {
      setMoved((m) => m + current.total);
      setStreak((s) => s + 1);
      setBest((b) => Math.max(b, streak + 1));
    } else {
      setStreak(0);
    }
    const next = streak + 1;
    setFeedback(!kept && next >= 3 ? `רצף של ${next}!` : PRAISE[praiseIndex.current++ % PRAISE.length]);
    setLeaving(null);
    busy.current = false;
    refresh();
  }, [current, categories, streak, refresh, spawn, muted]);

  const skip = useCallback(() => {
    if (!queue || queue.length < 2 || busy.current) return;
    setQueue((q) => (q && q.length > 1 ? [...q.slice(1), q[0]] : q));
    setStreak(0);
    setFeedback('נחזור אליו בסוף.');
  }, [queue]);

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || busy.current) return;
    busy.current = true;
    await api.undoMapMerchant(last.item.merchant);
    setHistory((h) => h.slice(0, -1));
    setQueue((q) => [last.item, ...(q ?? [])]);
    if (!last.kept) setMoved((m) => m - last.item.total);
    setStreak(0);
    setFeedback('בוטל.');
    if (!muted) blip(0, 'undo');
    busy.current = false;
    refresh();
  }, [history, refresh, muted]);

  // Celebrate when the last merchant is sorted.
  useEffect(() => {
    if (queue && queue.length === 0 && start > 0 && history.length > 0 && !finished.current) {
      finished.current = true;
      spawn(shower(CONFETTI));
      if (!muted) blip(0, 'win');
    }
    if (queue && queue.length > 0) finished.current = false;
  }, [queue, start, history.length, spawn, muted]);

  // Number keys pick the matching category.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '0') {
        void choose('other');
        return;
      }
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < choices.length) void choose(choices[i].key);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choices, choose]);

  if (!month) {
    return (
      <div className="empty">
        <h2>אין עדיין עסקאות למיין</h2>
        <p><button className="btn primary" onClick={() => go('settings')}>ייבוא קובץ</button></p>
      </div>
    );
  }
  if (queue == null) return null;

  const done = history.length;
  const mappedCount = history.filter((h) => !h.kept).length;

  if (start === 0) {
    return (
      <div className="empty">
        <h2>הכל ממופה ב{monthLabel(month)}</h2>
        <p>אין עסקים שאני לא מכיר החודש.</p>
        <p style={{ marginTop: 20 }}><button className="btn primary" onClick={() => go('overview')}>חזרה לסקירה</button></p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="mdone">
        <Particles list={particles} slow />
        <div className="price-tag mtag-big mpop">סיימנו 🎉</div>
        <h1 className="page-title">{monthLabel(month)} מסודר</h1>
        {best >= 3 && <p className="mbest">הרצף הכי ארוך שלכם: {best} 🔥</p>}
        <p className="help" style={{ margin: '8px 0 20px' }}>
          מיפיתם {mappedCount} עסקים
          {done > mappedCount ? `, והשארתם ${done - mappedCount} באחר` : ''}.
          {moved > 0 ? ` ${ils(moved)} עברו מ"אחר" לקטגוריות, ומעכשיו אזהה אותם לבד, גם בחודשים אחרים.` : ''}
        </p>
        <div className="mactions">
          <button className="btn primary" onClick={() => go('overview')}>לסקירה</button>
          {history.length > 0 && <button className="btn" onClick={() => void undo()}>ביטול האחרון</button>}
        </div>
      </div>
    );
  }

  const pct = (done / start) * 100;

  return (
    <div className="mapping">
      <Particles list={particles} />
      <h1 className="page-title">מי זה? · {monthLabel(month)}</h1>
      <p className="help" style={{ margin: '4px 0 16px' }}>
        עסקים שאני לא מכיר. לאיזו קטגוריה לשייך? אפשר ללחוץ גם על המספר במקלדת.
      </p>

      <div className="mprogress" role="progressbar" aria-valuemin={0} aria-valuemax={start} aria-valuenow={done} aria-label="התקדמות">
        <span className="meter mmeter"><i style={{ width: `${pct}%` }} /></span>
        <span className="mcount">{done} מתוך {start}</span>
        <button className="mmute" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'הפעלת צלילים' : 'השתקת צלילים'} title={muted ? 'הפעלת צלילים' : 'השתקת צלילים'}>
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="mstage">
        {streak >= 2 && (
          <div className={`combo ${streak >= 10 ? 'hot3' : streak >= 5 ? 'hot2' : ''}`} key={streak} aria-hidden="true">
            <span className="flame">{streak >= 5 ? '🔥' : '✨'}</span> {comboLabel(streak)} ×{streak}
          </div>
        )}
        <div
          className={`mcard ${leaving ? 'leaving' : ''}`}
          key={current.merchant}
          aria-live="polite"
          style={{ '--fly-x': `${fly.x}px`, '--fly-r': `${fly.r}deg` } as CSSProperties}
        >
          <div className="mtag"><span className="mname">{current.merchant}</span></div>
          <p className="mmeta">
            {current.count === 1 ? 'חיוב אחד' : `${current.count} חיובים`} · {ils(current.total)} ·{' '}
            {current.firstDate === current.lastDate ? shortDate(current.firstDate) : `${shortDate(current.firstDate)}–${shortDate(current.lastDate)}`}
          </p>
          {leaving && <span className="stamp" style={{ borderColor: leaving.color, color: leaving.color }}>{leaving.label}</span>}
        </div>
      </div>

      <div className="mchoices" role="group" aria-label="קטגוריות">
        {choices.map((c, i) => (
          <button
            key={c.key}
            data-cat={c.key}
            className="mchip"
            style={{ '--cat': c.color } as CSSProperties}
            onClick={() => void choose(c.key)}
            disabled={!!leaving}
          >
            <span className="dot" style={{ background: c.color }} />
            <span>{c.name}</span>
            {i < 9 && <kbd>{i + 1}</kbd>}
          </button>
        ))}
        <button className="mchip mchip-add" onClick={() => setAdding(true)} disabled={!!leaving || adding}>
          <span className="dot" aria-hidden="true">+</span>
          <span>קטגוריה חדשה</span>
        </button>
      </div>
      {adding && (
        <AddCategory
          used={categories.map((c) => c.color.toLowerCase())}
          onCancel={() => setAdding(false)}
          onAdded={() => { setAdding(false); setFeedback('הקטגוריה נוספה.'); refresh(); }}
        />
      )}

      <div className="mactions">
        <button className="btn" onClick={() => void choose('other')} disabled={!!leaving}>להשאיר באחר <kbd className="mkbd">0</kbd></button>
        <button className="btn" onClick={skip} disabled={!!leaving || queue.length < 2}>לדלג</button>
        <button className="btn" onClick={() => void undo()} disabled={!!leaving || history.length === 0}>ביטול</button>
        <p className="mfeedback" role="status">{feedback}</p>
      </div>
      {moved > 0 && (
        <p className="help" style={{ marginTop: 14 }}>
          עד עכשיו: <b className="mmoney">{ils(Math.round(countedMoved))}</b> עברו מ"אחר" לקטגוריות.
        </p>
      )}
    </div>
  );
}
