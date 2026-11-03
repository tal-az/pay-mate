import { useState } from 'react';
import { api } from '../api';
import { errorText, FLAG_LABEL } from '../flags';
import { FLAG_KINDS, MAX_FLAG_COMMENT, type FlagKind } from '../../shared/api';

/** A small form for flagging a transaction: what is wrong with it, and a comment. Also edits or removes an existing flag. */
export function FlagEditor({ txId, initial, onDone, onCancel }: {
  txId: string;
  initial?: { kind: FlagKind; comment: string };
  onDone: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<FlagKind>(initial?.kind ?? 'attention');
  const [comment, setComment] = useState(initial?.comment ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (err) {
      setError(errorText(err, failure));
      setBusy(false);
    }
  }

  return (
    <form
      className="flag-editor"
      onSubmit={(e) => { e.preventDefault(); void run(() => api.setFlag(txId, kind, comment), 'לא הצלחתי לשמור את הדגל.'); }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <div className="flag-kinds" role="radiogroup" aria-label="סוג הדגל">
        {FLAG_KINDS.map((k) => (
          <button
            key={k} type="button" role="radio" aria-checked={kind === k}
            className={kind === k ? `flag-kind on ${k}` : `flag-kind ${k}`} onClick={() => setKind(k)}
          >
            {FLAG_LABEL[k]}
          </button>
        ))}
      </div>
      <textarea
        className="field" autoFocus rows={2} maxLength={MAX_FLAG_COMMENT} placeholder="הערה (לא חובה)"
        aria-label="הערה" value={comment} onChange={(e) => { setComment(e.target.value); setError(''); }}
      />
      <div className="addcat-actions">
        <button className="btn primary" type="submit" disabled={busy}>שמירה</button>
        <button className="btn" type="button" onClick={onCancel}>ביטול</button>
        {initial && (
          <button className="btn" type="button" disabled={busy} onClick={() => void run(() => api.clearFlag(txId), 'לא הצלחתי להסיר את הדגל.')}>
            הסרת הדגל
          </button>
        )}
      </div>
      {error && <p className="addcat-error" role="alert">{error}</p>}
    </form>
  );
}
