import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { foreignAmount, ilsExact, shortDate } from '../format';
import { FLAG_LABEL } from '../flags';
import { FlagEditor } from '../components/FlagEditor';
import type { FlaggedTx } from '../../shared/api';
import type { Shared } from '../App';

/** Every flagged transaction, in all months, until it is resolved. */
export function Tasks({ refresh, go }: Shared) {
  const [items, setItems] = useState<FlaggedTx[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => setItems(await api.flags()), []);
  useEffect(() => { void load(); }, [load]);

  if (!items) return null;

  const open = items.filter((f) => !f.resolved);
  const shown = items.filter((f) => f.resolved === showResolved);

  async function toggle(f: FlaggedTx) {
    await api.resolveFlag(f.txId, !f.resolved);
    await load();
    refresh();
  }

  async function done() {
    setEditing(null);
    await load();
    refresh();
  }

  return (
    <>
      <h1 className="page-title">משימות פתוחות</h1>

      <div className="filters">
        <div className="seg" role="group" aria-label="סינון משימות">
          <button className="btn" aria-pressed={!showResolved} onClick={() => setShowResolved(false)}>פתוחות ({open.length})</button>
          <button className="btn" aria-pressed={showResolved} onClick={() => setShowResolved(true)}>טופלו ({items.length - open.length})</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p>{showResolved ? 'עוד לא טיפלתם באף משימה.' : items.length === 0 ? 'אין משימות. אפשר לסמן עסקה בדף העסקאות כחשודה, כטעות או כדורשת תשומת לב.' : 'אין משימות פתוחות. כל הכבוד!'}</p>
          {items.length === 0 && <p><button className="btn primary" onClick={() => go('transactions')}>לעסקאות</button></p>}
        </div>
      ) : (
        <ul className="tasks">
          {shown.map((f) => (
            <li key={f.txId} className={f.resolved ? 'task done' : 'task'}>
              <div className="task-head">
                <span className={`flag-chip ${f.kind}`}>{FLAG_LABEL[f.kind]}</span>
                <b>{f.merchant}</b>
                <span className="date">{shortDate(f.purchaseDate)}</span>
                <span className="num">
                  {f.originalCurrency !== 'ILS' && <span className="flag">{foreignAmount(f.originalCurrency, f.originalAmount)}</span>}
                  <b>{ilsExact(f.chargedAmount)}</b>
                </span>
              </div>
              {editing === f.txId ? (
                <FlagEditor txId={f.txId} initial={{ kind: f.kind, comment: f.comment }} onDone={() => void done()} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  {f.comment && <p className="task-comment">{f.comment}</p>}
                  <div className="addcat-actions">
                    <button className="btn primary" onClick={() => void toggle(f)}>{f.resolved ? 'פתיחה מחדש' : 'סימון כטופל'}</button>
                    <button className="btn" onClick={() => setEditing(f.txId)} aria-label={`עריכת הדגל של ${f.merchant}`}>עריכה</button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
