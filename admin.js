// Admin area. Every check is repeated server-side in supabase.sql.
import { state, views, mount, app, esc, plural, icon, toast, fr, fmtDate, backHome } from './core.js?v=14';
import { loadSettings } from './sync.js?v=14';

let tab = 'overview';

views.admin = function adminView() {
  const { sb, user } = state;
  if (!sb || !user || !state.isAdmin) {
    return mount(`${backHome}<section class="panel"><h1>Espace admin</h1><p class="muted">${user ? 'Cette page est réservée aux administrateurs.' : 'Connecte-toi avec un compte administrateur pour accéder à cette page.'}</p>${user ? '' : '<a class="btn primary" href="#account">Se connecter</a>'}</section>`);
  }
  let users = [], reports = [], errors = [], ask = null, pwFor = null, loaded = false;

  mount(`${backHome}
    <header class="page-head"><p class="eyebrow">Administration</p><h1>Espace admin</h1><p class="muted">Gère les comptes, les réglages du site et les sets publics signalés. Tu vois le nombre de sets de chacun, jamais leur contenu privé.</p></header>
    <div class="tabs admin-tabs" role="tablist">
      ${[['overview', 'Vue d’ensemble'], ['users', 'Comptes'], ['mod', 'Modération'], ['errors', 'Erreurs']].map(([k, l]) => `<button type="button" role="tab" data-action="tab" data-t="${k}" aria-selected="${tab === k}">${l}<span class="tab-count" data-count="${k}"></span></button>`).join('')}
    </div>
    <div id="admin-body" class="admin"><p class="muted">Chargement…</p></div>`, {
    wide: true,
    click: {
      tab: el => { tab = el.dataset.t; app.querySelectorAll('.admin-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.t === tab)); draw(); },
      reload: load,
      promote: el => rpc('admin_set_admin', { target: el.dataset.id, make: true }, 'Droits d’admin ajoutés.'),
      demote: el => rpc('admin_set_admin', { target: el.dataset.id, make: false }, 'Droits d’admin retirés.'),
      del: el => { ask = el.dataset.id; pwFor = null; draw(); },
      pw: el => { pwFor = el.dataset.id; ask = null; draw(); app.querySelector('#newpw')?.focus(); },
      cancel: () => { ask = null; pwFor = null; draw(); },
      confirm: el => rpc('admin_delete_user', { target: el.dataset.id }, 'Compte supprimé.'),
      setpw: el => {
        const pw = app.querySelector('#newpw').value;
        if (pw.length < 8) return toast('Le mot de passe doit faire au moins 8 caractères.');
        rpc('admin_set_password', { target: el.dataset.id, password: pw }, 'Mot de passe changé. Communique-le à la personne, elle pourra le modifier dans « Mon compte ».');
      },
      hide: el => rpc('admin_moderate', { slug: el.dataset.id, action: 'hide' }, 'Set masqué : il n’est plus visible.'),
      unhide: el => rpc('admin_moderate', { slug: el.dataset.id, action: 'unhide' }, 'Set de nouveau visible.'),
      rmshare: el => rpc('admin_moderate', { slug: el.dataset.id, action: 'delete' }, 'Partage supprimé.'),
      resolve: el => rpc('admin_resolve_report', { report_id: +el.dataset.id }, 'Signalement classé.'),
      clearerr: () => rpc('admin_clear_errors', {}, 'Journal vidé.'),
    },
    submit: async () => {
      const f = app.querySelector('#settings-form').elements;
      const next = { signups_open: f.open.checked, announcement: f.announce.value.trim(), ai_daily_limit: Math.max(0, Math.min(1000, +f.ailimit.value || 0)) };
      const { error } = await sb.from('settings').update(next).eq('id', 1);
      if (error) return toast(fr(error.message));
      await loadSettings();
      toast('Réglages enregistrés.');
    },
  });

  async function rpc(name, args, ok) {
    const { error } = await sb.rpc(name, args);
    ask = null;
    pwFor = null;
    if (error) toast(fr(error.message)); else toast(ok);
    load();
  }

  async function load() {
    const [u, r, e] = await Promise.all([sb.rpc('admin_users'), sb.rpc('admin_reports'), sb.rpc('admin_errors')]);
    errors = e.data || [];
    const body = app.querySelector('#admin-body');
    if (!body) return;
    if (u.error) { body.innerHTML = `<p class="form-error">${esc(fr(u.error.message))}</p>`; return; }
    users = u.data;
    reports = r.data || [];
    loaded = true;
    draw();
  }

  function draw() {
    const body = app.querySelector('#admin-body');
    if (!body || !loaded) return;
    const c = app.querySelector('[data-count="mod"]');
    if (c) c.textContent = reports.length ? ` ${reports.length}` : '';
    const ce = app.querySelector('[data-count="errors"]');
    if (ce) ce.textContent = errors.length ? ` ${errors.length}` : '';
    const week = Date.now() - 7 * 864e5;
    const sum = k => users.reduce((n, x) => n + Number(x[k] || 0), 0);
    if (tab === 'overview') {
      const s = state.settings;
      body.innerHTML = `
        <section class="stats five" aria-label="Chiffres du site">
          <div class="stat"><span class="stat-num">${users.length}</span><span class="stat-label">comptes</span></div>
          <div class="stat"><span class="stat-num">${users.filter(x => Date.parse(x.created_at) > week).length}</span><span class="stat-label">inscrits cette semaine</span></div>
          <div class="stat"><span class="stat-num">${users.filter(x => x.last_sign_in_at && Date.parse(x.last_sign_in_at) > week).length}</span><span class="stat-label">connectés cette semaine</span></div>
          <div class="stat"><span class="stat-num">${sum('decks')}</span><span class="stat-label">sets · ${sum('cards')} cartes</span></div>
          <div class="stat"><span class="stat-num">${sum('ai_today')}</span><span class="stat-label">requêtes IA aujourd’hui</span></div>
        </section>
        <form class="panel admin-settings" id="settings-form">
          <h2>Réglages du site</h2>
          <label class="switch"><input type="checkbox" name="open" ${s.signups_open ? 'checked' : ''}><span><strong>Inscriptions ouvertes</strong><span class="muted small">Décoche pour empêcher la création de nouveaux comptes. Les comptes existants continuent de marcher.</span></span></label>
          <label for="announce">Annonce affichée en haut du site</label>
          <textarea id="announce" name="announce" rows="2" maxlength="280" placeholder="Ex. : Maintenance dimanche à 20 h. Laisse vide pour ne rien afficher.">${esc(s.announcement)}</textarea>
          <label for="ailimit">Requêtes IA par compte et par jour</label>
          <div class="inline"><input id="ailimit" name="ailimit" type="number" min="0" max="1000" value="${s.ai_daily_limit ?? 30}"><span class="muted small">0 désactive l’IA pour tout le monde.</span></div>
          <div class="actions"><button class="btn primary" type="submit">Enregistrer</button></div>
        </form>`;
    } else if (tab === 'users') {
      body.innerHTML = `
        <div class="row-head"><h2>Comptes <span class="pill">${users.length}</span></h2><button class="btn" data-action="reload">${icon('review')}Actualiser</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Compte</th><th>Inscription</th><th>Dernière connexion</th><th class="num">Sets</th><th class="num">Cartes</th><th class="num">IA auj.</th><th><span class="sr">Actions</span></th></tr></thead>
          <tbody>${users.map(x => {
            const me = x.id === user.id;
            let actions;
            if (ask === x.id) actions = `<span class="confirm">Supprimer ce compte et ses sets ?</span><button class="btn danger" data-action="confirm" data-id="${x.id}">Supprimer</button><button class="btn" data-action="cancel">Annuler</button>`;
            else if (pwFor === x.id) actions = `<label class="sr" for="newpw">Nouveau mot de passe</label><input id="newpw" type="text" minlength="8" placeholder="Nouveau mot de passe" autocomplete="off"><button class="btn primary" data-action="setpw" data-id="${x.id}">Changer</button><button class="btn" data-action="cancel">Annuler</button>`;
            else if (me) actions = '<span class="muted small">C’est toi</span>';
            else actions = `${x.is_admin ? `<button class="btn" data-action="demote" data-id="${x.id}">Retirer admin</button>` : `<button class="btn" data-action="promote" data-id="${x.id}">Rendre admin</button>`}
              <button class="btn" data-action="pw" data-id="${x.id}">Mot de passe</button>
              <button class="btn ghost" data-action="del" data-id="${x.id}" aria-label="Supprimer ${esc(x.email)}">${icon('trash')}</button>`;
            return `<tr><td><span class="u-name">${x.avatar_url ? `<img class="avatar sm" src="${esc(x.avatar_url)}" alt="">` : ''}<span><span class="u-mail">${esc(x.name || x.email)}</span>${x.is_admin ? ' <span class="badge-inline">Admin</span>' : ''}${x.name ? `<span class="muted small u-sub">${esc(x.email)}</span>` : ''}</span></span></td>
              <td>${fmtDate(x.created_at)}</td><td>${fmtDate(x.last_sign_in_at)}</td>
              <td class="num">${x.decks}</td><td class="num">${x.cards}</td><td class="num">${x.ai_today}</td><td><div class="row-actions">${actions}</div></td></tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="muted small">« Mot de passe » remplace celui d’un compte, par exemple quand quelqu’un l’a oublié : communique-lui le nouveau, il pourra le changer ensuite.</p>`;
    } else if (tab === 'errors') {
      body.innerHTML = `
        <div class="row-head"><h2>Erreurs des 30 derniers jours <span class="pill">${errors.length}</span></h2>
          <div class="actions"><button class="btn" data-action="reload">${icon('review')}Actualiser</button>${errors.length ? '<button class="btn ghost" data-action="clearerr">Vider le journal</button>' : ''}</div></div>
        ${errors.length ? `<ul class="error-list">${errors.map(x => `<li class="panel">
          <div class="report-head"><strong>${esc(x.message)}</strong></div>
          <p class="muted small">${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(x.created_at))} · ${esc(x.name || x.email || 'compte supprimé')} · page ${esc(x.page || '#')}</p>
          ${x.detail ? `<details><summary class="muted small">Détails techniques</summary><pre class="err-detail">${esc(x.detail)}</pre><p class="muted small">${esc(x.agent || '')}</p></details>` : ''}
        </li>`).join('')}</ul>` : '<p class="empty">Aucune erreur enregistrée. Tout va bien.</p>'}
        <p class="muted small">Les erreurs rencontrées par les personnes connectées arrivent ici automatiquement : plantages du site, synchronisation impossible, IA indisponible.</p>`;
    } else {
      body.innerHTML = `
        <div class="row-head"><h2>Signalements en attente <span class="pill">${reports.length}</span></h2><button class="btn" data-action="reload">${icon('review')}Actualiser</button></div>
        ${reports.length ? `<ul class="report-list">${reports.map(r => `<li class="panel">
          <div class="report-head"><a href="#s/${r.shared_id}"><strong>${esc(r.title)}</strong></a><span class="muted small">par ${esc(r.author_name || 'un membre anonyme')}</span>${r.hidden ? '<span class="badge-inline warn">Masqué</span>' : r.public ? '<span class="badge-inline">Public</span>' : ''}</div>
          <p>${esc(r.reason)}</p>
          <p class="muted small">Signalé le ${fmtDate(r.created_at)} par ${esc(r.reporter_email || 'un compte supprimé')}</p>
          <div class="actions">
            ${r.hidden ? `<button class="btn" data-action="unhide" data-id="${r.shared_id}">Réafficher</button>` : `<button class="btn primary" data-action="hide" data-id="${r.shared_id}">Masquer le set</button>`}
            <button class="btn ghost" data-action="rmshare" data-id="${r.shared_id}">Supprimer le partage</button>
            <button class="btn ghost" data-action="resolve" data-id="${r.id}">Classer sans suite</button>
          </div></li>`).join('')}</ul>` : '<p class="empty">Aucun signalement en attente.</p>'}
        <p class="muted small">Masquer retire le set d’Explorer et coupe son lien. Supprimer le partage efface la copie publique ; le set reste dans le compte de son auteur.</p>`;
    }
  }
  load();
};
