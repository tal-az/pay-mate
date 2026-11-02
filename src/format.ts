const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const ilsFormat = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const ilsFormatCents = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2 });

export function ils(n: number): string {
  return ilsFormat.format(Math.round(n));
}

export function ilsExact(n: number): string {
  return ilsFormatCents.format(n);
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

const SHORT_MONTHS = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];

/** 2026-09 -> ספט׳ 26 */
export function shortMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${SHORT_MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

/** 2026-09-29 -> 29.09 */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

export function foreignAmount(currency: string, amount: number): string {
  return `${amount.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ${currency}`;
}
