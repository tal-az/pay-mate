import { useEffect, useState } from 'react';
import { api, isDesktop } from '../api';
import { ils, ilsExact, monthLabel } from '../format';
import { Donut } from '../charts/Donut';
import { MonthBars } from '../charts/MonthBars';
import { cardLabel } from '../../shared/core/cards';
import type { Insight, MonthSummary, MonthTotal } from '../../shared/api';
import type { Shared } from '../App';

export function Dashboard({ month, months, cards, card, selectCard, go, selectMonth }: Shared) {
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [totals, setTotals] = useState<MonthTotal[]>([]);

  useEffect(() => {
    if (!month) return;
    void api.summary(month, card).then(setSummary);
    void api.insights(month, card).then(setInsights);
  }, [month, card]);

  useEffect(() => { void api.monthTotals(card).then(setTotals); }, [months, card]);

  if (months.length === 0 || !month) {
    return (
      <div className="empty">
        <h2>עוד אין כאן נתונים</h2>
        <p>{isDesktop ? 'סנכרנו את כרטיס האשראי, או ייבאו קובץ של ישראכארט או מקס, כדי לראות לאן הלך הכסף.' : 'ייבאו את פירוט העסקאות החודשי מאתר ישראכארט או מקס כדי לראות לאן הלך הכסף.'}</p>
        <p style={{ marginTop: 20 }}>
          <button className="btn primary" onClick={() => go('settings')}>{isDesktop ? 'סנכרון או ייבוא' : 'ייבוא קובץ'}</button>
        </p>
      </div>
    );
  }
  if (!summary) return null;

  const selected = cards.find((c) => c.key === card);
  if (selected && summary.transactionCount === 0) {
    return (
      <div className="empty">
        <h2>אין חיובים ב{monthLabel(month)}</h2>
        <p>בכרטיס {cardLabel(selected.company, selected.last4)} אין עסקאות בחודש הזה.</p>
        <p style={{ marginTop: 20 }}><button className="btn primary" onClick={() => selectCard('')}>הצגת כל הכרטיסים</button></p>
      </div>
    );
  }

  const diff = summary.prevTotal == null ? null : summary.total - summary.prevTotal;
  const max = Math.max(...summary.byCategory.map((c) => c.amount), 1);
  const maxCard = Math.max(...summary.byCard.map((c) => c.amount), 1);
  const top = insights.slice(0, 2);

  return (
    <>
      <h1 className="page-title">חיוב {monthLabel(month)}</h1>
      <p className="help">
        {selected
          ? `${summary.transactionCount} עסקאות בכרטיס ${cardLabel(selected.company, selected.last4)}`
          : summary.byCard.length > 1
            ? `${summary.transactionCount} עסקאות ב־${summary.byCard.length} כרטיסים`
            : `${summary.transactionCount} עסקאות בכרטיס המסתיים ב־${summary.cards.join(', ')}`}
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
          {!card && summary.byCard.length > 1 && (
            <section className="section">
              <h2 className="section-title">לפי כרטיס</h2>
              {summary.byCard.map((c) => {
                const label = cardLabel(c.company, c.last4);
                return (
                  <button key={c.key} className="cat-row" onClick={() => selectCard(c.key)} aria-label={`${label}, ${ils(c.amount)}. הצגת הכרטיס הזה`}>
                    <span className="dot" style={{ background: 'var(--ink-2)' }} />
                    <span>{label}</span>
                    <span className="bar"><i style={{ width: `${(c.amount / maxCard) * 100}%`, background: 'var(--ink-2)' }} /></span>
                    <span className="amount">{ils(c.amount)}</span>
                  </button>
                );
              })}
            </section>
          )}
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
