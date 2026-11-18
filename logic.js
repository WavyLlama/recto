// Pure logic, no DOM: tested by tests/logic.test.mjs.
export const DAY = 864e5;
export const uid = () => crypto.randomUUID();

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// One card per line: term, separator, definition. Separators tried in this order.
const SEPS = ['\t', ';', ' - ', ' – ', ':'];
export function parseImport(text) {
  const cards = [];
  let skipped = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sep = SEPS.find(s => line.indexOf(s) > 0);
    if (!sep) { skipped++; continue; }
    const i = line.indexOf(sep);
    const term = line.slice(0, i).trim();
    const def = line.slice(i + sep.length).trim();
    if (term && def) cards.push({ term, def });
    else skipped++;
  }
  return { cards, skipped };
}

const ARTICLES = /^(le|la|les|un|une|des|du|de la|the|a|an|to)\s+/;
export function normalize(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^l'\s*/, '').replace(ARTICLES, '');
}

function lev(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return row[b.length];
}

// Tolerates case, accents, punctuation, leading articles and small typos.
export function sameAnswer(given, expected) {
  const g = normalize(given), e = normalize(expected);
  if (!g) return false;
  if (g === e) return true;
  const tol = e.length >= 12 ? 2 : e.length >= 5 ? 1 : 0;
  return tol > 0 && lev(g, e) <= tol;
}

// Simplified SM-2. grade: 0 = à revoir, 1 = difficile, 2 = bien, 3 = facile.
// Cards fall due at local midnight so a card is due all day, not from the hour it was reviewed.
export function review(srs, grade, now) {
  let { interval = 0, ease = 2.5, reps = 0 } = srs || {};
  if (grade === 0) return { interval: 0, ease: Math.max(1.3, ease - 0.2), reps: 0, due: now + 10 * 60e3 };
  if (grade === 1) ease = Math.max(1.3, ease - 0.15);
  if (grade === 3) ease += 0.15;
  if (reps === 0) interval = [0, 1, 1, 3][grade];
  else interval = Math.max(interval + 1, Math.round(interval * [0, 1.2, ease, ease * 1.3][grade]));
  const due = new Date(now);
  due.setHours(0, 0, 0, 0);
  due.setDate(due.getDate() + interval);
  return { interval, ease: Math.round(ease * 100) / 100, reps: reps + 1, due: due.getTime() };
}

// The right answer plus up to n-1 distinct wrong ones, shuffled.
export function buildQcm(cards, card, n = 4) {
  const seen = new Set([normalize(card.def)]);
  const wrong = [];
  for (const c of shuffle(cards)) {
    const k = normalize(c.def);
    if (c.id === card.id || seen.has(k)) continue;
    seen.add(k);
    wrong.push(c.def);
    if (wrong.length === n - 1) break;
  }
  return shuffle([card.def, ...wrong]);
}

// Validates a deck from storage, a backup file or the server. Returns null if unusable.
export function cleanDeck(d) {
  if (!d || typeof d.id !== 'string' || typeof d.updatedAt !== 'number') return null;
  if (d.deleted) return { id: d.id, deleted: true, title: '', cards: [], updatedAt: d.updatedAt };
  if (typeof d.title !== 'string' || !Array.isArray(d.cards)) return null;
  const cards = d.cards
    .filter(c => c && typeof c.id === 'string' && typeof c.term === 'string' && typeof c.def === 'string')
    .map(c => {
      const s = c.srs;
      const ok = s && ['interval', 'ease', 'reps', 'due'].every(k => typeof s[k] === 'number');
      return ok ? { id: c.id, term: c.term, def: c.def, srs: { interval: s.interval, ease: s.ease, reps: s.reps, due: s.due } }
        : { id: c.id, term: c.term, def: c.def };
    });
  const out = { id: d.id, title: d.title, cards, updatedAt: d.updatedAt };
  if (typeof d.bestMatch === 'number') out.bestMatch = d.bestMatch;
  return out;
}

// Last write wins per deck. Decks never edited (updatedAt 0, e.g. the example) are not pushed.
export function merge(local, rows) {
  const merged = { ...local }, toPush = [], seen = new Set();
  for (const row of rows) {
    const remote = cleanDeck(row.data);
    if (!remote || remote.id !== row.id) continue;
    seen.add(row.id);
    const l = local[row.id];
    if (!l || remote.updatedAt > l.updatedAt) merged[row.id] = remote;
    else if (l.updatedAt > remote.updatedAt) toPush.push(row.id);
  }
  for (const id of Object.keys(local)) if (!seen.has(id) && local[id].updatedAt > 0) toPush.push(id);
  return { merged, toPush };
}
