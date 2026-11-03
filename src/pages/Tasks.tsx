import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { foreignAmount, ilsExact, monthLabel, shortDate } from '../format';
import { FLAG_LABEL } from '../flags';
import { FlagEditor } from '../components/FlagEditor';
import type { FlaggedTx, InsightFlag } from '../../shared/api';
import type { Shared } from '../App';

/** One entry on the follow-up list: a flagged transaction or a flagged insight. */
type Entry =
  | { type: 'tx'; id: string; createdAt: string; resolved: boolean; flag: FlaggedTx }
  | { type: 'insight'; id: string; createdAt: string; resolved: boolean; flag: InsightFlag };

/** Everything the user flagged, in all months, until it is marked as handled. */
export function Tasks({ refresh, go }: Shared) {
  const [items, setItems] = useState<Entry[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [txs, insights] = await Promise.all([api.flags(), api.insightFlags()]);
    const all: Entry[] = [
      ...txs.map((f): Entry => ({ type: 'tx', id: `tx:${f.txId}`, createdAt: f.createdAt, resolved: f.resolved, flag: f })),
      ...insights.map((f): Entry => ({ type: 'insight', id: `insight:${f.key}`, createdAt: f.createdAt, resolved: f.resolved, flag: f })),
    ];
    setItems(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!items) return null;

  const open = items.filter((e) => !e.resolved);
  const shown = items.filter((e) => e.resolved === showResolved);

  async function toggle(e: Entry) {
    if (e.type === 'tx') await api.resolveFlag(e.flag.txId, !e.resolved);
    else await api.resolveInsightFlag(e.flag.key, !e.resolved);
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
      <h1 className="page-title">סומן למעקב</h1>
      <p className="help" style={{ margin: '4px 0 0' }}>עסקאות ותובנות שסימנתם בדגל, כדי לחזור אליהן בהמשך.</p>

      <div className="filters">
        <div className="seg" role="group" aria-label="סינון הרשימה">
          <button className="btn" aria-pressed={!showResolved} onClick={() => setShowResolved(false)}>לטיפול ({open.length})</button>
          <button className="btn" aria-pressed={showResolved} onClick={() => setShowResolved(true)}>טופלו ({items.length - open.length})</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p>
            {showResolved
              ? 'עוד לא סימנתם פריט כמטופל.'
              : items.length === 0
                ? 'אין כאן עדיין כלום. אפשר לסמן עסקה או תובנה בדגל, והן יופיעו כאן.'
                : 'אין פריטים שמחכים לטיפול. כל הכבוד!'}
          </p>
          {items.length === 0 && <p><button className="btn primary" onClick={() => go('transactions')}>לעסקאות</button></p>}
        </div>
      ) : (
        <ul className="tasks">
          {shown.map((e) => (
            <li key={e.id} className={e.resolved ? 'task done' : 'task'}>
              {e.type === 'tx' ? (
                <div className="task-head">
                  <span className={`flag-chip ${e.flag.kind}`}>{FLAG_LABEL[e.flag.kind]}</span>
                  <b>{e.flag.merchant}</b>
                  <span className="date">{shortDate(e.flag.purchaseDate)}</span>
                  <span className="num">
                    {e.flag.originalCurrency !== 'ILS' && <span className="flag">{foreignAmount(e.flag.originalCurrency, e.flag.originalAmount)}</span>}
                    <b>{ilsExact(e.flag.chargedAmount)}</b>
                  </span>
                </div>
              ) : (
                <>
                  <div className="task-head">
                    <span className="flag-chip insight">תובנה</span>
                    <span className="date">{monthLabel(e.flag.month)}</span>
                  </div>
                  <p className="task-text">{e.flag.text}</p>
                </>
              )}
              {editing === e.id ? (
                <FlagEditor
                  kinds={e.type === 'tx'}
                  initial={{ kind: e.type === 'tx' ? e.flag.kind : 'attention', comment: e.flag.comment }}
                  save={(kind, comment) => (e.type === 'tx'
                    ? api.setFlag(e.flag.txId, kind, comment)
                    : api.setInsightFlag(e.flag.month, { id: e.flag.key.slice(e.flag.month.length + 1), kind: e.flag.insightKind, text: e.flag.text }, comment))}
                  remove={() => (e.type === 'tx' ? api.clearFlag(e.flag.txId) : api.clearInsightFlag(e.flag.key))}
                  onDone={() => void done()}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  {e.flag.comment && <p className="task-comment">{e.flag.comment}</p>}
                  <div className="addcat-actions">
                    <button className="btn primary" onClick={() => void toggle(e)}>{e.resolved ? 'פתיחה מחדש' : 'סימון כטופל'}</button>
                    <button className="btn" onClick={() => setEditing(e.id)}>עריכה</button>
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
