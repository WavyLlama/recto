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
    if (d.hideAuthor === true) out.hideAuthor = true;
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
const META = ['title', 'folder', 'langTerm', 'langDef', 'shareId', 'public', 'hideAuthor', 'deleted', 'deletedAt'];
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

// Copies a merged deck into the existing deck and card objects, so screens holding references keep working.
function replaceContent(target, source) {
  for (const k of Object.keys(target)) delete target[k];
  return Object.assign(target, source);
}
export function adopt(old, fresh) {
  if (old === fresh) return old;
  const byId = new Map(old.cards.map(c => [c.id, c]));
  const cards = fresh.cards.map(c => {
    const o = byId.get(c.id);
    return o && o !== c ? replaceContent(o, { ...c }) : c;
  });
  return replaceContent(old, { ...fresh, cards });
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

// ---------- AI exam: plan, question checks, automatic grading, score
// w = points of a question in the weighted scale.
export const EXAM_TYPES = {
  qcm: { label: 'QCM', w: 1, desc: 'Une ou plusieurs bonnes réponses parmi quatre.' },
  vf: { label: 'Vrai ou faux', w: 1, desc: 'Une affirmation à juger, avec justification possible.' },
  association: { label: 'Association', w: 2, desc: 'Relier des notions à leur définition.' },
  ouverte: { label: 'Question ouverte', w: 3, desc: 'Une réponse rédigée en quelques phrases.' },
  reflexion: { label: 'Réflexion', w: 4, desc: 'Expliquer, comparer, argumenter.' },
  cas: { label: 'Cas pratique', w: 6, desc: 'Une situation concrète où appliquer tes notions.' },
};
export const WRITTEN = new Set(['ouverte', 'reflexion', 'cas']);
const MIX = ['facile', 'intermediaire', 'difficile'];
const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
const list = x => (Array.isArray(x) ? x : []);

// One slot per question: type, difficulty and the ids of the cards it rests on.
// cards: the cards to cover, in priority order; o: the exam settings.
export function examSlots(cards, o) {
  const types = cards.length >= 3 ? o.types : o.types.filter(t => t !== 'association');
  const kinds = shuffle(Array.from({ length: o.count }, (_, i) => (types.length ? types : ['qcm'])[i % (types.length || 1)]));
  let multi = 0;
  return kinds.map((type, i) => {
    const take = type === 'association' ? Math.min(4, cards.length) : type === 'cas' || type === 'reflexion' ? Math.min(2, cards.length) : 1;
    const ids = [...new Set(Array.from({ length: take }, (_, k) => cards[(i + k) % cards.length].id))];
    const s = { type, difficulty: o.difficulty === 'mixte' ? MIX[(i + Math.floor(Math.random() * 3)) % 3] : o.difficulty, cards: ids };
    if (type === 'qcm') s.multiple = o.qcmMode === 'multi' || (o.qcmMode === 'both' && multi++ % 2 === 1);
    if (type === 'vf') s.justify = !!o.vfJustify;
    return s;
  });
}

// Checks a question written by the AI against its slot; returns null when it is unusable.
// The cards come from the slot, never from the AI, so the progress update stays on the right cards.
export function cleanQuestion(r, slot, uniform = false) {
  const prompt = str(r?.prompt, 4000);
  if (!prompt) return null;
  const { type } = slot;
  const q = { id: uid(), type, difficulty: slot.difficulty, cards: slot.cards, prompt, hint: str(r.hint, 600), explanation: str(r.explanation, 2000), points: EXAM_TYPES[type].w };
  if (type === 'qcm') {
    const opts = list(r.options).map(o => str(o, 500)).filter(Boolean).slice(0, 6);
    const good = new Set(list(r.correct).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < opts.length));
    if (opts.length < 2 || !good.size || good.size === opts.length) return null;
    const order = shuffle(opts.map((_, i) => i)); // the right answer is not always A
    q.options = order.map(i => opts[i]);
    q.correct = order.flatMap((i, k) => (good.has(i) ? [k] : []));
    q.multiple = q.correct.length > 1 || !!slot.multiple;
  } else if (type === 'vf') {
    if (typeof r.answer !== 'boolean') return null;
    q.answer = r.answer;
    q.justify = !!slot.justify;
    if (q.justify) q.points = 2;
  } else if (type === 'association') {
    const pairs = list(r.pairs).map(p => ({ left: str(p?.left, 300), right: str(p?.right, 500) })).filter(p => p.left && p.right).slice(0, 6);
    if (pairs.length < 2) return null;
    q.pairs = pairs;
    q.rightOrder = shuffle(pairs.map((_, i) => i));
  } else {
    q.expected = str(r.expected, 4000);
    if (!q.expected) return null;
    q.criteria = list(r.criteria).map(c => ({ label: str(c?.label, 200), weight: Math.min(3, Math.max(1, Number(c?.weight) || 1)) })).filter(c => c.label).slice(0, 6);
    if (!q.criteria.length) q.criteria = [{ label: 'Exactitude et complétude de la réponse', weight: 1 }];
  }
  if (uniform) q.points = 1;
  return q;
}

export const answered = (q, a) => (a == null ? false
  : q.type === 'qcm' ? Array.isArray(a) && a.length > 0
    : q.type === 'vf' ? typeof a.v === 'boolean'
      : q.type === 'association' ? Object.values(a).some(v => v !== '' && v != null)
        : String(a).trim().length > 0);

const result = (q, earned, more) => {
  const e = Math.min(q.points, Math.max(0, round2(earned))), r = e / q.points;
  return { earned: e, max: q.points, verdict: r >= 0.8 ? 'ok' : r > 0.2 ? 'pa' : 'ko', ...more };
};
export const naResult = (q, error) => ({ earned: 0, max: q.points, verdict: 'na', error });
const vfExpected = q => `${q.answer ? 'Vrai' : 'Faux'}${q.explanation ? `. ${q.explanation}` : ''}`;

// Grades what needs no AI; returns null for answers the AI must correct.
export function gradeAuto(q, a) {
  if (q.type === 'qcm') {
    const sel = Array.isArray(a) ? a : [];
    const good = sel.filter(i => q.correct.includes(i)).length;
    const earned = q.correct.length === 1 && !q.multiple ? (sel.length === 1 && good === 1 ? q.points : 0)
      : Math.max(0, (good - (sel.length - good)) / q.correct.length) * q.points;
    return result(q, earned, { expected: q.correct.map(i => `${String.fromCharCode(65 + i)}. ${q.options[i]}`).join('\n') });
  }
  if (q.type === 'vf') {
    const right = a?.v === q.answer;
    if (!q.justify) return result(q, right ? q.points : 0, { expected: vfExpected(q) });
    if (!right || !String(a?.j || '').trim()) return result(q, right ? 0.6 * q.points : 0, { expected: vfExpected(q), missing: right ? ['Justification absente.'] : [] });
    return null;
  }
  if (q.type === 'association') {
    const ok = q.pairs.filter((_, i) => String(a?.[i]) === String(i)).length;
    return result(q, (ok / q.pairs.length) * q.points, { expected: q.pairs.map(p => `${p.left} → ${p.right}`).join('\n') });
  }
  if (!String(a || '').trim()) return result(q, 0, { expected: q.expected, missing: ['Aucune réponse.'] });
  return null;
}

// Grading grid sent to the AI, in points: the justification of a true/false is worth 40 %.
export function examCriteria(q) {
  if (q.type === 'vf') return [{ label: 'Justification exacte et fondée', max: round2(0.4 * q.points) }];
  const sum = q.criteria.reduce((s, c) => s + c.weight, 0);
  return q.criteria.map(c => ({ label: c.label, max: round2((c.weight / sum) * q.points) }));
}

// Turns the AI's correction of one answer into a result.
export function fromAi(q, r) {
  const grid = examCriteria(q);
  const criteria = grid.map((c, i) => {
    const x = list(r?.criteria)[i] || {};
    return { label: c.label, max: c.max, awarded: round2(Math.min(c.max, Math.max(0, Number(x.awarded) || 0))), comment: str(x.comment, 400) };
  });
  const lines = x => list(x).map(s => str(s, 400)).filter(Boolean).slice(0, 5);
  return result(q, (q.type === 'vf' ? 0.6 * q.points : 0) + criteria.reduce((s, c) => s + c.awarded, 0), {
    ai: true, criteria, strengths: lines(r?.strengths), errors: lines(r?.errors), missing: lines(r?.missing),
    explanation: str(r?.explanation, 2000), confidence: ['haute', 'moyenne', 'faible'].includes(r?.confidence) ? r.confidence : 'moyenne',
    expected: q.type === 'vf' ? vfExpected(q) : q.expected,
  });
}

// Mark out of 20 over the corrected questions; provisional while some could not be corrected.
export function scoreOf(questions, results) {
  let earned = 0, max = 0, na = 0;
  for (const q of questions) {
    const r = results[q.id];
    if (!r || r.verdict === 'na') { na++; continue; }
    earned += r.earned;
    max += r.max;
  }
  return { earned, max, score20: max ? round2((earned / max) * 20) : 0, na };
}
export const levelOf = s => (s >= 16 ? 'Très bien' : s >= 14 ? 'Bien' : s >= 12 ? 'Assez bien' : s >= 10 ? 'Passable' : s >= 7 ? 'Insuffisant' : 'Très insuffisant');

// A card whose exam questions were all right counts as learned: at least `days` before it comes back.
export function masterSrs(srs, now, days = 21) {
  const r = review(srs, 3, now);
  return r.interval >= days ? r : { ...r, s: Math.max(r.s, days), interval: days, due: midnightPlus(now, days) };
}
