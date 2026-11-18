// Share links, public sets (Explorer) and reports.
import { slug, uid, cleanDeck } from './logic.js?v=10';
import { state, views, mount, app, esc, plural, icon, toast, fr, touch, backHome, fmtDate, renderMath } from './core.js?v=10';
import { snapshot, author } from './sync.js?v=10';

const linkOf = id => `${location.origin}${location.pathname}#s/${id}`;
// "par Tim", with the creator's photo; never the e-mail.
const byline = (name, avatar, prefix = 'par') => `<span class="byline">${avatar && /^https:\/\//.test(avatar) ? `<img class="avatar xs" src="${esc(avatar)}" alt="">` : ''}${prefix} ${esc(name || 'un membre de Recto')}</span>`;

export function shareHTML(d) {
  if (!state.user) {
    return `<div class="panel share-panel"><h2>Partager ce set</h2><p class="muted">Connecte-toi pour créer un lien de partage : le set est alors enregistré en ligne et quelqu’un peut l’ouvrir sans compte.</p><a class="btn primary" href="#account">Se connecter</a></div>`;
  }
  if (!d.shareId) {
    return `<div class="panel share-panel"><h2>Partager ce set</h2><p class="muted">Crée un lien : la personne qui l’ouvre voit les cartes et peut les copier dans ses propres sets. Ta progression et tes favoris restent privés.</p>
      <button class="btn primary" data-action="mkshare">${icon('link')}Créer un lien de partage</button></div>`;
  }
  return `<div class="panel share-panel"><h2>Partager ce set</h2>
    <div class="inline"><label class="sr" for="share-url">Lien de partage</label><input id="share-url" readonly value="${esc(linkOf(d.shareId))}"><button class="btn primary" data-action="copylink">${icon('copy')}Copier</button></div>
    <label class="switch"><input type="checkbox" data-pub ${d.public ? 'checked' : ''}><span><strong>Visible par tous dans Explorer</strong><span class="muted small">Sinon, seules les personnes qui ont le lien peuvent l’ouvrir.</span></span></label>
    <label class="switch"><input type="checkbox" data-author ${d.hideAuthor ? '' : 'checked'}><span><strong>Afficher mon pseudo</strong><span class="muted small">Ton pseudo et ta photo apparaissent avec le set. Décoche pour rester anonyme ; ton e-mail n’est jamais affiché.</span></span></label>
    <p class="muted small">Le lien suit tes modifications automatiquement.</p>
    <div class="actions"><button class="btn ghost" data-action="unshare">Arrêter le partage</button></div></div>`;
}

export function stopShare(d, quiet = false) {
  const id = d.shareId;
  delete d.shareId;
  delete d.public;
  touch(d, true);
  if (state.sb && id) state.sb.from('shared_decks').delete().eq('id', id).then(({ error }) => { if (error && !quiet) toast(fr(error.message)); });
  if (!quiet) toast('Partage arrêté : le lien ne fonctionne plus.');
}

// Checkboxes must not go through the click delegation (it cancels the default toggle).
export function onShareChange(d, el) {
  if (el.matches('[data-author]')) {
    if (el.checked) delete d.hideAuthor; else d.hideAuthor = true;
    touch(d, true);
    toast(el.checked ? 'Ton pseudo apparaîtra avec ce set.' : 'Ce set est maintenant anonyme.');
    return;
  }
  if (!el.matches('[data-pub]')) return;
  if (el.checked) d.public = true; else delete d.public;
  touch(d, true);
  toast(el.checked ? 'Ton set apparaîtra dans Explorer d’ici quelques secondes.' : 'Ton set n’est plus visible dans Explorer.');
}

export function shareActions(d, redraw) {
  return {
    mkshare: async el => {
      el.disabled = true;
      const id = slug();
      const { error } = await state.sb.from('shared_decks').insert({ id, deck_id: d.id, title: d.title, card_count: d.cards.length, public: false, data: snapshot(d), ...author(d) });
      if (error) { el.disabled = false; return toast(fr(error.message)); }
      d.shareId = id;
      touch(d, true);
      redraw();
      toast('Lien de partage créé.');
    },
    copylink: async () => {
      const input = app.querySelector('#share-url');
      try { await navigator.clipboard.writeText(input.value); toast('Lien copié.'); } catch { input.select(); toast('Sélectionné : copie-le avec Cmd + C.'); }
    },
    unshare: () => { stopShare(d); redraw(); },
  };
}

// ---------- a shared set, opened from its link
views.shared = async function sharedView(id) {
  if (!state.sb) return mount(`${backHome}<p class="muted">Chargement du set…</p>`);
  mount(`${backHome}<p class="muted">Chargement du set…</p>`);
  const { data, error } = await state.sb.rpc('get_shared', { slug: id });
  if (location.hash !== `#s/${id}`) return;
  const row = data?.[0];
  if (error || !row) return mount(`${backHome}<section class="panel"><h1>Set introuvable</h1><p class="muted">Ce lien ne fonctionne plus : le partage a été arrêté ou le set a été retiré.</p><a class="btn primary" href="#explore">Explorer les sets publics</a></section>`);
  const cards = Array.isArray(row.data?.cards) ? row.data.cards.filter(c => typeof c?.term === 'string' && typeof c?.def === 'string') : [];
  let reporting = false;
  const draw = () => mount(`${backHome}
    <header class="deck-hero c0">
      <div class="deck-hero-text"><p class="eyebrow">Set partagé · ${plural(cards.length, 'carte')}${row.public ? ' · public' : ''}</p><h1>${esc(row.title)}</h1><p class="muted small">${byline(row.author_name, row.author_avatar, 'Créé par')} · mis à jour le ${fmtDate(row.updated_at)}</p></div>
      <div class="actions">
        ${row.mine ? `<span class="pill">C’est ton set</span>` : `<button class="btn primary" data-action="copy">${icon('copy')}Copier dans mes sets</button>`}
        ${row.public && state.user && !row.mine ? `<button class="btn ghost" data-action="report">${icon('flag')}Signaler</button>` : ''}
      </div>
    </header>
    ${reporting ? `<form class="panel" id="report">
      <h2>Signaler ce set</h2>
      <label for="reason">Motif</label>
      <select id="reason" name="reason"><option>Contenu inapproprié ou choquant</option><option>Atteinte aux droits d’auteur</option><option>Spam ou publicité</option><option>Informations fausses</option><option>Autre</option></select>
      <label for="detail">Précisions (facultatif)</label><textarea id="detail" name="detail" rows="3" maxlength="400"></textarea>
      <div class="actions"><button class="btn primary" type="submit">Envoyer le signalement</button><button class="btn" type="button" data-action="noreport">Annuler</button></div>
    </form>` : ''}
    <ol class="card-list">${cards.map(c => `<li><span class="dot d-new"></span><span class="cl-term">${esc(c.term)}</span><span class="cl-def">${c.img && /^https:\/\//.test(c.img) ? `<img class="thumb" src="${esc(c.img)}" alt="" loading="lazy">` : ''}${esc(c.def)}</span></li>`).join('')}</ol>
    <p class="muted small">Copie le set pour l’étudier avec tous les modes et suivre ta progression.</p>`, {
    wide: true,
    click: {
      copy: () => {
        if (!state.user) {
          state.returnTo = location.hash;
          state.authMode = 'up';
          location.hash = 'account';
          return toast('Crée un compte gratuit pour copier ce set et l’étudier.');
        }
        const d = cleanDeck({ id: uid(), title: row.title, langTerm: row.data.langTerm, langDef: row.data.langDef, updatedAt: 0, tu: 0,
          cards: cards.map(c => ({ id: uid(), term: c.term, def: c.def, u: Date.now(), ...(c.img ? { img: c.img } : {}) })) });
        state.decks[d.id] = d;
        touch(d, true);
        toast('Set copié dans tes sets.');
        location.hash = `deck/${d.id}`;
      },
      report: () => { reporting = true; draw(); },
      noreport: () => { reporting = false; draw(); },
    },
    submit: async () => {
      const f = app.querySelector('#report').elements;
      const reason = `${f.reason.value}${f.detail.value.trim() ? ` : ${f.detail.value.trim()}` : ''}`;
      const { error } = await state.sb.from('reports').insert({ shared_id: id, reason });
      if (error) return toast(fr(error.message));
      reporting = false;
      draw();
      toast('Merci, le signalement a été envoyé à l’administrateur.');
    },
  });
  draw();
};

// ---------- Explorer: public sets
views.explore = function exploreView() {
  let timer = null, q = '';
  mount(`<header class="page-head"><p class="eyebrow">Explorer</p><h1>Sets partagés par la communauté</h1><p class="muted">Trouve un set, ouvre-le et copie-le dans les tiens.</p></header>
    <label class="search big">${icon('search')}<span class="sr">Chercher un set public</span><input id="eq" type="search" placeholder="Chercher : anatomie, verbes irréguliers, droit des contrats…" autocomplete="off"></label>
    <div id="results"><p class="muted">Chargement…</p></div>`, {
    wide: true,
    cleanup: () => clearTimeout(timer),
    input: e => {
      if (e.target.id !== 'eq') return;
      q = e.target.value.trim();
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    },
  });
  load();
  async function load() {
    const out = app.querySelector('#results');
    if (!out) return;
    if (!state.sb) { out.innerHTML = '<p class="muted">Chargement…</p>'; return; }
    let req = state.sb.from('shared_decks').select('id,title,card_count,updated_at,author_name,author_avatar').eq('public', true).eq('hidden', false).order('updated_at', { ascending: false }).limit(48);
    if (q) req = req.ilike('title', `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`);
    const asked = q;
    const { data, error } = await req;
    if (asked !== q || !app.querySelector('#results')) return;
    if (error) { out.innerHTML = `<p class="form-error">${esc(fr(error.message))}</p>`; return; }
    out.innerHTML = data.length
      ? `<ul class="decks">${data.map(r => `<li><a class="deck c${r.id.charCodeAt(0) % 6}" href="#s/${r.id}"><span class="deck-top"><span class="deck-title">${esc(r.title)}</span></span><span class="deck-meta">${byline(r.author_name, r.author_avatar)} · ${plural(r.card_count, 'carte')}</span></a></li>`).join('')}</ul>`
      : `<p class="empty">${q ? `Aucun set public ne correspond à « ${esc(q)} ».` : 'Aucun set public pour l’instant. Partage un des tiens et coche « Visible par tous dans Explorer ».'}</p>`;
    renderMath(out);
  }
};
