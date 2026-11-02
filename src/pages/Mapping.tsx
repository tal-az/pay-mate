import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ils, monthLabel, shortDate } from '../format';
import type { UnknownMerchant } from '../../shared/api';
import type { Shared } from '../App';

const PRAISE = ['יופי!', 'מעולה.', 'נחתם.', 'אתם על זה.', 'עוד אחד ירד מ"אחר".', 'קלי קלות.'];
const LEAVE_MS = 240;

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
  const busy = useRef(false);
  const praiseIndex = useRef(0);

  const choices = categories.filter((c) => c.key !== 'other');

  useEffect(() => {
    if (!month) return;
    setQueue(null);
    setHistory([]);
    setMoved(0);
    setStreak(0);
    setFeedback('');
    void api.unknownMerchants(month).then((list) => {
      setQueue(list);
      setStart(list.length);
    });
  }, [month]);

  const current = queue?.[0];

  const choose = useCallback(async (key: string) => {
    if (!current || busy.current) return;
    busy.current = true;
    const cat = categories.find((c) => c.key === key);
    const kept = key === 'other';
    setLeaving({ label: kept ? 'נשאר באחר' : cat?.name ?? '', color: cat?.color ?? '#898781' });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    await new Promise((r) => setTimeout(r, reduce ? 0 : LEAVE_MS));
    await api.mapMerchant(current.merchant, key);
    setQueue((q) => q?.slice(1) ?? q);
    setHistory((h) => [...h, { item: current, label: kept ? 'אחר' : cat?.name ?? '', kept }]);
    if (!kept) {
      setMoved((m) => m + current.total);
      setStreak((s) => s + 1);
    } else {
      setStreak(0);
    }
    const next = streak + 1;
    setFeedback(!kept && next >= 3 ? `רצף של ${next}!` : PRAISE[praiseIndex.current++ % PRAISE.length]);
    setLeaving(null);
    busy.current = false;
    refresh();
  }, [current, categories, streak, refresh]);

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
    busy.current = false;
    refresh();
  }, [history, refresh]);

  // Number keys pick the matching category.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = e.key === '0' ? 9 : Number(e.key) - 1;
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
        <div className="price-tag mtag-big">סיימנו</div>
        <h1 className="page-title">{monthLabel(month)} מסודר</h1>
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

  return (
    <div className="mapping">
      <h1 className="page-title">מי זה? · {monthLabel(month)}</h1>
      <p className="help" style={{ margin: '4px 0 16px' }}>
        עסקים שאני לא מכיר. לאיזו קטגוריה לשייך? אפשר ללחוץ גם על המספר במקלדת.
      </p>

      <div className="mprogress" role="progressbar" aria-valuemin={0} aria-valuemax={start} aria-valuenow={done} aria-label="התקדמות">
        <span className="meter"><i style={{ width: `${(done / start) * 100}%`, background: 'var(--ink)' }} /></span>
        <span className="mcount">{done} מתוך {start}</span>
      </div>

      <div className={`mcard ${leaving ? 'leaving' : ''}`} key={current.merchant} aria-live="polite">
        <div className="mtag"><span className="mname">{current.merchant}</span></div>
        <p className="mmeta">
          {current.count === 1 ? 'חיוב אחד' : `${current.count} חיובים`} · {ils(current.total)} ·{' '}
          {current.firstDate === current.lastDate ? shortDate(current.firstDate) : `${shortDate(current.firstDate)}–${shortDate(current.lastDate)}`}
        </p>
        {leaving && <span className="stamp" style={{ borderColor: leaving.color }}>{leaving.label}</span>}
      </div>

      <div className="mchoices" role="group" aria-label="קטגוריות">
        {choices.map((c, i) => (
          <button key={c.key} className="mchip" onClick={() => void choose(c.key)} disabled={!!leaving}>
            <span className="dot" style={{ background: c.color }} />
            <span>{c.name}</span>
            <kbd>{i === 9 ? 0 : i + 1}</kbd>
          </button>
        ))}
      </div>

      <div className="mactions">
        <button className="btn" onClick={() => void choose('other')} disabled={!!leaving}>להשאיר באחר</button>
        <button className="btn" onClick={skip} disabled={!!leaving || queue.length < 2}>לדלג</button>
        <button className="btn" onClick={() => void undo()} disabled={!!leaving || history.length === 0}>ביטול</button>
        <p className="mfeedback" role="status">{feedback}</p>
      </div>
      {moved > 0 && <p className="help" style={{ marginTop: 14 }}>עד עכשיו: {ils(moved)} עברו מ"אחר" לקטגוריות.</p>}
    </div>
  );
}
