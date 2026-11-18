// Pure logic, no DOM: tested by tests/logic.test.mjs.
export const DAY = 864e5;
export const uid = () => crypto.randomUUID();
const num = (x, dflt) => (typeof x === 'number' && Number.isFinite(x) ? x : dflt);

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Share links: 12 characters without look-alikes (no l, o, 0, 1).
export const slug = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

// ---------- import / export

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

// CSV with quotes (RFC 4180). Separator guessed from the first line: tab, then ; or ,.
export function parseCsv(text) {
  const t = String(text).replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const sep = first.includes('\t') ? '\t' : first.split(';').length >= first.split(',').length ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (t[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const cards = [];
  let skipped = 0;
  for (const r of rows) {
    const [term = '', def = ''] = r.map(s => s.trim());
    if (term && def) cards.push({ term, def });
    else if (term || def) skipped++;
  }
  if (cards.length && /^(terme|term|recto|question|mot)$/i.test(cards[0].term) && /^(d[ée]finition|verso|r[ée]ponse|answer)$/i.test(cards[0].def)) cards.shift();
  return { cards, skipped };
}

export function toCsv(cards) {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  return '﻿' + ['terme;définition', ...cards.map(c => `${q(c.term)};${q(c.def)}`)].join('\r\n');
}

// ---------- answers

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
  const tol = e.length >= 30 ? 3 : e.length >= 12 ? 2 : e.length >= 5 ? 1 : 0;
  return tol > 0 && lev(g, e) <= tol;
}

// The right answer plus up to n-1 distinct wrong ones, shuffled. AI-written distractors (card.alt) come first.
export function buildQcm(cards, card, field = 'def', n = 4) {
  const right = card[field];
  const seen = new Set([normalize(right)]), wrong = [];
  const pool = [...(field === 'def' && card.alt ? card.alt : []), ...shuffle(cards.filter(c => c.id !== card.id)).map(c => c[field])];
  for (const w of pool) {
    const k = normalize(w);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    wrong.push(w);
    if (wrong.length === n - 1) break;
  }
  return shuffle([right, ...wrong]);
}

// ---------- spaced repetition: FSRS-4.5 with default weights and 90 % target retention,
// where the next interval in days equals the stability.
const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5, FACTOR = 19 / 81;
const clampD = d => Math.min(10, Math.max(1, d));
const initD = g => clampD(W[4] - (g - 3) * W[5]);
const round2 = x => Math.round(x * 100) / 100;
export const retrievability = (days, s) => Math.pow(1 + (FACTOR * days) / s, DECAY);
function midnightPlus(now, days) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

// grade: 0 = à revoir, 1 = difficile, 2 = bien, 3 = facile (FSRS ratings 1 to 4).
export function review(srs, grade, now) {
  const g = grade + 1;
  let s, d, lapses = srs ? srs.lapses : 0;
  if (!srs) {
    s = W[g - 1];
    d = initD(g);
  } else {
    const r = retrievability(Math.max(0, (now - srs.last) / DAY), srs.s);
    d = clampD(W[7] * initD(3) + (1 - W[7]) * (srs.d - W[6] * (g - 3)));
    if (g === 1) {
      s = Math.min(srs.s, W[11] * Math.pow(srs.d, -W[12]) * (Math.pow(srs.s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
      lapses++;
    } else {
      s = srs.s * (1 + Math.exp(W[8]) * (11 - srs.d) * Math.pow(srs.s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
    }
  }
  s = Math.max(0.1, s);
  const interval = g === 1 ? 0 : Math.max(1, Math.round(s));
  return { s: round2(s), d: round2(d), last: now, reps: (srs ? srs.reps : 0) + 1, lapses, interval, due: g === 1 ? now + 10 * 60e3 : midnightPlus(now, interval) };
}

// Accepts the current FSRS state, or the SM-2 state saved by the first version of Recto.
function cleanSrs(x) {
  if (!x || typeof x.due !== 'number') return undefined;
  if (typeof x.s === 'number' && typeof x.d === 'number') {
    return { s: x.s, d: x.d, last: num(x.last, x.due), reps: num(x.reps, 0), lapses: num(x.lapses, 0), interval: num(x.interval, 0), due: x.due };
  }
  if (typeof x.interval === 'number') {
    return { s: Math.max(x.interval, 0.5), d: round2(clampD(13 - 3 * num(x.ease, 2.5))), last: x.due - x.interval * DAY, reps: num(x.reps, 0), lapses: 0, interval: x.interval, due: x.due };
  }
  return undefined;
}

// ---------- decks

function cleanCard(c) {
  if (!c || typeof c.id !== 'string' || typeof c.term !== 'string' || typeof c.def !== 'string') return null;
  const out = { id: c.id, term: c.term, def: c.def, u: num(c.u, 0) };
  if (c.star === true) out.star = true;
  if (typeof c.img === 'string' && /^https:\/\//.test(c.img)) out.img = c.img.slice(0, 600);
  if (Array.isArray(c.alt)) {
    const alt = c.alt.filter(a => typeof a === 'string' && a.trim()).slice(0, 5).map(a => a.slice(0, 500));
    if (alt.length) out.alt = alt;
  }
  const srs = cleanSrs(c.srs);
  if (srs) out.srs = srs;
  return out;
}

// Validates a deck from storage, a backup file or the server. Returns null if unusable.
// Key order is fixed so two equal decks serialise identically.
export function cleanDeck(d) {
  if (!d || typeof d.id !== 'string' || typeof d.updatedAt !== 'number') return null;
  // v1 tombstones had no deletedAt: treat them as permanently deleted.
  if (d.purged || (d.deleted && typeof d.deletedAt !== 'number')) {
    return { id: d.id, purged: true, deleted: true, title: '', cards: [], updatedAt: d.updatedAt, tu: num(d.tu, d.updatedAt) };
  }
  if (typeof d.title !== 'string' || !Array.isArray(d.cards)) return null;
  const out = { id: d.id, title: d.title.slice(0, 200), cards: d.cards.map(cleanCard).filter(Boolean), updatedAt: d.updatedAt, tu: num(d.tu, 0) };
  const folder = typeof d.folder === 'string' ? d.folder.trim().slice(0, 60) : '';
  if (folder) out.folder = folder;
  for (const k of ['langTerm', 'langDef']) if (typeof d[k] === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(d[k])) out[k] = d[k];
  if (typeof d.shareId === 'string' && /^[a-z0-9]{8,24}$/.test(d.shareId)) {
    out.shareId = d.shareId;
    if (d.public === true) out.public = true;
  }
  if (typeof d.bestMatch === 'number') out.bestMatch = d.bestMatch;
  if (d.deleted === true) { out.deleted = true; out.deletedAt = d.deletedAt; }
  if (d.gone && typeof d.gone === 'object') {
    const gone = {};
    for (const k of Object.keys(d.gone).sort()) if (typeof d.gone[k] === 'number') gone[k] = d.gone[k];
    if (Object.keys(gone).length) out.gone = gone;
  }
  return out;
}

// Card-level merge: the newest version of each card wins, deletions (gone) win over older edits,
// deck settings follow the most recent settings change (tu).
const META = ['title', 'folder', 'langTerm', 'langDef', 'shareId', 'public', 'deleted', 'deletedAt'];
export function mergeDeck(a, b) {
  if (!a || !b) return cleanDeck(a || b);
  const [newer, older] = a.updatedAt >= b.updatedAt ? [a, b] : [b, a];
  if (newer.purged || older.purged) return cleanDeck(newer);
  const meta = (a.tu || 0) >= (b.tu || 0) ? a : b;
  const gone = { ...(older.gone || {}) };
  for (const [k, v] of Object.entries(newer.gone || {})) gone[k] = Math.max(v, gone[k] || 0);
  const pick = new Map();
  for (const c of older.cards) pick.set(c.id, c);
  for (const c of newer.cards) {
    const o = pick.get(c.id);
    if (!o || (c.u || 0) >= (o.u || 0)) pick.set(c.id, c);
  }
  const cards = [];
  for (const c of [...newer.cards, ...older.cards]) {
    const best = pick.get(c.id);
    if (!best) continue;
    pick.delete(c.id);
    if (gone[c.id] && gone[c.id] >= (best.u || 0)) continue;
    cards.push(best);
  }
  const out = { id: a.id, title: '', cards, updatedAt: newer.updatedAt, tu: Math.max(a.tu || 0, b.tu || 0), gone };
  for (const k of META) if (meta[k] !== undefined) out[k] = meta[k];
  const best = [a.bestMatch, b.bestMatch].filter(x => typeof x === 'number');
  if (best.length) out.bestMatch = Math.min(...best);
  return cleanDeck(out);
}

// Decks never edited (updatedAt 0, e.g. the example) are not pushed.
export function merge(local, rows) {
  const merged = { ...local }, toPush = [], seen = new Set();
  for (const row of rows) {
    const remote = cleanDeck(row.data);
    if (!remote || remote.id !== row.id) continue;
    seen.add(row.id);
    const m = mergeDeck(local[row.id], remote);
    merged[row.id] = m;
    if (JSON.stringify(m) !== JSON.stringify(remote)) toPush.push(row.id);
  }
  for (const id of Object.keys(local)) if (!seen.has(id) && local[id].updatedAt > 0) toPush.push(id);
  return { merged, toPush };
}

// ---------- study history (streak, daily goal, time)

export const dayKey = ts => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function cleanProfile(p) {
  const out = { days: {}, goal: 20, goalAt: 0, updatedAt: 0 };
  if (!p || typeof p !== 'object') return out;
  if (p.days && typeof p.days === 'object') {
    for (const k of Object.keys(p.days).sort()) {
      const v = p.days[k];
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v.n === 'number') out.days[k] = { n: Math.max(0, Math.round(v.n)), t: Math.max(0, Math.round(num(v.t, 0))) };
    }
  }
  if (typeof p.goal === 'number') out.goal = Math.min(500, Math.max(5, Math.round(p.goal)));
  out.goalAt = num(p.goalAt, 0);
  out.updatedAt = num(p.updatedAt, 0);
  return out;
}

// shortcut: per-day counts merge with max, so studying on two devices the same day undercounts; upgrade to per-device counters if that matters.
export function mergeProfile(a, b) {
  if (!a || !b) return cleanProfile(a || b);
  const days = { ...a.days };
  for (const [k, v] of Object.entries(b.days)) {
    const x = days[k];
    days[k] = x ? { n: Math.max(x.n, v.n), t: Math.max(x.t, v.t) } : v;
  }
  const g = (a.goalAt || 0) >= (b.goalAt || 0) ? a : b;
  return cleanProfile({ days, goal: g.goal, goalAt: g.goalAt, updatedAt: Math.max(a.updatedAt, b.updatedAt) });
}

export function streak(days, now) {
  const has = k => (days[k]?.n || 0) > 0;
  const back = n => { const d = new Date(now); d.setDate(d.getDate() - n); return dayKey(d.getTime()); };
  let current = 0;
  for (let i = has(dayKey(now)) ? 0 : 1; has(back(i)); i++) current++;
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(days).filter(has).sort()) {
    const t = Date.parse(`${k}T12:00:00`);
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return { current, best: Math.max(best, current) };
}
