// Top bar: navigation, account menu, keyboard shortcuts dialog.
import { state, hooks, esc, icon, route, routeName, trashed, getTheme, setTheme, SUPABASE_URL, toast, avatarHTML, displayName } from './core.js?v=12';
import { flushPushes } from './sync.js?v=12';

const area = document.getElementById('account-area');
const SYNC = { off: 'Enregistré sur cet appareil', loading: 'Connexion…', signedout: '', syncing: 'Synchronisation…', idle: 'Synchronisé', error: 'Erreur de synchronisation' };
const THEMES = [['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']];
let open = false;


function render() {
  const name = routeName();
  document.querySelectorAll('.nav a').forEach(a => {
    const on = a.dataset.nav === ({ '': 'home', review: 'review', explore: 'explore', stats: 'stats' }[name] ?? '');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const { user } = state;
  if (!SUPABASE_URL) {
    area.innerHTML = `<a class="icon-link" href="#settings" aria-label="Paramètres">${icon('settings')}</a>`;
    return;
  }
  if (!user) {
    area.innerHTML = state.sync === 'loading' ? '' : `<a class="btn ghost" href="#account" data-auth="in">Se connecter</a><a class="btn primary" href="#account" data-auth="up">Créer un compte</a>`;
    return;
  }
  const t = trashed().length, theme = getTheme();
  area.innerHTML = `
    <button class="avatar-btn" id="avatar" aria-haspopup="menu" aria-expanded="${open}" aria-controls="account-menu" aria-label="Mon compte, ${esc(SYNC[state.sync] || '')}">
      ${avatarHTML(user)}
      <span class="status-dot" data-state="${state.sync}"></span>
      ${icon('chevdown', 'chev-down')}
    </button>
    <div class="menu" id="account-menu" role="menu" ${open ? '' : 'hidden'}>
      <div class="menu-head">
        ${avatarHTML(user, 'lg')}
        <div><strong class="menu-mail">${esc(displayName(user) || user.email)}</strong>${displayName(user) ? `<span class="menu-email">${esc(user.email)}</span>` : ''}
        <span class="menu-sync" data-state="${state.sync}">${esc(state.sync === 'error' ? state.syncMsg || SYNC.error : SYNC[state.sync])}</span></div>
      </div>
      <a role="menuitem" href="#account">${icon('user')}Mon profil</a>
      <a role="menuitem" href="#stats">${icon('chart')}Statistiques</a>
      <a role="menuitem" href="#trash">${icon('trash')}Corbeille${t ? ` <span class="pill">${t}</span>` : ''}</a>
      <a role="menuitem" href="#settings">${icon('settings')}Paramètres</a>
      ${state.isAdmin ? `<a role="menuitem" href="#admin">${icon('shield')}Espace admin</a>` : ''}
      <div class="menu-sep"></div>
      <div class="menu-theme" role="group" aria-label="Thème">${THEMES.map(([k, l]) => `<button type="button" data-theme-set="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>
      <button role="menuitem" type="button" data-keys>${icon('keyboard')}Raccourcis clavier <kbd>?</kbd></button>
      <div class="menu-sep"></div>
      <button role="menuitem" type="button" data-signout>${icon('logout')}Se déconnecter</button>
    </div>`;
}

function setOpen(v) {
  open = v;
  const btn = document.getElementById('avatar'), menu = document.getElementById('account-menu');
  if (!btn || !menu) return;
  btn.setAttribute('aria-expanded', v);
  menu.hidden = !v;
  if (v) menu.querySelector('[role=menuitem]')?.focus();
}

area.addEventListener('click', async e => {
  if (e.target.closest('#avatar')) return setOpen(!open);
  const auth = e.target.closest('[data-auth]');
  if (auth) { state.authMode = auth.dataset.auth; if (location.hash === '#account') route(); return; }
  const th = e.target.closest('[data-theme-set]');
  if (th) { setTheme(th.dataset.themeSet); render(); setOpen(true); return; }
  if (e.target.closest('[data-keys]')) { setOpen(false); return openKeys(); }
  if (e.target.closest('[data-signout]')) {
    setOpen(false);
    flushPushes();
    await state.sb.auth.signOut();
    toast('Déconnecté. Tes sets restent sur cet appareil.');
    return;
  }
  if (e.target.closest('.menu a')) setOpen(false);
});
document.addEventListener('click', e => { if (open && !e.target.closest('#account-area')) setOpen(false); });
document.addEventListener('keydown', e => {
  if (open && e.key === 'Escape') { setOpen(false); document.getElementById('avatar')?.focus(); return; }
  if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = [...document.querySelectorAll('#account-menu [role=menuitem]')];
    const i = items.indexOf(document.activeElement);
    items.at((i + (e.key === 'ArrowDown' ? 1 : -1)) % items.length)?.focus();
    e.preventDefault();
    return;
  }
  if (e.key === '?' && !e.target.closest('input, textarea, select') && !document.querySelector('dialog[open]')) openKeys();
});
addEventListener('hashchange', () => setOpen(false));

// ---------- keyboard shortcuts
const KEYS = [
  ['Partout', [['?', 'Afficher cette aide'], ['Échap', 'Fermer un menu ou une fenêtre']]],
  ['Cartes', [['Espace', 'Retourner la carte'], ['← →', 'Carte précédente ou suivante'], ['S', 'Ajouter ou retirer des favoris']]],
  ['Apprendre', [['1 à 4', 'Choisir une réponse'], ['Entrée', 'Valider ou continuer']]],
  ['Révision espacée', [['Espace', 'Afficher la réponse'], ['1 à 4', 'À revoir, Difficile, Bien, Facile']]],
];
function openKeys() {
  let dlg = document.getElementById('keys');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'keys';
    dlg.className = 'dialog';
    dlg.setAttribute('aria-labelledby', 'keys-title');
    dlg.innerHTML = `<div class="dialog-head"><h2 id="keys-title">Raccourcis clavier</h2><button class="icon-btn" type="button" aria-label="Fermer" data-close>${icon('close')}</button></div>
      ${KEYS.map(([group, rows]) => `<h3>${group}</h3><dl class="keys">${rows.map(([k, l]) => `<dt><kbd>${k}</kbd></dt><dd>${l}</dd>`).join('')}</dl>`).join('')}`;
    dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
    document.body.append(dlg);
  }
  dlg.showModal();
}

hooks.header = render;
render();
