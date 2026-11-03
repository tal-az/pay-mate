import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { monthLabel } from '../format';
import { RecurringTimeline } from '../charts/RecurringTimeline';
import { FlagEditor } from '../components/FlagEditor';
import { FlagIcon } from '../components/FlagIcon';
import { insightFlagKey, type Insight, type InsightFlag, type TimelineRow } from '../../shared/api';
import type { Shared } from '../App';

const KIND: Record<Insight['kind'], string> = {
  trend: 'מגמה',
  subscription: 'חיוב חוזר',
  unusual: 'חיוב חריג',
  duplicate: 'חיוב כפול אפשרי',
  budget: 'תקציב',
  missing: 'חיוב חוזר שחסר',
  price: 'שינוי מחיר',
  commitments: 'חיובים קבועים',
};

export function Insights({ month, go, refresh }: Shared) {
  const [items, setItems] = useState<Insight[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [flags, setFlags] = useState<Map<string, InsightFlag>>(new Map());
  const [flagging, setFlagging] = useState<string | null>(null);

  const loadFlags = useCallback(async () => setFlags(new Map((await api.insightFlags()).map((f) => [f.key, f]))), []);

  useEffect(() => {
    if (month) void api.insights(month).then(setItems);
    void api.recurringTimeline().then(setTimeline);
    void loadFlags();
  }, [month, loadFlags]);

  async function flagDone() {
    setFlagging(null);
    await loadFlags();
    refresh();
  }

  if (!month) {
    return (
      <div className="empty">
        <h2>אין עדיין תובנות</h2>
        <p>אחרי ייבוא של חודש אחד או יותר יופיעו כאן מגמות, חיובים חוזרים וחיובים חריגים.</p>
        <p style={{ marginTop: 20 }}><button className="btn primary" onClick={() => go('settings')}>ייבוא קובץ</button></p>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">תובנות · {monthLabel(month)}</h1>
      <p className="help" style={{ margin: '4px 0 20px' }}>
        ככל שמייבאים יותר חודשים, התובנות מדויקות יותר, למשל זיהוי חיובים חוזרים וחריגים.
      </p>
      {timeline.length > 0 && (
        <section className="section" style={{ marginBottom: 28 }}>
          <h2 className="section-title">חיובים קבועים לאורך זמן</h2>
          <RecurringTimeline rows={timeline} />
        </section>
      )}
      {items == null ? null : items.length === 0 ? (
        <div className="empty"><p>לא נמצא משהו חריג בחודש הזה.</p></div>
      ) : (
        items.map((i) => {
          const key = insightFlagKey(month, i.id);
          const flag = flags.get(key);
          return (
            <div key={i.id} className="insight-wrap">
              <div className={`insight ${i.attention ? 'attention' : ''}`}>
                <span className="mark" aria-hidden="true" />
                <div className="insight-body">
                  <p className="kind">{KIND[i.kind]}</p>
                  <p>{i.text}</p>
                </div>
                <button
                  className="flag-btn"
                  aria-label={flag ? 'עריכת הסימון של התובנה' : 'הוספת התובנה לרשימת המעקב'}
                  title={flag ? ['במעקב', flag.resolved ? 'טופל' : '', flag.comment].filter(Boolean).join(' · ') : 'הוספה לרשימת המעקב'}
                  aria-expanded={flagging === key}
                  onClick={() => setFlagging(flagging === key ? null : key)}
                >
                  <FlagIcon on={!!flag} resolved={flag?.resolved} />
                </button>
              </div>
              {flagging === key && (
                <FlagEditor
                  kinds={false}
                  initial={flag ? { kind: 'attention', comment: flag.comment } : undefined}
                  save={(_kind, comment) => api.setInsightFlag(month, i, comment)}
                  remove={flag ? () => api.clearInsightFlag(key) : undefined}
                  onDone={() => void flagDone()}
                  onCancel={() => setFlagging(null)}
                />
              )}
            </div>
          );
        })
      )}
    </>
  );
}
