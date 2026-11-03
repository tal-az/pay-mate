import { useEffect, useState } from 'react';
import { api } from '../api';
import { ils, ilsExact, monthLabel } from '../format';
import { Donut } from '../charts/Donut';
import { MonthBars } from '../charts/MonthBars';
import type { Insight, MonthSummary, MonthTotal } from '../../shared/api';
import type { Shared } from '../App';

export function Dashboard({ month, months, go, selectMonth }: Shared) {
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [totals, setTotals] = useState<MonthTotal[]>([]);

  useEffect(() => {
    if (!month) return;
    void api.summary(month).then(setSummary);
    void api.insights(month).then(setInsights);
  }, [month]);

  useEffect(() => { void api.monthTotals().then(setTotals); }, [months]);

  if (months.length === 0 || !month) {
    return (
      <div className="empty">
        <h2>עוד אין כאן נתונים</h2>
        <p>סנכרנו את כרטיס האשראי, או ייבאו קובץ של ישראכארט, כדי לראות לאן הלך הכסף.</p>
        <p style={{ marginTop: 20 }}>
          <button className="btn primary" onClick={() => go('settings')}>סנכרון או ייבוא</button>
        </p>
      </div>
    );
  }
  if (!summary) return null;

  const diff = summary.prevTotal == null ? null : summary.total - summary.prevTotal;
  const max = Math.max(...summary.byCategory.map((c) => c.amount), 1);
  const top = insights.slice(0, 2);

  return (
    <>
      <h1 className="page-title">חיוב {monthLabel(month)}</h1>
      <p className="help">
        {summary.transactionCount} עסקאות בכרטיס המסתיים ב־{summary.cards.join(', ')}
      </p>

      <div className="total-row">
        <div className="price-tag" aria-label={`סך הכל ${ilsExact(summary.total)}`}>{ils(summary.total)}</div>
        {diff != null && summary.prevMonth && Math.abs(diff) >= 1 && (
          <p className={`delta ${diff > 0 ? 'up' : 'down'}`}>
            {ils(Math.abs(diff))} {diff > 0 ? 'יותר' : 'פחות'} מאשר ב{monthLabel(summary.prevMonth)}
            <small>סך החיוב הקודם: {ils(summary.prevTotal ?? 0)}</small>
          </p>
        )}
      </div>

      <div className="cols">
        <section className="section">
          <h2 className="section-title">לאן הלך הכסף</h2>
          <Donut slices={summary.byCategory} onSelect={(key) => go('transactions', key)} />
          {summary.byCategory.map((c) => (
            <button key={c.key} className="cat-row" onClick={() => go('transactions', c.key)} aria-label={`${c.name}, ${ils(c.amount)}. הצגת העסקאות`}>
              <span className="dot" style={{ background: c.color }} />
              <span>{c.name}</span>
              <span className="bar"><i style={{ width: `${(c.amount / max) * 100}%`, background: c.color }} /></span>
              <span className="amount">{ils(c.amount)}</span>
            </button>
          ))}
        </section>

        <div>
          {totals.length >= 2 && (
            <section className="section">
              <h2 className="section-title">החיוב בחודשים האחרונים</h2>
              <MonthBars totals={totals} selected={month} onSelect={selectMonth} />
            </section>
          )}
          <section className="section">
            <h2 className="section-title">בתי העסק הגדולים</h2>
            <ul className="list">
              {summary.topMerchants.map((m) => (
                <li key={m.merchant}>
                  <span>{m.merchant}{m.count > 1 && <span className="muted"> · {m.count} חיובים</span>}</span>
                  <b className="amount">{ils(m.amount)}</b>
                </li>
              ))}
            </ul>
          </section>

          {top.length > 0 && (
            <section className="section">
              <h2 className="section-title">שווה לשים לב</h2>
              {top.map((i) => (
                <div key={i.id} className={`insight ${i.attention ? 'attention' : ''}`}>
                  <span className="mark" aria-hidden="true" />
                  <p>{i.text}</p>
                </div>
              ))}
              {insights.length > top.length && (
                <p style={{ marginTop: 12 }}>
                  <button className="btn" onClick={() => go('insights')}>כל התובנות ({insights.length})</button>
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
