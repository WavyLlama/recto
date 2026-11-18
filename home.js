import { streak, dayKey, uid } from './logic.js?v=9';
import { state, views, mount, app, esc, plural, icon, live, playable, dueIn, newIn, mastery, tint, meter, touch, displayName } from './core.js?v=9';

let folder = null; // selected folder chip; '' = sets without a folder

views.home = function homeView() {
  const ds = live(), now = Date.now();
  const due = ds.reduce((n, d) => n + dueIn(d, now), 0);
  const fresh = ds.reduce((n, d) => n + newIn(d), 0);
  const mastered = ds.reduce((n, d) => n + mastery(d).mastered, 0);
  const total = ds.reduce((n, d) => n + playable(d).length, 0);
  const all = ds.flatMap(d => playable(d));
  const nextCard = all.find(c => c.srs && c.srs.due <= now) || all.find(c => !c.srs);
  const { current, best } = streak(state.profile.days, now);
  const doneToday = state.profile.days[dayKey(now)]?.n || 0, goal = state.profile.goal;
  const goalPct = Math.min(100, Math.round((doneToday / goal) * 100));
  const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const title = due ? `${plural(due, 'carte')} à revoir aujourd’hui` : fresh ? 'De nouvelles cartes t’attendent' : total ? 'Tout est révisé pour aujourd’hui' : 'Bienvenue sur Recto';
  const lead = due || fresh
    ? 'La révision mélange tes cartes à revoir et jusqu’à 20 nouvelles cartes, tous sets confondus.'
    : total ? 'Les prochaines cartes reviendront quand ta mémoire commencera à les oublier.' : 'Crée un set, colle tes cartes d’un coup ou fais-les générer par l’IA, et Recto s’occupe de te les faire réviser au bon moment.';
  const folders = [...new Set(ds.map(d => d.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  if (folder && !folders.includes(folder)) folder = null;
  const shown = ds.filter(d => folder === null || (d.folder || '') === folder);

  mount(`
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">${displayName(state.user) ? `Bonjour ${esc(displayName(state.user))} · ` : ''}${esc(today)}</p>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
        <div class="goal">
          <div class="goal-top"><span class="streak${current ? ' on' : ''}">${icon('flame')}${current ? `Série de ${plural(current, 'jour')}` : 'Pas encore de série'}</span><span>${Math.min(doneToday, goal)} / ${goal} cartes aujourd’hui</span></div>
          <div class="progress" role="progressbar" aria-label="Objectif du jour" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.min(doneToday, goal)}"><span style="width:${goalPct}%"></span></div>
          ${goalPct >= 100 ? '<p class="goal-done">Objectif du jour atteint.</p>' : ''}
        </div>
        <div class="actions">
          ${due + fresh ? `<a class="btn primary lg" href="#review">${icon('review')}Commencer la révision</a>` : ''}
          <button class="btn lg" data-action="new">${icon('plus')}Nouveau set</button>
        </div>
      </div>
      <div class="stack" aria-hidden="true">
        <span class="sheet s3"></span><span class="sheet s2"></span>
        <span class="sheet s1"><span class="sheet-label">${nextCard ? (nextCard.srs ? 'À revoir' : 'Nouvelle') : 'Recto'}</span><span class="sheet-text">${esc(nextCard ? nextCard.term : 'Tes fiches, partout')}</span></span>
      </div>
    </section>
    ${state.sb && !state.user ? `<section class="invite"><div><strong>Retrouve tes sets sur tous tes appareils</strong><p class="muted small">Crée un compte gratuit : tes sets, ta série et tes statistiques se synchronisent entre ton téléphone et ton ordinateur.</p></div><div class="actions"><a class="btn primary" href="#account" data-action="signup">Créer un compte</a></div></section>` : ''}
    <section class="stats" aria-label="Résumé">
      <a class="stat" href="#review"><span class="stat-num">${due}</span><span class="stat-label">à revoir</span></a>
      <div class="stat"><span class="stat-num">${fresh}</span><span class="stat-label">jamais étudiée${fresh > 1 ? 's' : ''}</span></div>
      <div class="stat"><span class="stat-num">${mastered}<small> / ${total}</small></span><span class="stat-label">maîtrisée${mastered > 1 ? 's' : ''}</span></div>
      <a class="stat" href="#stats"><span class="stat-num">${best}</span><span class="stat-label">jours, ta meilleure série</span></a>
    </section>
    <div class="row-head">
      <h2>Mes sets <span class="pill">${ds.length}</span></h2>
      <div class="actions">
        ${ds.length > 3 ? `<label class="search">${icon('search')}<span class="sr">Chercher un set</span><input id="q" type="search" placeholder="Chercher un set" autocomplete="off"></label>` : ''}
        <a class="btn" href="#ai">${icon('sparkle')}Générer avec l’IA</a>
      </div>
    </div>
    ${folders.length ? `<div class="chips" role="group" aria-label="Dossiers">
      <button class="chip" data-action="folder" data-f="*" aria-pressed="${folder === null}">Tous</button>
      ${folders.map(f => `<button class="chip" data-action="folder" data-f="${esc(f)}" aria-pressed="${folder === f}">${icon('folder')}${esc(f)}</button>`).join('')}
      ${ds.some(d => !d.folder) ? `<button class="chip" data-action="folder" data-f="" aria-pressed="${folder === ''}">Sans dossier</button>` : ''}
    </div>` : ''}
    ${ds.length ? `<ul class="decks">${shown.map(d => {
      const n = dueIn(d, now), m = mastery(d);
      return `<li data-title="${esc(d.title.toLowerCase())}"><a class="deck ${tint(d)}" href="#deck/${d.id}">
        <span class="deck-top"><span class="deck-title">${esc(d.title)}</span>${n ? `<span class="badge">${n} à revoir</span>` : ''}</span>
        <span class="deck-meta">${d.folder ? `<span class="deck-folder">${icon('folder')}${esc(d.folder)}</span>` : ''}${plural(d.cards.length, 'carte')} · ${m.pct} % maîtrisé${d.shareId ? ` · ${icon('link')}partagé` : ''}</span>
        ${meter(m)}</a></li>`;
    }).join('')}
      <li><button class="deck deck-new" data-action="new">${icon('plus')}<span>Nouveau set</span></button></li></ul>`
    : '<p class="empty">Aucun set pour l’instant. Crée ton premier set, puis colle toutes tes cartes d’un coup.</p>'}`, {
    wide: true,
    click: {
      new: () => {
        const d = { id: uid(), title: 'Nouveau set', cards: [], updatedAt: 0, tu: 0, ...(folder ? { folder } : {}) };
        state.decks[d.id] = d;
        touch(d, true);
        location.hash = `edit/${d.id}`;
      },
      signup: () => { state.authMode = 'up'; location.hash = 'account'; },
      folder: el => { folder = el.dataset.f === '*' ? null : el.dataset.f; homeView(); },
    },
    input: e => {
      if (e.target.id !== 'q') return;
      const q = e.target.value.trim().toLowerCase();
      app.querySelectorAll('.decks li[data-title]').forEach(li => { li.hidden = !li.dataset.title.includes(q); });
    },
  });
};
