// Accounts and sync with Supabase. Without config.js values the app stays local-only.
import { merge, cleanProfile, mergeProfile } from './logic.js?v=5';
import { state, hooks, save, saveProfile, route, routeName, refreshIfIdle, fr, SUPABASE_URL, SUPABASE_KEY } from './core.js?v=5';

export function setSync(s, msg = '') {
  state.sync = s;
  state.syncMsg = msg;
  hooks.header();
}

export async function initSync() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return setSync('off');
  setSync('loading');
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
    state.sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch {
    setSync('error', 'Le service de synchronisation ne répond pas. Tes sets restent enregistrés sur cet appareil.');
    route();
    return;
  }
  const sb = state.sb;
  sb.auth.onAuthStateChange((event, session) => {
    const before = state.user?.id;
    state.user = session?.user || null;
    if (event === 'PASSWORD_RECOVERY') { state.authMode = 'recover'; location.hash = 'account'; }
    if (state.user?.id === before) return;
    // Supabase advises against awaiting its own calls inside this callback.
    setTimeout(async () => {
      await refreshAdmin();
      if (state.user) await pullAll();
      else setSync('signedout');
      if (['', 'account', 'admin', 'settings', 's', 'explore', 'ai'].includes(routeName())) route();
    }, 0);
  });
  loadSettings();
  const { data } = await sb.auth.getSession();
  if (!data.session) { setSync('signedout'); route(); }
}

export async function loadSettings() {
  const { data } = await state.sb.from('settings').select('signups_open,announcement,ai_daily_limit').eq('id', 1).maybeSingle();
  if (data) state.settings = data;
  const bar = document.getElementById('announce');
  bar.textContent = state.settings.announcement;
  bar.hidden = !state.settings.announcement.trim();
}

async function refreshAdmin() {
  state.isAdmin = false;
  if (state.user) {
    const { data } = await state.sb.rpc('is_admin');
    state.isAdmin = data === true;
  }
  hooks.header();
}

export async function pullAll() {
  const { sb, user } = state;
  if (!sb || !user) return;
  setSync('syncing');
  const [decks, prof] = await Promise.all([sb.from('decks').select('id,data'), sb.from('profiles').select('data').maybeSingle()]);
  if (decks.error) return setSync('error', fr(decks.error.message));
  const { merged, toPush } = merge(state.decks, decks.data);
  let changed = JSON.stringify(merged) !== JSON.stringify(state.decks);
  state.decks = merged;
  save();
  for (const id of toPush) if (!(await push(id))) return;
  if (!prof.error) {
    const remote = prof.data ? cleanProfile(prof.data.data) : null;
    const m = mergeProfile(state.profile, remote);
    changed ||= JSON.stringify(m) !== JSON.stringify(state.profile);
    state.profile = m;
    saveProfile();
    if (JSON.stringify(m) !== JSON.stringify(remote)) await pushProfileNow();
  }
  setSync('idle');
  if (changed) refreshIfIdle();
}

// What visitors of a share link see: no study progress, no favourites.
export const snapshot = d => ({ title: d.title, langTerm: d.langTerm, langDef: d.langDef, cards: d.cards.map(c => ({ term: c.term, def: c.def, ...(c.img ? { img: c.img } : {}) })) });
const sentShare = {};

export async function push(id) {
  const { sb, user } = state, d = state.decks[id];
  if (!sb || !user || !d) return false;
  const { error } = await sb.from('decks').upsert({ id, data: d, updated_at: new Date(d.updatedAt || Date.now()).toISOString() });
  if (error) { setSync('error', fr(error.message)); return false; }
  if (d.shareId && !d.deleted) {
    const row = { title: d.title, card_count: d.cards.length, public: !!d.public, data: snapshot(d) };
    const key = JSON.stringify(row);
    if (sentShare[d.shareId] !== key) {
      const res = await sb.from('shared_decks').update({ ...row, updated_at: new Date().toISOString() }).eq('id', d.shareId);
      if (!res.error) sentShare[d.shareId] = key;
    }
  }
  return true;
}

const timers = {};
function schedulePush(id) {
  if (!state.sb || !state.user) return;
  clearTimeout(timers[id]);
  timers[id] = setTimeout(async () => {
    delete timers[id];
    setSync('syncing');
    if (await push(id)) setSync('idle');
  }, 1500);
}

async function pushProfileNow() {
  const { sb, user } = state;
  if (!sb || !user) return;
  await sb.from('profiles').upsert({ user_id: user.id, data: state.profile, updated_at: new Date().toISOString() });
}
let profileTimer;
function schedulePushProfile() {
  if (!state.sb || !state.user) return;
  clearTimeout(profileTimer);
  profileTimer = setTimeout(pushProfileNow, 3000);
}

export function flushPushes() {
  for (const id of Object.keys(timers)) {
    clearTimeout(timers[id]);
    delete timers[id];
    push(id);
  }
  if (profileTimer) { clearTimeout(profileTimer); profileTimer = null; pushProfileNow(); }
}

hooks.push = schedulePush;
hooks.pushProfile = schedulePushProfile;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPushes();
  else pullAll(); // pick up what another device changed meanwhile
});
addEventListener('online', pullAll);
