// My account, sign-in forms, settings and statistics.
import { streak, dayKey, cleanDeck, DAY } from './logic.js?v=15';
import {
  state, views, mount, app, esc, plural, icon, toast, fr, fmtDate, live, playable, tint, backHome, save, saveProfile, hooks,
  download, getTheme, setTheme, SUPABASE_URL, MASTERED_DAYS, avatarHTML, displayName, avatarURL, removeUserFiles,
} from './core.js?v=15';
import { flushPushes, pullAll, refreshShares } from './sync.js?v=15';

const GOOGLE_LOGO = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const SYNC = { off: 'Enregistré sur cet appareil', loading: 'Connexion…', signedout: 'Non connecté', syncing: 'Synchronisation…', idle: 'Synchronisé', error: 'Erreur de synchronisation' };
const side = `<div class="auth-side" aria-hidden="true"><span class="sheet a3"></span><span class="sheet a2"></span><span class="sheet a1"><span class="sheet-label">Recto</span><span class="sheet-text">Tes fiches, sur tous tes appareils</span></span></div>`;

// ---------- account
views.account = function accountView() {
  const { sb, user } = state;
  if (!SUPABASE_URL) return mount(`${backHome}<section class="panel"><h1>Mon compte</h1><p>Les comptes ne sont pas activés sur ce site.</p></section>`);
  if (!sb) return mount(`${backHome}<section class="panel"><h1>Mon compte</h1><p>${esc(state.syncMsg || 'Connexion au service…')}</p></section>`);
  if (user && state.authMode !== 'recover') return profileView();

  const mode = state.authMode, closed = !state.settings.signups_open;
  const tabs = mode === 'in' || mode === 'up' ? `<div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${mode === 'in'}" data-action="mode" data-mode="in">Se connecter</button>
      <button type="button" role="tab" aria-selected="${mode === 'up'}" data-action="mode" data-mode="up">Créer un compte</button>
    </div>` : '';
  // Shown only once Google sign-in is switched on in Supabase.
  const google = state.google && (mode === 'in' || (mode === 'up' && !closed)) ? `<button class="btn google-btn lg" type="button" data-action="google">${GOOGLE_LOGO}Continuer avec Google</button><p class="or"><span>ou avec ton e-mail</span></p>` : '';
  const forms = {
    in: `<h1>Bon retour</h1><p class="muted">Connecte-toi avec ton compte Recto. Première visite ? Choisis « Créer un compte » juste au-dessus.</p>${google}
      <label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="link-btn" type="button" data-action="mode" data-mode="forgot">Mot de passe oublié ?</button>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn primary lg" type="submit">Se connecter</button>`,
    up: closed ? '<h1>Inscriptions fermées</h1><p class="muted">Les nouvelles inscriptions sont fermées pour le moment. Si tu as déjà un compte, connecte-toi.</p>'
      : `<h1>Créer ton compte</h1><p class="muted">Gratuit. Tes sets se synchronisent automatiquement sur tous tes appareils, et ceux déjà créés ici sont gardés.</p>${google}
      <label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
      <label for="password2">Confirme le mot de passe</label><input id="password2" name="password2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="muted small">Au moins 8 caractères.</p>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn primary lg" type="submit">Créer mon compte</button>`,
    forgot: `<h1>Mot de passe oublié</h1><p class="muted">Indique ton e-mail : tu recevras un lien pour choisir un nouveau mot de passe. Si rien n’arrive, demande à l’administrateur du site de te le réinitialiser.</p>
      <label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>
      <p class="form-error" id="err" role="alert"></p>
      <div class="actions"><button class="btn primary lg" type="submit">Envoyer le lien</button><button class="btn ghost" type="button" data-action="mode" data-mode="in">Retour</button></div>`,
    recover: `<h1>Nouveau mot de passe</h1><p class="muted">Choisis ton nouveau mot de passe.</p>
      <label for="password">Nouveau mot de passe</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
      <label for="password2">Confirme le mot de passe</label><input id="password2" name="password2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn primary lg" type="submit">Enregistrer</button>`,
  };
  mount(`${backHome}<div class="auth-wrap">${side}<form class="panel" id="login" novalidate>${tabs}${forms[mode]}</form></div>`, {
    wide: true,
    submit: auth,
    click: {
      google: async el => {
        el.disabled = true;
        const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
        if (error) { el.disabled = false; toast(fr(error.message)); }
      },
      mode: el => { state.authMode = el.dataset.mode; accountView(); app.querySelector('#email, #password')?.focus(); } },
  });
};

async function auth() {
  const { sb } = state, mode = state.authMode;
  const form = app.querySelector('#login'), err = form.querySelector('#err');
  if (!err || !form.reportValidity()) return;
  const f = form.elements, email = f.email?.value.trim(), password = f.password?.value;
  if (f.password2 && f.password2.value !== password) { err.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
  err.textContent = '';
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  let res;
  if (mode === 'in') res = await sb.auth.signInWithPassword({ email, password });
  else if (mode === 'up') res = await sb.auth.signUp({ email, password });
  else if (mode === 'forgot') res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  else res = await sb.auth.updateUser({ password });
  button.disabled = false;
  if (res.error && mode === 'in' && /invalid login credentials/i.test(res.error.message)) {
    err.innerHTML = 'E-mail ou mot de passe incorrect. Pas encore de compte Recto ? Ton compte GitHub ou Google ne marche pas ici : <button class="link-btn" type="button" data-action="mode" data-mode="up">crée ton compte Recto</button>.';
    return;
  }
  if (res.error) { err.textContent = fr(res.error.message); return; }
  if (mode === 'up' && !res.data.session) { err.textContent = 'Compte créé. Clique sur le lien reçu par e-mail pour l’activer, puis connecte-toi.'; return; }
  if (mode === 'forgot') { err.textContent = 'Si un compte existe avec cet e-mail, le lien vient de partir. Pense à vérifier les indésirables.'; return; }
  if (mode === 'up') toast('Bienvenue ! Ton compte est créé et tes sets sont synchronisés.');
  if (mode === 'recover') toast('Mot de passe modifié.');
  state.authMode = 'in';
  views.account();
}

// Square, centred crop for the account photo.
async function squareImage(file, size = 256) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}
function removeStored(url) {
  const path = url && String(url).split('/object/public/images/')[1];
  if (path) state.sb.storage.from('images').remove([decodeURIComponent(path)]);
}

function profileView() {
  let ask = false, busy = false;
  const draw = () => {
    const user = state.user;
    if (!user) return views.account();
    const local = live().length, name = displayName(user);
    mount(`${backHome}
      <header class="page-head">
        <div><p class="eyebrow">Mon profil</p><h1>${esc(name || user.email)}</h1><p class="muted">${name ? `${esc(user.email)} · ` : ''}Inscrit le ${fmtDate(user.created_at)}${state.isAdmin ? ' · <span class="badge-inline">Administrateur</span>' : ''}</p></div>
      </header>
      <section class="panel profile-panel">
        <h2>Profil</h2>
        <div class="profile-row">
          ${avatarHTML(user, 'xl')}
          <div class="actions">
            <label class="btn" for="avatar-file">${icon('image')}${avatarURL(user) ? 'Changer la photo' : 'Ajouter une photo'}</label>
            <input type="file" id="avatar-file" accept="image/*" hidden>
            ${avatarURL(user) ? '<button class="btn ghost" type="button" data-action="noavatar">Retirer la photo</button>' : ''}
          </div>
        </div>
        <form id="name-form" class="inline" novalidate>
          <label class="sr" for="name">Pseudo ou prénom</label>
          <input id="name" name="name" maxlength="40" placeholder="Pseudo ou prénom" value="${esc(name)}" autocomplete="nickname">
          <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>Enregistrer</button>
        </form>
        <p class="muted small">Ton pseudo et ta photo apparaissent en haut du site et dans l’espace admin, à la place de ton e-mail.</p>
      </section>
      <div class="grid-2">
        <section class="panel">
          <h2>Synchronisation</h2>
          <div class="sync-box"><span class="sync-dot" data-state="${state.sync}"></span><div><strong>${esc(state.sync === 'error' ? state.syncMsg : SYNC[state.sync])}</strong>
            <p class="muted small">${plural(local, 'set')} sur cet appareil, avec ta série et tes statistiques.</p></div></div>
          <div class="actions"><button class="btn" data-action="sync">${icon('review')}Synchroniser maintenant</button></div>
        </section>
        <form class="panel" id="pw" novalidate>
          <h2>Changer de mot de passe</h2>
          <label for="password">Nouveau mot de passe</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
          <label for="password2">Confirme le mot de passe</label><input id="password2" name="password2" type="password" autocomplete="new-password" minlength="8" required>
          <p class="form-error" id="err" role="alert"></p>
          <button class="btn primary" type="submit">Enregistrer</button>
        </form>
      </div>
      <section class="panel danger-panel">
        <h2>Supprimer mon compte</h2>
        ${ask ? `<p>Ton compte, tes sets en ligne et tes liens de partage seront effacés. Les sets restent sur cet appareil jusqu’à ce que tu les supprimes.</p>
          <div class="actions"><button class="btn danger" data-action="del">Supprimer définitivement</button><button class="btn" data-action="keep">Annuler</button></div>`
        : `<p class="muted">Efface ton compte et tout ce qui est enregistré en ligne.</p><div class="actions"><button class="btn ghost" data-action="ask">${icon('trash')}Supprimer mon compte</button></div>`}
      </section>`, {
      wide: true,
      click: {
        sync: pullAll,
        noavatar: async () => {
          const old = avatarURL(state.user);
          const res = await state.sb.auth.updateUser({ data: { photo: '' } });
          if (res.error) return toast(fr(res.error.message));
          state.user = res.data.user;
          removeStored(old);
          hooks.header();
          refreshShares();
          draw();
          toast('Photo retirée.');
        },
        ask: () => { ask = true; draw(); },
        keep: () => { ask = false; draw(); },
        del: async () => {
          await removeUserFiles(state.user.id).catch(() => {}); // images first: they cannot be reached once the account is gone
          const { error } = await state.sb.rpc('delete_my_account');
          if (error) return toast(fr(error.message));
          flushPushes();
          await state.sb.auth.signOut();
          toast('Compte supprimé.');
        },
      },
      change: async e => {
        if (e.target.id !== 'avatar-file' || !e.target.files[0]) return;
        const file = e.target.files[0];
        toast('Envoi de la photo…');
        try {
          const blob = await squareImage(file);
          const path = `${state.user.id}/avatar-${Date.now()}.jpg`;
          const { error } = await state.sb.storage.from('images').upload(path, blob, { contentType: 'image/jpeg' });
          if (error) throw error;
          const old = avatarURL(state.user);
          const url = state.sb.storage.from('images').getPublicUrl(path).data.publicUrl;
          const res = await state.sb.auth.updateUser({ data: { photo: url } });
          if (res.error) throw res.error;
          state.user = res.data.user;
          removeStored(old);
          hooks.header();
          refreshShares();
          draw();
          toast('Photo de profil mise à jour.');
        } catch (err) {
          toast(`Photo non envoyée : ${fr(err.message || 'format non reconnu')}`);
        }
      },
      submit: async e => {
        if (e.target.id === 'name-form') {
          const value = app.querySelector('#name').value.trim().slice(0, 40);
          const res = await state.sb.auth.updateUser({ data: { pseudo: value } });
          if (res.error) return toast(fr(res.error.message));
          state.user = res.data.user;
          hooks.header();
          refreshShares();
          draw();
          toast(value ? `Enchanté, ${value} !` : 'Pseudo retiré.');
          return;
        }
        const form = app.querySelector('#pw'), err = form.querySelector('#err');
        if (!form.reportValidity()) return;
        const f = form.elements;
        if (f.password.value !== f.password2.value) { err.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
        const { error } = await state.sb.auth.updateUser({ password: f.password.value });
        if (error) { err.textContent = fr(error.message); return; }
        form.reset();
        err.textContent = '';
        toast('Mot de passe modifié.');
      },
    });
  };
  draw();
}

// ---------- settings
views.settings = function settingsView() {
  const theme = getTheme(), p = state.profile;
  mount(`${backHome}
    <header class="page-head"><h1>Paramètres</h1><p class="muted">Ces réglages te suivent sur tous tes appareils quand tu es connecté, sauf le thème qui reste propre à cet appareil.</p></header>
    <div class="grid-2">
      <section class="panel">
        <h2>Apparence</h2>
        <div class="seg big" role="group" aria-label="Thème">${[['system', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<button type="button" data-action="theme" data-t="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>
        <p class="muted small">« Système » suit le réglage clair ou sombre de ton appareil.</p>
      </section>
      <form class="panel" id="goal-form">
        <h2>Objectif quotidien</h2>
        <label for="goal">Nombre de cartes à étudier par jour</label>
        <div class="inline"><input id="goal" name="goal" type="number" min="5" max="500" step="5" value="${p.goal}" required><button class="btn primary" type="submit">Enregistrer</button></div>
        <p class="muted small">Chaque réponse compte : révision, Apprendre, Test, Association, Écriture.</p>
      </form>
      <section class="panel">
        <h2>Sauvegarde</h2>
        <p class="muted">Télécharge une copie de tous tes sets, ou restaure une copie précédente.</p>
        <div class="actions"><button class="btn" data-action="export">${icon('download')}Exporter</button><label class="btn" for="restore">${icon('upload')}Restaurer</label><input type="file" id="restore" accept="application/json,.json" hidden></div>
      </section>
      <section class="panel">
        <h2>Raccourcis clavier</h2>
        <p class="muted">Appuie sur <kbd>?</kbd> n’importe où pour afficher la liste.</p>
      </section>
    </div>`, {
    wide: true,
    click: {
      theme: el => { setTheme(el.dataset.t); hooks.header(); settingsView(); },
      export: () => download(`recto-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'recto', version: 2, exportedAt: new Date().toISOString(), decks: Object.values(state.decks) }, null, 2), 'application/json'),
    },
    submit: () => {
      const v = +app.querySelector('#goal').value;
      p.goal = Math.min(500, Math.max(5, Math.round(v) || 20));
      p.goalAt = p.updatedAt = Date.now();
      saveProfile();
      hooks.pushProfile();
      toast(`Objectif enregistré : ${p.goal} cartes par jour.`);
    },
    change: async e => {
      if (e.target.id !== 'restore' || !e.target.files[0]) return;
      try {
        const json = JSON.parse(await e.target.files[0].text());
        const list = (Array.isArray(json?.decks) ? json.decks : []).map(cleanDeck).filter(Boolean);
        if (!list.length) throw new Error('empty');
        let n = 0;
        for (const d of list) {
          const l = state.decks[d.id];
          if (!l || d.updatedAt > l.updatedAt) { state.decks[d.id] = d; n++; hooks.push(d.id); }
        }
        save();
        toast(n ? `${plural(n, 'set')} restauré${n > 1 ? 's' : ''}.` : 'Tes sets sont déjà plus récents que cette copie.');
      } catch {
        toast('Ce fichier n’est pas une sauvegarde Recto valide.');
      }
    },
  });
};

// ---------- statistics
views.stats = function statsView() {
  const now = Date.now(), days = state.profile.days;
  const { current, best } = streak(days, now);
  const totalN = Object.values(days).reduce((n, d) => n + d.n, 0);
  const totalT = Object.values(days).reduce((n, d) => n + d.t, 0);
  const fmtTime = s => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : `${Math.round(s / 60)} min`);
  // 18 weeks of activity, Monday first, today in the last column.
  const WEEKS = 18, today = new Date(now);
  const lastMonday = new Date(today); lastMonday.setHours(12, 0, 0, 0); lastMonday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const start = lastMonday.getTime() - (WEEKS - 1) * 7 * DAY;
  const cells = [];
  for (let w = 0; w < WEEKS; w++) {
    for (let r = 0; r < 7; r++) {
      const t = start + (w * 7 + r) * DAY;
      if (t > now + DAY / 2) { cells.push('<span class="hm-cell future"></span>'); continue; }
      const k = dayKey(t), n = days[k]?.n || 0;
      const lvl = n === 0 ? 0 : n < 10 ? 1 : n < 30 ? 2 : n < 60 ? 3 : 4;
      cells.push(`<span class="hm-cell l${lvl}" title="${new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(t)} : ${plural(n, 'carte')}"></span>`);
    }
  }
  const last7 = Array.from({ length: 7 }, (_, i) => days[dayKey(now - i * DAY)]?.n || 0).reduce((a, b) => a + b, 0);
  const hard = live().flatMap(d => playable(d).filter(c => c.srs && (c.srs.lapses > 0 || c.srs.d >= 7)).map(c => ({ d, c })))
    .sort((a, b) => b.c.srs.lapses - a.c.srs.lapses || b.c.srs.d - a.c.srs.d).slice(0, 10);
  const all = live().flatMap(d => playable(d));
  const mastered = all.filter(c => c.srs && c.srs.interval >= MASTERED_DAYS).length;
  mount(`${backHome}
    <header class="page-head"><h1>Statistiques</h1><p class="muted">Ton activité, ta série et les cartes qui te résistent.</p></header>
    <section class="stats five">
      <div class="stat"><span class="stat-num">${current}</span><span class="stat-label">jours de série</span></div>
      <div class="stat"><span class="stat-num">${best}</span><span class="stat-label">jours, meilleure série</span></div>
      <div class="stat"><span class="stat-num">${last7}</span><span class="stat-label">cartes ces 7 jours</span></div>
      <div class="stat"><span class="stat-num">${totalN}</span><span class="stat-label">cartes étudiées au total</span></div>
      <div class="stat"><span class="stat-num">${fmtTime(totalT)}</span><span class="stat-label">temps d’étude estimé</span></div>
    </section>
    <section class="panel heat-panel">
      <div class="row-head"><h2>Activité des 18 dernières semaines</h2><span class="hm-legend muted small">Moins <span class="hm-cell l0"></span><span class="hm-cell l1"></span><span class="hm-cell l2"></span><span class="hm-cell l3"></span><span class="hm-cell l4"></span> Plus</span></div>
      <div class="heat-wrap"><div class="heatmap" style="--weeks:${WEEKS}" role="img" aria-label="Activité par jour sur 18 semaines">${cells.join('')}</div></div>
    </section>
    <div class="grid-2">
      <section class="panel">
        <h2>Progression</h2>
        <p><strong>${mastered}</strong> carte${mastered > 1 ? 's' : ''} maîtrisée${mastered > 1 ? 's' : ''} sur ${all.length}.</p>
        <ul class="deck-bars">${live().map(d => {
          const ps = playable(d), m = ps.filter(c => c.srs && c.srs.interval >= MASTERED_DAYS).length, pct = ps.length ? Math.round((m / ps.length) * 100) : 0;
          return `<li class="${tint(d)}"><a href="#deck/${d.id}">${esc(d.title)}</a><span class="bar"><span style="width:${pct}%"></span></span><span class="muted small">${pct} %</span></li>`;
        }).join('')}</ul>
      </section>
      <section class="panel">
        <h2>Les cartes qui te résistent</h2>
        ${hard.length ? `<ol class="hard-list">${hard.map(({ d, c }) => `<li><div><strong>${esc(c.term)}</strong><span class="muted small">${esc(d.title)}</span></div><span class="pill">${plural(c.srs.lapses, 'oubli')}</span></li>`).join('')}</ol>
          <p class="muted small">Astuce : mets-les en favori, puis révise uniquement les favoris.</p>` : '<p class="muted">Aucune pour l’instant. Elles apparaîtront ici après quelques révisions.</p>'}
      </section>
    </div>`, { wide: true });
};
