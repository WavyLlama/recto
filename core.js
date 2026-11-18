// Shared state, helpers and view plumbing. Every module imports this file with the same URL.
import { cleanDeck, cleanProfile, dayKey, uid, review, DAY } from './logic.js?v=10';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=10';
import { icon } from './icons.js?v=10';
export { SUPABASE_URL, SUPABASE_KEY, icon };

export const app = document.getElementById('app');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
export const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
export const fmtDate = s => (s ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(s)) : '—');
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: data lives for this visit only */ } },
};

const KEY = 'recto.decks.v1', PKEY = 'recto.profile.v1';
export const state = {
  decks: {},
  profile: cleanProfile(null),
  sb: null,
  user: null,
  isAdmin: false,
  settings: { signups_open: true, announcement: '', ai_daily_limit: 30 },
  sync: SUPABASE_URL ? 'loading' : 'off',
  syncMsg: '',
  authMode: 'in',
};
// Filled in by sync.js and header.js, so this file needs no import of them.
export const hooks = { push() {}, pushProfile() {}, header() {} };

export const save = () => store.set(KEY, JSON.stringify(state.decks));
export const saveProfile = () => store.set(PKEY, JSON.stringify(state.profile));

try {
  for (const d of Object.values(JSON.parse(store.get(KEY)) || {})) {
    const c = cleanDeck(d);
    if (c) state.decks[c.id] = c;
  }
} catch { /* corrupt storage: start empty */ }
try { state.profile = cleanProfile(JSON.parse(store.get(PKEY))); } catch { /* keep the empty profile */ }

if (!store.get(KEY + '.seeded')) {
  if (!Object.keys(state.decks).length) {
    const pairs = [['France', 'Paris'], ['Italie', 'Rome'], ['Espagne', 'Madrid'], ['Portugal', 'Lisbonne'],
      ['Allemagne', 'Berlin'], ['Pologne', 'Varsovie'], ['Grèce', 'Athènes'], ['Suède', 'Stockholm']];
    const d = cleanDeck({ id: uid(), title: 'Exemple · Capitales d’Europe', cards: pairs.map(([term, def]) => ({ id: uid(), term, def })), updatedAt: 0 });
    state.decks[d.id] = d;
    save();
  }
  store.set(KEY + '.seeded', '1');
}

// Trash keeps decks 30 days, then only a tombstone remains (so other devices delete them too).
export const TRASH_DAYS = 30;
export function purge(d) {
  state.decks[d.id] = cleanDeck({ id: d.id, purged: true, updatedAt: Date.now(), tu: Date.now() });
  save();
  hooks.push(d.id);
}
for (const d of Object.values(state.decks)) if (d.deleted && !d.purged && Date.now() - d.deletedAt > TRASH_DAYS * DAY) purge(d);

export function touch(d, meta = false) {
  d.updatedAt = Date.now();
  if (meta) d.tu = d.updatedAt;
  save();
  hooks.push(d.id);
}
export function touchCard(d, c) { c.u = Date.now(); touch(d); }
export function removeCards(d, ids) {
  const now = Date.now();
  d.gone = { ...(d.gone || {}) };
  for (const id of ids) d.gone[id] = now;
  d.cards = d.cards.filter(c => !ids.includes(c.id));
  touch(d);
}

// Answers given in Apprendre, Test and Écriture also move a card's progress:
// a right answer counts as a review only when the card is new or due, a wrong one always does.
export function recordAnswer(d, c, ok, grade = 2) {
  const now = Date.now();
  if (ok && c.srs && c.srs.due > now) return;
  c.srs = review(c.srs, ok ? grade : 0, now);
  touchCard(d, c);
}

export const live = () => Object.values(state.decks).filter(d => !d.deleted).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
export const trashed = () => Object.values(state.decks).filter(d => d.deleted && !d.purged).sort((a, b) => b.deletedAt - a.deletedAt);
export const playable = (d, fav = false) => d.cards.filter(c => c.term.trim() && c.def.trim() && (!fav || c.star));
export const dueIn = (d, now = Date.now()) => playable(d).filter(c => c.srs && c.srs.due <= now).length;
export const newIn = d => playable(d).filter(c => !c.srs).length;
export const MASTERED_DAYS = 21;
export function mastery(d) {
  const ps = playable(d);
  const mastered = ps.filter(c => c.srs && c.srs.interval >= MASTERED_DAYS).length;
  const learning = ps.filter(c => c.srs && c.srs.interval < MASTERED_DAYS).length;
  const pct = n => (ps.length ? Math.round((n / ps.length) * 100) : 0);
  return { mastered, learning, total: ps.length, pct: pct(mastered), lpct: pct(learning) };
}
export const tint = d => `c${[...d.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 6}`;
export const meter = m => `<div class="meter" role="img" aria-label="${m.pct} % maîtrisé"><span class="m-done" style="width:${m.pct}%"></span><span class="m-learn" style="width:${m.lpct}%"></span></div>`;
export const backTo = d => `<a class="back-link" href="#deck/${d.id}">${icon('back')}${esc(d.title)}</a>`;
export const backHome = `<a class="back-link" href="#">${icon('back')}Mes sets</a>`;
export const autosize = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };

// Counts answers per day for the streak, the daily goal and the stats page.
let lastStudy = 0;
export function logStudy(n = 1) {
  const now = Date.now(), gap = (now - lastStudy) / 1000;
  const secs = lastStudy && gap < 300 ? Math.min(gap, 60) : 8;
  lastStudy = now;
  const k = dayKey(now), day = state.profile.days[k] || { n: 0, t: 0 };
  state.profile.days[k] = { n: day.n + n, t: Math.round(day.t + secs) };
  state.profile.updatedAt = now;
  saveProfile();
  hooks.pushProfile();
}

export function fr(message = '') {
  const m = String(message).toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('already registered')) return 'Un compte existe déjà avec cet e-mail. Connecte-toi plutôt.';
  if (m.includes('email not confirmed')) return 'Confirme d’abord ton adresse avec le lien reçu par e-mail.';
  if (m.includes('inscriptions sont fermées') || m.includes('database error saving new user')) return 'Les inscriptions sont fermées pour le moment.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Trop de tentatives. Réessaie dans quelques minutes.';
  if (m.includes('password should be')) return 'Le mot de passe doit faire au moins 8 caractères.';
  if (m.includes('same_password') || m.includes('should be different')) return 'Choisis un mot de passe différent de l’actuel.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Pas de connexion internet. Réessaie plus tard.';
  return message;
}

export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3500);
}

export function download(name, text, type = 'text/plain') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- languages for text-to-speech
export const LANGS = [['fr-FR', 'Français'], ['en-US', 'Anglais'], ['es-ES', 'Espagnol'], ['de-DE', 'Allemand'], ['it-IT', 'Italien'], ['pt-PT', 'Portugais'], ['nl-NL', 'Néerlandais'], ['ru-RU', 'Russe'], ['ar-SA', 'Arabe'], ['zh-CN', 'Chinois'], ['ja-JP', 'Japonais']];
export const canSpeak = 'speechSynthesis' in window;
export function speak(text, lang = 'fr-FR') {
  if (!canSpeak) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).replace(/\$+/g, ''));
  u.lang = lang;
  speechSynthesis.speak(u);
}
export const langOf = (d, side) => (side === 'term' ? d.langTerm : d.langDef) || 'fr-FR';

// ---------- external scripts (loaded only when needed)
const loaded = {};
export function loadScript(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject, crossOrigin: 'anonymous' });
    document.head.append(s);
  });
  return loaded[src];
}
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
}

// Formulas written between $…$ (inline) or $$…$$ (display) are rendered with KaTeX.
const KATEX = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11';
export async function renderMath(el) {
  if (!el || !/\$[^$]+\$/.test(el.textContent)) return;
  try {
    loadCss(`${KATEX}/katex.min.css`);
    await loadScript(`${KATEX}/katex.min.js`);
    await loadScript(`${KATEX}/contrib/auto-render.min.js`);
    window.renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false, ignoredTags: ['textarea', 'input', 'script', 'style', 'option'] });
  } catch { /* offline: formulas stay as text */ }
}

// Text and optional image of one side of a card.
export const faceHTML = (text, img) => `${img ? `<img class="face-img" src="${esc(img)}" alt="" loading="lazy">` : ''}<span class="face-text">${esc(text)}</span>`;

// ---------- profile (pseudo and photo live in the account's user_metadata)
// Recto keeps its own keys (pseudo, photo): Google rewrites name and avatar_url at every sign-in.
// An empty string means "removed on purpose", so it does not fall back to Google's value.
const meta = u => u?.user_metadata || {};
export const displayName = u => String(meta(u).pseudo ?? meta(u).name ?? meta(u).full_name ?? '').trim();
export const avatarURL = u => {
  const url = meta(u).photo ?? meta(u).avatar_url ?? meta(u).picture ?? '';
  return typeof url === 'string' && /^https:\/\//.test(url) ? url : '';
};
const hue = s => [...(s || '')].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 210);
export function avatarHTML(u, cls = '') {
  const url = avatarURL(u);
  if (url) return `<img class="avatar ${cls}" src="${esc(url)}" alt="">`;
  const label = displayName(u) || u?.email || '?';
  return `<span class="avatar ${cls}" style="--h:${hue(u?.email)}" aria-hidden="true">${esc(label.trim()[0].toUpperCase())}</span>`;
}

// ---------- theme
export function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
export const getTheme = () => store.get('recto.theme') || 'system';
export function setTheme(t) { store.set('recto.theme', t); applyTheme(t); }

// ---------- views: each view module registers itself in `views`
export const views = {};
let view = {};
export const currentView = () => view;
export function mount(html, v = {}) {
  view.cleanup?.();
  view = v;
  app.className = v.wide ? 'wide' : '';
  app.innerHTML = html;
  renderMath(app);
}
app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  const fn = el && view.click?.[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});
for (const type of ['input', 'change', 'dragstart', 'dragover', 'drop', 'dragend']) app.addEventListener(type, e => view[type]?.(e));
app.addEventListener('submit', e => { e.preventDefault(); view.submit?.(e); });
document.addEventListener('keydown', e => {
  if (!view.key || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, textarea, select, .menu')) return;
  if (e.target.closest?.('button, a') && (e.key === ' ' || e.key === 'Enter')) return; // the focused control handles it
  view.key(e);
});

const DECK_VIEWS = new Set(['deck', 'edit', 'print', 'cards', 'learn', 'test', 'match', 'write']);
export const routeName = () => location.hash.slice(1).split('/')[0];
// Creating and studying need an account; visitors get the landing page, Explorer and shared sets.
const NEEDS_ACCOUNT = new Set([...DECK_VIEWS, 'review', 'ai', 'stats', 'trash']);
export function route() {
  const [name = '', id, opt] = location.hash.slice(1).split('/');
  const d = id && state.decks[id] && !state.decks[id].deleted ? state.decks[id] : null;
  hooks.header();
  if (SUPABASE_URL && !state.user && NEEDS_ACCOUNT.has(name)) {
    if (state.sync === 'loading') return views.loading();
    state.returnTo = location.hash;
    return views.gate();
  }
  if (DECK_VIEWS.has(name)) return d ? views[name](d, opt === 'fav') : views.home();
  if (name === 'review') return views.review(d, opt === 'fav');
  if (name === 'ai') return views.ai(d);
  if (name === 's') return views.shared(id);
  (views[name] || views.home)();
}
addEventListener('hashchange', () => { route(); scrollTo(0, 0); });

// After a sync brought changes: redraw only screens without a session in progress.
export function refreshIfIdle() {
  if (['', 'deck', 'stats', 'trash', 'settings', 'account'].includes(routeName())) route();
}
