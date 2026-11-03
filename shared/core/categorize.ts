export interface CategorySeed {
  key: string;
  name: string;
  color: string;
  /** Lower-cased substrings matched against the merchant name. */
  keywords: string[];
}

export const CATEGORY_SEEDS: CategorySeed[] = [
  { key: 'groceries', name: 'מזון ומכולת', color: '#2a78d6',
    keywords: ['שופרסל', 'רמי לוי', 'ויקטורי', 'יוחננוף', '=מגה', 'סופר', 'ירקות ופירות', 'מכולת', 'טיב טעם', 'אושר עד', 'חצי חינם', 'מרקט', 'market', 'ממתקים', 'אלוהה'] },
  { key: 'restaurants', name: 'מסעדות וקפה', color: '#eb6834',
    keywords: ['קפה', 'cafe', 'coffee', 'מסעדה', 'פיצה', 'פלאפל', 'סנדוויץ', 'לחמים', 'מאפה', 'ארומה', 'גרג', 'וולט', 'wolt', 'תן ביס', 'מקדונלד', 'בורגר', 'סושי', 'שווארמה', 'חומוס', 'בייקרי', 'bakery', 'טאקריה', 'שיפודים', 'גלידה', 'בוזה', 'buza', 'קופי', 'שומשום', '=בר', 'בארים', 'פיצריה'] },
  { key: 'transport', name: 'דלק ותחבורה', color: '#1baf7a',
    keywords: ['=פז', 'סונול', 'דלק', 'דור אלון', 'אי.אם.פי', 'אוטו-תל', 'חניה', 'רב קו', 'רב-קו', '=gett', '=uber', '=bird', '=lime', 'כביש 6', 'מנהרות', 'רכבת', '=אגד'] },
  { key: 'health', name: 'בריאות וטיפוח', color: '#eda100',
    keywords: ['סופר-פארם', 'סופר פארם', 'ניו פארם', 'פארם', 'בית מרקחת', 'מכבי', 'כללית', 'מאוחדת', 'לאומית', 'רופא', 'שיניים', 'אופטיק'] },
  { key: 'clothing', name: 'ביגוד והנעלה', color: '#e34948',
    keywords: ['זארה', 'zara', 'h&m', 'קסטרו', 'פוקס', 'גולף', 'טרמינל', 'שילב', 'נעליים', 'אדידס', 'נייקי'] },
  { key: 'subscriptions', name: 'מנויים ושירותים דיגיטליים', color: '#e87ba4',
    keywords: ['apple.com', 'google', 'netflix', 'spotify', 'youtube', '=aws', 'microsoft', 'openai', 'anthropic', 'disney', 'סלקום', 'פרטנר', 'בזק'] },
  { key: 'entertainment', name: 'בילוי ופנאי', color: '#6250d6',
    keywords: ['סינמה', 'קולנוע', 'yes planet', 'הצגה', 'תיאטרון', 'חדר כושר', 'סנטרל פארק'] },
  { key: 'bills', name: 'חשבונות וביטוח', color: '#008300',
    keywords: ['ביטוח', 'חברת החשמל', 'מקורות', 'ארנונה', 'עירייה', 'עיריית', 'וועד בית'] },
  { key: 'loads', name: 'טעינות ותשלומים', color: '#898781',
    keywords: ['טעינות', 'חבר כללי', 'paybox', 'פייבוקס'] },
  { key: 'donations', name: 'תרומות', color: '#898781',
    keywords: ['לטובה', 'עמותת', 'תרומה'] },
  { key: 'other', name: 'אחר', color: '#898781', keywords: [] },
];

export interface UserRule {
  pattern: string;
  categoryKey: string;
}

const BUILTIN = CATEGORY_SEEDS.flatMap((c) =>
  c.keywords.map((k) => ({ pattern: k.toLowerCase(), categoryKey: c.key })),
);

const tokensOf = (name: string) => name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** A pattern starting with "=" must equal a whole word of the merchant name; others match as substrings. */
function matches(name: string, tokens: string[], pattern: string): boolean {
  return pattern.startsWith('=') ? tokens.includes(pattern.slice(1)) : name.includes(pattern);
}

/**
 * Priority: user rules, then builtin keywords (the longest matching keyword wins, so "סופר-פארם"
 * beats "סופר"), then a standing-order + foreign-site heuristic, then "other".
 */
export function categorize(
  tx: { merchant: string; standingOrder: boolean; foreignSite: boolean },
  userRules: UserRule[],
): string {
  const name = tx.merchant.toLowerCase();
  const tokens = tokensOf(name);
  for (const r of userRules) if (matches(name, tokens, r.pattern)) return r.categoryKey;
  let best: { key: string; length: number } | null = null;
  for (const r of BUILTIN) {
    if (matches(name, tokens, r.pattern) && (!best || r.pattern.length > best.length)) {
      best = { key: r.categoryKey, length: r.pattern.length };
    }
  }
  if (best) return best.key;
  if (tx.standingOrder && tx.foreignSite) return 'subscriptions';
  return 'other';
}

/** Colors offered when the user adds a category. */
export const CATEGORY_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e34948', '#e87ba4', '#6250d6', '#008300', '#0f9fb5', '#a0522d', '#7a8b1f', '#c15fa8'];

export const SEED_KEYS = new Set(CATEGORY_SEEDS.map((c) => c.key));
export const MAX_CATEGORY_NAME = 30;
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface NewCategory {
  key: string;
  name: string;
  color: string;
}

/** Validates a user-made category and gives it a key. Throws an Error with a Hebrew message the interface can show. */
export function makeCategory(name: string, color: string, existing: Array<{ name: string }>): NewCategory {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('צריך לתת שם לקטגוריה.');
  if (clean.length > MAX_CATEGORY_NAME) throw new Error(`השם ארוך מדי (עד ${MAX_CATEGORY_NAME} תווים).`);
  if (!HEX_COLOR.test(color)) throw new Error('הצבע לא תקין.');
  const lower = clean.toLowerCase();
  if (existing.some((c) => c.name.trim().toLowerCase() === lower)) throw new Error('כבר יש קטגוריה בשם הזה.');
  const key = `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { key, name: clean, color: color.toLowerCase() };
}
