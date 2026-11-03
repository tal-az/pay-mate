import { useEffect, useState } from 'react';
import { api } from '../api';
import { ils, monthLabel } from '../format';
import type { Budget, MonthSummary } from '../../shared/api';
import type { Shared } from '../App';
import { AddCategory } from '../components/AddCategory';

/** What the user typed in an amount field; empty or zero means no amount. */
function parseAmount(raw: string): number | null {
  const value = Number(raw.replace(/[^\d.]/g, ''));
  return value > 0 ? value : null;
}

/** The plain sentence under the target: how the category budgets add up against it. */
function targetNote(allocated: number, target: number | null): string {
  if (!target) return allocated > 0 ? `סך התקציבים בקטגוריות: ${ils(allocated)}. קבעו יעד כדי להשוות אליו.` : 'קבעו יעד כדי לראות כמה ממנו כבר חילקתם לקטגוריות.';
  if (allocated > target) return `התקציבים בקטגוריות גבוהים מהיעד ב־${ils(allocated - target)}.`;
  if (allocated === target) return `חילקתם את כל היעד, ${ils(target)}.`;
  return `חילקתם ${ils(allocated)} מתוך ${ils(target)}. נותרו ${ils(target - allocated)} לחלוקה.`;
}

export function Budgets({ month, categories, refresh }: Shared) {
  const [adding, setAdding] = useState(false);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  const [summary, setSummary] = useState<MonthSummary | null>(null);

  useEffect(() => {
    void api.budgets().then(setBudgets);
    void api.monthlyTarget().then(setTarget);
    if (month) void api.summary(month).then(setSummary);
  }, [month]);

  async function save(key: string, raw: string) {
    await api.setBudget(key, parseAmount(raw));
    setBudgets(await api.budgets());
  }

  async function saveTarget(raw: string) {
    await api.setMonthlyTarget(parseAmount(raw));
    setTarget(await api.monthlyTarget());
  }

  const spent = new Map((summary?.byCategory ?? []).map((c) => [c.key, c.amount]));
  const budgetOf = new Map(budgets.map((b) => [b.categoryKey, b.monthlyAmount]));
  const shown = categories.filter((c) => c.key !== 'other');
  // Rounded to agorot so that amounts with decimals can add up to exactly the target.
  const allocated = Math.round(shown.reduce((sum, c) => sum + (budgetOf.get(c.key) ?? 0), 0) * 100) / 100;
  const over = target != null && allocated > target;
  const scale = target ? Math.max(target * 1.25, allocated) : 0;

  return (
    <>
      <h1 className="page-title">תקציבים{month ? ` · ${monthLabel(month)}` : ''}</h1>
      <p className="help" style={{ margin: '4px 0 20px' }}>
        קבעו סכום חודשי לקטגוריה. מעל 80% תופיע אזהרה, ומעל 100% סימון חריגה. השאירו ריק כדי לא לקבוע תקציב.
      </p>
      <section className="budget-target">
        <div className="budget-target-head">
          <label htmlFor="monthly-target">יעד הוצאה חודשי</label>
          <input
            id="monthly-target"
            className="field money"
            inputMode="numeric"
            placeholder="₪ בחודש"
            defaultValue={target ?? ''}
            onBlur={(e) => void saveTarget(e.target.value)}
          />
        </div>
        {target ? (
          <span className={`meter ${over ? 'over' : ''}`} aria-hidden="true">
            <i style={{ width: `${(allocated / scale) * 100}%` }} />
            <b style={{ insetInlineStart: `${(target / scale) * 100}%` }} />
          </span>
        ) : null}
        <p className={`budget-target-note ${over ? 'over' : ''}`}>{targetNote(allocated, target)}</p>
      </section>
      {shown.map((c) => {
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
