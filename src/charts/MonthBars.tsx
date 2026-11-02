import { ils, monthLabel, shortMonth } from '../format';
import type { MonthTotal } from '../../shared/api';

/** The last few billing months side by side, with the selected month emphasized and the rest gray. */
export function MonthBars({ totals, selected, onSelect }: { totals: MonthTotal[]; selected: string | null; onSelect: (month: string) => void }) {
  const shown = totals.slice(-6);
  if (shown.length < 2) return null;
  const max = Math.max(...shown.map((t) => t.total), 1);

  return (
    <div className="monthbars" role="group" aria-label="סך החיוב בכל חודש">
      {shown.map((t) => {
        const on = t.month === selected;
        return (
          <button
            key={t.month}
            className={`mb ${on ? 'on' : ''}`}
            onClick={() => onSelect(t.month)}
            aria-pressed={on}
            aria-label={`${monthLabel(t.month)}, ${ils(t.total)}`}
            title={`${monthLabel(t.month)}: ${ils(t.total)}`}
          >
            <span className="mb-value">{ils(t.total)}</span>
            <span className="mb-track"><i style={{ height: `${Math.max((t.total / max) * 100, 2)}%` }} /></span>
            <span className="mb-label">{shortMonth(t.month)}</span>
          </button>
        );
      })}
    </div>
  );
}
