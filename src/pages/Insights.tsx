import { useEffect, useState } from 'react';
import { api } from '../api';
import { monthLabel } from '../format';
import { RecurringTimeline } from '../charts/RecurringTimeline';
import type { Insight, TimelineRow } from '../../shared/api';
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

export function Insights({ month, go }: Shared) {
  const [items, setItems] = useState<Insight[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);

  useEffect(() => {
    if (month) void api.insights(month).then(setItems);
    void api.recurringTimeline().then(setTimeline);
  }, [month]);

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
        items.map((i) => (
          <div key={i.id} className={`insight ${i.attention ? 'attention' : ''}`}>
            <span className="mark" aria-hidden="true" />
            <div>
              <p className="kind">{KIND[i.kind]}</p>
              <p>{i.text}</p>
            </div>
          </div>
        ))
      )}
    </>
  );
}
