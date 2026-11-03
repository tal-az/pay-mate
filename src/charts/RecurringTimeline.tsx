import { ils, ilsExact, monthLabel, shortMonth } from '../format';
import { cardLabel } from '../../shared/core/cards';
import type { TimelineRow } from '../../shared/api';

/** One row per recurring charge, one cell per month. A hollow ring is a month where the charge is missing. */
export function RecurringTimeline({ rows, showCard = false }: { rows: TimelineRow[]; showCard?: boolean }) {
  if (rows.length === 0) return null;
  const months = rows[0].cells.map((c) => c.month);

  return (
    <div className="timeline" role="table" aria-label="חיובים קבועים לפי חודש">
      <div className="tl-row tl-head" role="row" style={{ gridTemplateColumns: `minmax(110px, 1fr) 70px repeat(${months.length}, 48px)` }}>
        <span role="columnheader">חיוב</span>
        <span role="columnheader" className="tl-num">בדרך כלל</span>
        {months.map((m) => <span key={m} role="columnheader" className="tl-m">{shortMonth(m)}</span>)}
      </div>
      {rows.map((r) => {
        const firstSeen = r.cells.find((c) => c.amount != null)?.month ?? '';
        return (
          <div key={`${r.card}-${r.merchant}`} className="tl-row" role="row" style={{ gridTemplateColumns: `minmax(110px, 1fr) 70px repeat(${months.length}, 48px)` }}>
            <span role="rowheader">{r.merchant}{showCard && <span className="flag">{cardLabel(r.company, r.cardLast4)}</span>}{r.holes > 0 &&<span className="flag warn">{r.holes === 1 ? 'חור אחד' : `${r.holes} חורים`}</span>}</span>
            <span className="tl-num">{ils(r.usual)}</span>
            {r.cells.map((c) => {
              const hole = c.covered && c.amount == null && c.month > firstSeen;
              const label = c.amount != null ? `${monthLabel(c.month)}: חויב ${ilsExact(c.amount)}` : hole ? `${monthLabel(c.month)}: לא חויב` : `${monthLabel(c.month)}: אין נתונים`;
              return (
                <span key={c.month} className="tl-cell" role="cell" title={label} aria-label={label}>
                  {c.amount != null ? <i className="tl-dot" /> : hole ? <i className="tl-hole" /> : <i className="tl-none" />}
                </span>
              );
            })}
          </div>
        );
      })}
      <p className="tl-legend">
        <span><i className="tl-dot" /> חויב</span>
        <span><i className="tl-hole" /> חסר, לא חויב החודש</span>
        <span><i className="tl-none" /> אין נתונים</span>
      </p>
    </div>
  );
}
