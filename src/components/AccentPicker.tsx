import { useEffect, useRef, useState } from 'react';
import { ACCENTS, applyAccent, currentAccent } from '../accent';

/** The logo tag doubles as a button that opens a small colour picker. */
export function AccentPicker() {
  const [open, setOpen] = useState(false);
  const [accent, setAccent] = useState(currentAccent);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        button.current?.focus();
      } else if (pop.current?.contains(e.target as Node) || button.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 10, left: Math.max(8, Math.min(r.left, window.innerWidth - 228)) });
    setOpen((o) => !o);
  };

  return (
    <>
      <button ref={button} type="button" className="brand-btn" onClick={toggle} aria-haspopup="true" aria-expanded={open} aria-label="בחירת צבע לאפליקציה" title="בחירת צבע">
        <svg className="brand-tag" viewBox="0 0 28 22" aria-hidden="true">
          <path d="M0 11 8 0h20v22H8z" fill="currentColor" />
          <circle cx="9" cy="11" r="2" fill="#1c1950" />
        </svg>
      </button>
      {open && (
        <div ref={pop} className="accent-pop" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label="צבע האפליקציה">
          <p>הצבע שלכם</p>
          <div className="swatches accent-swatches" role="radiogroup" aria-label="צבע האפליקציה">
            {ACCENTS.map((a) => (
              <button
                key={a.key} type="button" role="radio" aria-checked={accent.key === a.key} aria-label={a.name} title={a.name}
                className={accent.key === a.key ? 'swatch on' : 'swatch'} style={{ background: a.color }}
                onClick={() => { applyAccent(a, true); setAccent(a); }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
