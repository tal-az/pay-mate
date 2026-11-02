import { ils, shortDate } from '../format';
import type { TxRow } from '../../shared/api';

const DAY = 86_400_000;
const MAX_DAYS = 62;

/** Spending per day across the visible transactions, so heavy days stand out. */
export function DailyStrip({ rows }: { rows: TxRow[] }) {
  const spend = rows.filter((r) => r.chargedAmount > 0);
  if (spend.length < 2) return null;

  const byDay = new Map<string, number>();
  for (const r of spend) byDay.set(r.purchaseDate, (byDay.get(r.purchaseDate) ?? 0) + r.chargedAmount);
  const days = [...byDay.keys()].sort();
  const first = Date.parse(days[0]);
  const last = Date.parse(days[days.length - 1]);
  const count = Math.round((last - first) / DAY) + 1;
  if (days.length < 2 || count > MAX_DAYS) return null;

  const cells = Array.from({ length: count }, (_, i) => {
    const iso = new Date(first + i * DAY).toISOString().slice(0, 10);
    return { iso, total: byDay.get(iso) ?? 0 };
  });
  const max = Math.max(...cells.map((c) => c.total), 1);
  const peak = cells.reduce((a, b) => (b.total > a.total ? b : a));

  return (
    <figure className="strip" aria-label={`הוצאה יומית. היום היקר ביותר: ${shortDate(peak.iso)}, ${ils(peak.total)}`}>
      <div className="strip-bars">
        {cells.map((c) => (
          <span key={c.iso} className="strip-col" title={`${shortDate(c.iso)}: ${ils(c.total)}`}>
            {c.iso === peak.iso && <em>{ils(c.total)}</em>}
            <i className={c.iso === peak.iso ? 'peak' : ''} style={{ height: c.total ? `${Math.max((c.total / max) * 100, 4)}%` : '0' }} />
          </span>
        ))}
      </div>
      <figcaption>
        <span>{shortDate(cells[0].iso)}</span>
        <span>הוצאה יומית</span>
        <span>{shortDate(cells[cells.length - 1].iso)}</span>
      </figcaption>
    </figure>
  );
}
