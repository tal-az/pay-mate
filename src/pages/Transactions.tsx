import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { foreignAmount, ilsExact, monthLabel, shortDate } from '../format';
import { DailyStrip } from '../charts/DailyStrip';
import type { TxRow } from '../../shared/api';
import type { Shared } from '../App';

export function Transactions({ month, months, categories, filterCategory, go, refresh }: Shared) {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(filterCategory);
  const [pending, setPending] = useState<{ tx: TxRow; key: string } | null>(null);

  useEffect(() => {
    if (month) void api.transactions(month).then(setRows);
  }, [month]);

  const catByKey = useMemo(() => new Map(categories.map((c) => [c.key, c])), [categories]);
  const shown = rows.filter(
    (t) => (!category || t.categoryKey === category) && (!query || t.merchant.toLowerCase().includes(query.trim().toLowerCase())),
  );

  async function apply(all: boolean) {
    if (!pending) return;
    await api.setCategory(pending.tx.id, pending.key, all);
    setPending(null);
    if (month) setRows(await api.transactions(month));
    refresh();
  }

  if (!month) {
    return (
      <div className="empty">
        <h2>אין עסקאות להצגה</h2>
        <p><button className="btn primary" onClick={() => go('settings')}>ייבוא קובץ</button></p>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">עסקאות · {monthLabel(month)}</h1>

      <div className="filters">
        <input className="field" type="search" placeholder="חיפוש בית עסק" aria-label="חיפוש בית עסק" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="field" aria-label="סינון לפי קטגוריה" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">כל הקטגוריות</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <span className="help" style={{ alignSelf: 'center' }}>{shown.length} מתוך {rows.length}</span>
      </div>

      <DailyStrip rows={shown} />

      {pending && (
        <div className="notice" role="status">
          <span>
            לשנות את הקטגוריה של <b>{pending.tx.merchant}</b> ל{catByKey.get(pending.key)?.name}?
          </span>
          <button className="btn primary" onClick={() => apply(true)}>כן, לכל החיובים מבית העסק הזה</button>
          <button className="btn" onClick={() => apply(false)}>רק החיוב הזה</button>
          <button className="btn" onClick={() => setPending(null)}>ביטול</button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty"><p>לא נמצאו עסקאות. נסו לנקות את הסינון.</p></div>
      ) : (
        <table className="tx">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>בית עסק</th>
              <th>קטגוריה</th>
              <th className="num">סכום</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id}>
                <td className="date">{shortDate(t.purchaseDate)}</td>
                <td>
                  {t.merchant}
                  {t.standingOrder && <span className="flag">הוראת קבע</span>}
                  {t.originalCurrency !== 'ILS' && <span className="flag">{foreignAmount(t.originalCurrency, t.originalAmount)}</span>}
                </td>
                <td>
                  <select
                    className="cat-select"
                    aria-label={`קטגוריה של ${t.merchant}`}
                    value={t.categoryKey}
                    onChange={(e) => setPending({ tx: t, key: e.target.value })}
                  >
                    {categories.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                  </select>
                </td>
                <td className="num"><b>{ilsExact(t.chargedAmount)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
