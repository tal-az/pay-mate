import { useState } from 'react';
import { ils } from '../format';

export interface Slice {
  key: string;
  name: string;
  color: string;
  amount: number;
}

const MAX_SLICES = 6;
const REST_COLOR = '#898781';

/** Largest categories keep their own slice; the tail folds into one gray slice so the ring stays readable. */
export function foldSlices(slices: Slice[]): Slice[] {
  const sorted = [...slices].filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);
  if (sorted.length <= MAX_SLICES + 1) return sorted;
  const head = sorted.slice(0, MAX_SLICES);
  const rest = sorted.slice(MAX_SLICES);
  return [...head, { key: 'rest', name: 'אחר ושונות', color: REST_COLOR, amount: rest.reduce((s, x) => s + x.amount, 0) }];
}

const SIZE = 210;
const R = 80;
const STROKE = 26;
const GAP = 2; // px of surface between slices

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function Donut({ slices, onSelect }: { slices: Slice[]; onSelect?: (key: string) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const parts = foldSlices(slices);
  const total = parts.reduce((s, p) => s + p.amount, 0);
  if (total <= 0 || parts.length < 2) return null;

  const cx = SIZE / 2;
  const gapAngle = GAP / R;
  let angle = -Math.PI / 2;
  const arcs = parts.map((p) => {
    const sweep = (p.amount / total) * Math.PI * 2;
    const a0 = angle + gapAngle / 2;
    const a1 = angle + sweep - gapAngle / 2;
    angle += sweep;
    return { ...p, a0, a1, pct: (p.amount / total) * 100 };
  });

  const shown = arcs.find((a) => a.key === active) ?? arcs[0];

  return (
    <div className="donut">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="חלוקת ההוצאות לפי קטגוריה">
        {arcs.map((a) => {
          const d = arc(cx, cx, R, a.a0, Math.max(a.a1, a.a0 + 0.001));
          const clickable = onSelect && a.key !== 'rest';
          return (
            <g
              key={a.key}
              className={`slice ${active === a.key ? 'on' : ''} ${clickable ? 'click' : ''}`}
              tabIndex={0}
              role={clickable ? 'button' : 'img'}
              aria-label={`${a.name}, ${ils(a.amount)}, ${Math.round(a.pct)}%`}
              onMouseEnter={() => setActive(a.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(a.key)}
              onBlur={() => setActive(null)}
              onClick={() => clickable && onSelect(a.key)}
              onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(a.key); } }}
            >
              <path d={d} stroke="transparent" strokeWidth={STROKE + 14} fill="none" />
              <path d={d} stroke={a.color} strokeWidth={active === a.key ? STROKE + 4 : STROKE} fill="none" />
            </g>
          );
        })}
      </svg>
      <div className="donut-center" aria-hidden="true">
        <b>{Math.round(shown.pct)}%</b>
        <span>{shown.name}</span>
        <span>{ils(shown.amount)}</span>
      </div>
    </div>
  );
}
