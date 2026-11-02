import { useEffect, useState } from 'react';

const AUTO_HIDE_MS = 15_000;

/** A small, quiet offer in the corner. It hides itself, and "later" simply closes it. */
export function MappingNudge({ count, monthName, onStart, onClose }: { count: number; monthName: string; onStart: () => void; onClose: () => void }) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (hovered) return;
    const t = setTimeout(onClose, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [hovered, onClose]);

  return (
    <aside className="nudge" role="status" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <svg className="nudge-tag" viewBox="0 0 28 22" aria-hidden="true">
        <path d="M0 11 L8 0 H28 V22 H8 Z" fill="var(--tag)" />
        <text x="17" y="16" textAnchor="middle" fontSize="14" fontWeight="800" fill="var(--tag-ink)">?</text>
      </svg>
      <div className="nudge-body">
        <p><b>{count === 1 ? 'עסק אחד' : `${count} עסקים`}</b> מ{monthName} עוד לא ממופים.</p>
        <p className="nudge-sub">נסדר אותם במשחק קצר?</p>
        <div className="nudge-actions">
          <button className="btn primary" onClick={onStart}>בואו נשחק</button>
          <button className="btn" onClick={onClose}>אחר כך</button>
        </div>
      </div>
    </aside>
  );
}
