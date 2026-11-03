import { useEffect, useState } from 'react';
import { api } from '../api';
import { ils, monthLabel } from '../format';
import type { Budget, MonthSummary } from '../../shared/api';
import type { Shared } from '../App';
import { AddCategory } from '../components/AddCategory';

export function Budgets({ month, categories, refresh }: Shared) {
  const [adding, setAdding] = useState(false);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);

  useEffect(() => {
    void api.budgets().then(setBudgets);
    if (month) void api.summary(month).then(setSummary);
  }, [month]);

  async function save(key: string, raw: string) {
    const value = Number(raw.replace(/[^\d.]/g, ''));
    await api.setBudget(key, value > 0 ? value : null);
    setBudgets(await api.budgets());
  }

  const spent = new Map((summary?.byCategory ?? []).map((c) => [c.key, c.amount]));
  const budgetOf = new Map(budgets.map((b) => [b.categoryKey, b.monthlyAmount]));

  return (
    <>
      <h1 className="page-title">תקציבים{month ? ` · ${monthLabel(month)}` : ''}</h1>
      <p className="help" style={{ margin: '4px 0 20px' }}>
        קבעו סכום חודשי לקטגוריה. מעל 80% תופיע אזהרה, ומעל 100% סימון חריגה. השאירו ריק כדי לא לקבוע תקציב.
      </p>
      {categories.filter((c) => c.key !== 'other').map((c) => {
        const limit = budgetOf.get(c.key);
        const used = spent.get(c.key) ?? 0;
        const ratio = limit ? used / limit : 0;
        const status = !limit ? (used > 0 ? `הוצאתם ${ils(used)}` : '') : ratio > 1 ? `חריגה של ${ils(used - limit)}` : ratio >= 0.8 ? `נוצלו ${Math.round(ratio * 100)}%` : `נותרו ${ils(limit - used)}`;
        return (
          <div className="budget-row" key={c.key}>
            <span className="dot" style={{ background: c.color }} />
            <span>{c.name}</span>
            {limit ? (
              <span className="meter" aria-hidden="true">
                <i style={{ width: `${Math.min(used / Math.max(limit * 1.25, used), 1) * 100}%`, background: ratio >= 0.8 ? 'var(--tomato)' : c.color }} />
                <b style={{ insetInlineStart: `${(limit / Math.max(limit * 1.25, used)) * 100}%` }} />
              </span>
            ) : (
              <span className="help">ללא תקציב</span>
            )}
            <input
              className="field money"
              inputMode="numeric"
              aria-label={`תקציב חודשי ל${c.name}`}
              placeholder="₪ בחודש"
              defaultValue={limit ?? ''}
              onBlur={(e) => void save(c.key, e.target.value)}
            />
            <span className={`status ${ratio >= 0.8 ? 'warn' : ''}`}>{status}</span>
          </div>
        );
      })}
      <div style={{ marginTop: 20 }}>
        {adding ? (
          <AddCategory
            used={categories.map((c) => c.color.toLowerCase())}
            onCancel={() => setAdding(false)}
            onAdded={() => { setAdding(false); refresh(); }}
          />
        ) : (
          <button className="btn" onClick={() => setAdding(true)}>+ קטגוריה חדשה</button>
        )}
      </div>
    </>
  );
}
