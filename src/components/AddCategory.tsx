import { useState } from 'react';
import { api } from '../api';
import { CATEGORY_PALETTE, MAX_CATEGORY_NAME } from '../../shared/core/categorize';
import type { Category } from '../../shared/api';

/** A small form for making a category of your own: a name and one of a few colors. */
export function AddCategory({ used, onAdded, onCancel }: { used: string[]; onAdded: (c: Category) => void; onCancel: () => void }) {
  const free = CATEGORY_PALETTE.filter((c) => !used.includes(c.toLowerCase()));
  const [name, setName] = useState('');
  const [color, setColor] = useState((free[0] ?? CATEGORY_PALETTE[0]));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      onAdded(await api.addCategory(name, color));
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : 'לא הצלחתי להוסיף את הקטגוריה.');
      setBusy(false);
    }
  }

  return (
    <form className="addcat" onSubmit={(e) => void submit(e)} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <input
        className="field" autoFocus required maxLength={MAX_CATEGORY_NAME} placeholder="שם הקטגוריה"
        aria-label="שם הקטגוריה" value={name} onChange={(e) => { setName(e.target.value); setError(''); }}
      />
      <div className="swatches" role="radiogroup" aria-label="צבע">
        {CATEGORY_PALETTE.map((c) => (
          <button
            key={c} type="button" role="radio" aria-checked={color === c} aria-label={c}
            className={color === c ? 'swatch on' : 'swatch'} style={{ background: c }} onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="addcat-actions">
        <button className="btn primary" type="submit" disabled={busy || !name.trim()}>הוספה</button>
        <button className="btn" type="button" onClick={onCancel}>ביטול</button>
      </div>
      {error && <p className="addcat-error" role="alert">{error}</p>}
    </form>
  );
}
