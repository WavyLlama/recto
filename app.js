import { uid, shuffle, parseImport, sameAnswer, review, buildQcm, merge, cleanDeck } from './logic.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { icon } from './icons.js';

const KEY = 'recto.decks.v1';
const app = document.getElementById('app');
const syncLink = document.getElementById('sync');
const toastEl = document.getElementById('toast');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: data lives for this visit only */ } },
};

// ---------- data
let decks = {};
const save = () => store.set(KEY, JSON.stringify(decks));
try {
  for (const d of Object.values(JSON.parse(store.get(KEY)) || {})) {
    const c = cleanDeck(d);
    if (c) decks[c.id] = c;
  }
} catch { /* corrupt storage: start empty */ }
if (!store.get(KEY + '.seeded')) {
  if (!Object.keys(decks).length) seed();
  store.set(KEY + '.seeded', '1');
}

function seed() {
  const pairs = [['France', 'Paris'], ['Italie', 'Rome'], ['Espagne', 'Madrid'], ['Portugal', 'Lisbonne'],
    ['Allemagne', 'Berlin'], ['Pologne', 'Varsovie'], ['Grèce', 'Athènes'], ['Suède', 'Stockholm']];
  const d = { id: uid(), title: 'Exemple · Capitales d’Europe', cards: pairs.map(([term, def]) => ({ id: uid(), term, def })), updatedAt: 0 };
  decks[d.id] = d;
  save();
}

function touch(d) { d.updatedAt = Date.now(); save(); schedulePush(d.id); }
const live = () => Object.values(decks).filter(d => !d.deleted).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
const playable = d => d.cards.filter(c => c.term.trim() && c.def.trim());
const dueIn = (d, now = Date.now()) => playable(d).filter(c => c.srs && c.srs.due <= now).length;
const newIn = d => playable(d).filter(c => !c.srs).length;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

// ---------- view plumbing: each view registers its handlers in `view`
let view = {};
function mount(html, v = {}) {
  view.cleanup?.();
  view = v;
  app.className = v.wide ? 'wide' : '';
  app.innerHTML = html;
}
app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  const fn = el && view.click?.[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});
app.addEventListener('input', e => view.input?.(e));
app.addEventListener('submit', e => { e.preventDefault(); view.submit?.(e); });
document.addEventListener('keydown', e => {
  if (!view.key || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.target.closest?.('button, a') && (e.key === ' ' || e.key === 'Enter')) return; // let the focused control handle it
  view.key(e);
});

const backTo = d => `<a class="back-link" href="#deck/${d.id}">${icon('back')}${esc(d.title)}</a>`;
// Each deck gets one of six colours, stable from its id.
const tint = d => `c${[...d.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 6}`;
function mastery(d) {
  const ps = playable(d);
  const mastered = ps.filter(c => c.srs && c.srs.interval >= 7).length;
  const learning = ps.filter(c => c.srs && c.srs.interval < 7).length;
  const pct = n => (ps.length ? Math.round((n / ps.length) * 100) : 0);
  return { mastered, learning, total: ps.length, pct: pct(mastered), lpct: pct(learning) };
}
const meter = m => `<div class="meter" role="img" aria-label="${m.pct} % maîtrisé"><span class="m-done" style="width:${m.pct}%"></span><span class="m-learn" style="width:${m.lpct}%"></span></div>`;
function setNav() {
  const name = location.hash.slice(1).split('/')[0];
  document.querySelectorAll('.nav a').forEach(a => {
    const on = a.dataset.nav === ({ review: 'review', admin: 'admin', '': 'home' }[name] ?? '');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
const autosize = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };

// ---------- router
const DECK_VIEWS = { deck: deckView, edit: editView, cards: cardsView, learn: learnView, test: testView, match: matchView };
function route() {
  const [name, id] = location.hash.slice(1).split('/');
  const d = id && decks[id] && !decks[id].deleted ? decks[id] : null;
  setNav();
  if (name === 'review') return reviewView(d);
  if (name === 'account') return accountView();
  if (name === 'admin') return adminView();
  if (DECK_VIEWS[name] && d) return DECK_VIEWS[name](d);
  homeView();
}
addEventListener('hashchange', () => { route(); scrollTo(0, 0); });

// ---------- home
function homeView() {
  const ds = live(), now = Date.now();
  const due = ds.reduce((n, d) => n + dueIn(d, now), 0);
  const fresh = ds.reduce((n, d) => n + newIn(d), 0);
  const mastered = ds.reduce((n, d) => n + mastery(d).mastered, 0);
  const total = ds.reduce((n, d) => n + playable(d).length, 0);
  const nextCard = ds.flatMap(d => playable(d)).find(c => c.srs && c.srs.due <= now) || ds.flatMap(d => playable(d)).find(c => !c.srs);
  const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const title = due ? `${plural(due, 'carte')} à revoir aujourd’hui` : fresh ? 'De nouvelles cartes t’attendent' : total ? 'Tout est révisé pour aujourd’hui' : 'Bienvenue sur Recto';
  const lead = due || fresh
    ? `La révision mélange tes cartes à revoir et jusqu’à 20 nouvelles cartes, tous sets confondus.`
    : total ? 'Les prochaines cartes reviendront quand ta mémoire commencera à les oublier.' : 'Crée un set, colle tes cartes d’un coup, et Recto s’occupe de te les faire réviser au bon moment.';
  mount(`
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">${esc(today)}</p>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
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
    ${sb && !user ? `<section class="invite"><div><strong>Retrouve tes sets sur tous tes appareils</strong><p class="muted small">Crée un compte gratuit : tes sets se synchronisent entre ton téléphone et ton ordinateur.</p></div><div class="actions"><a class="btn primary" href="#account" data-action="signup">Créer un compte</a><a class="btn ghost" href="#account" data-action="signin">Se connecter</a></div></section>` : ''}
    <section class="stats" aria-label="Résumé">
      <div class="stat"><span class="stat-num">${due}</span><span class="stat-label">à revoir</span></div>
      <div class="stat"><span class="stat-num">${fresh}</span><span class="stat-label">jamais étudiée${fresh > 1 ? 's' : ''}</span></div>
      <div class="stat"><span class="stat-num">${mastered}<small> / ${total}</small></span><span class="stat-label">maîtrisée${mastered > 1 ? 's' : ''}</span></div>
    </section>
    <div class="row-head">
      <h2>Mes sets <span class="pill">${ds.length}</span></h2>
      ${ds.length > 3 ? `<label class="search">${icon('search')}<span class="sr">Chercher un set</span><input id="q" type="search" placeholder="Chercher un set" autocomplete="off"></label>` : ''}
    </div>
    ${ds.length ? `<ul class="decks">${ds.map(d => {
      const n = dueIn(d, now), m = mastery(d);
      return `<li data-title="${esc(d.title.toLowerCase())}"><a class="deck ${tint(d)}" href="#deck/${d.id}">
        <span class="deck-top"><span class="deck-title">${esc(d.title)}</span>${n ? `<span class="badge">${n} à revoir</span>` : ''}</span>
        <span class="deck-meta">${plural(d.cards.length, 'carte')} · ${m.pct} % maîtrisé${d.bestMatch ? ` · record ${d.bestMatch.toFixed(1)} s` : ''}</span>
        ${meter(m)}</a></li>`;
    }).join('')}
      <li><button class="deck deck-new" data-action="new">${icon('plus')}<span>Nouveau set</span></button></li></ul>`
    : '<p class="empty">Aucun set pour l’instant. Crée ton premier set, puis colle toutes tes cartes d’un coup.</p>'}
    <section class="backup">
      <div><h2>Sauvegarde</h2><p class="muted">Télécharge une copie de tous tes sets, ou restaure une copie précédente.</p></div>
      <div class="actions">
        <button class="btn" data-action="export">${icon('download')}Exporter</button>
        <label class="btn" for="restore">${icon('upload')}Restaurer</label>
        <input type="file" id="restore" accept="application/json,.json" hidden>
      </div>
    </section>`, {
    wide: true,
    click: {
      new: () => {
        const d = { id: uid(), title: 'Nouveau set', cards: [], updatedAt: 0 };
        decks[d.id] = d;
        touch(d);
        location.hash = `edit/${d.id}`;
      },
      export: exportAll,
      signup: () => { authMode = 'up'; location.hash = 'account'; },
      signin: () => { authMode = 'in'; location.hash = 'account'; },
    },
    input: e => {
      if (e.target.id === 'restore') restore(e.target.files[0]);
      if (e.target.id === 'q') {
        const q = e.target.value.trim().toLowerCase();
        app.querySelectorAll('.decks li[data-title]').forEach(li => { li.hidden = !li.dataset.title.includes(q); });
      }
    },
  });
}

function exportAll() {
  const json = JSON.stringify({ app: 'recto', version: 1, exportedAt: new Date().toISOString(), decks: Object.values(decks) }, null, 2);
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
    download: `recto-${new Date().toISOString().slice(0, 10)}.json`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function restore(file) {
  if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const list = (Array.isArray(json?.decks) ? json.decks : []).map(cleanDeck).filter(Boolean);
    if (!list.length) throw new Error('empty');
    let n = 0;
    for (const d of list) {
      const l = decks[d.id];
      if (!l || d.updatedAt > l.updatedAt) { decks[d.id] = d; n++; schedulePush(d.id); }
    }
    save();
    toast(n ? `${plural(n, 'set')} restauré${n > 1 ? 's' : ''}.` : 'Tes sets sont déjà plus récents que cette copie.');
    route();
  } catch {
    toast('Ce fichier n’est pas une sauvegarde Recto valide.');
  }
}

// ---------- one deck
function deckView(d) {
  const cards = playable(d), n = cards.length, due = dueIn(d), fresh = newIn(d);
  const m = mastery(d);
  const mode = (key, name, desc, ok = true) => (ok ? `<a class="mode" href="#${key}/${d.id}"><span class="mode-ic">${icon(key)}</span><span class="mode-text"><strong>${name}</strong><span>${desc}</span></span>${icon('next', 'chev')}</a>` : '');
  const state = c => (!c.srs ? '<span class="dot d-new" title="Jamais étudiée"></span>' : c.srs.interval >= 7 ? '<span class="dot d-done" title="Maîtrisée"></span>' : '<span class="dot d-learn" title="En cours"></span>');
  mount(`
    <a class="back-link" href="#">${icon('back')}Mes sets</a>
    <header class="deck-hero ${tint(d)}">
      <div class="deck-hero-text">
        <p class="eyebrow">${plural(d.cards.length, 'carte')}${d.bestMatch ? ` · record ${d.bestMatch.toFixed(1)} s` : ''}</p>
        <h1>${esc(d.title)}</h1>
        <div class="deck-progress">${meter(m)}<p class="muted small"><strong>${m.mastered}</strong> maîtrisée${m.mastered > 1 ? 's' : ''} · <strong>${m.learning}</strong> en cours · <strong>${fresh}</strong> jamais étudiée${fresh > 1 ? 's' : ''}</p></div>
      </div>
      <div class="actions">
        ${n ? `<a class="btn primary" href="#review/${d.id}">${icon('review')}Réviser${due ? ` (${due})` : ''}</a>` : ''}
        <a class="btn" href="#edit/${d.id}">${icon('edit')}Modifier</a>
      </div>
    </header>
    ${n ? `<nav class="modes" aria-label="Modes d’étude">
      ${mode('cards', 'Cartes', 'Retourner et parcourir, avec lecture à voix haute')}
      ${mode('learn', 'Apprendre', 'QCM puis réponse écrite, jusqu’à la maîtrise', n >= 2)}
      ${mode('test', 'Test', `Examen noté de ${Math.min(n, 20)} questions`, n >= 2)}
      ${mode('match', 'Association', d.bestMatch ? `Ton record : ${d.bestMatch.toFixed(1)} s` : 'Relier les paires contre la montre', n >= 2)}
    </nav>` : `<p class="empty">Ce set est vide. <a href="#edit/${d.id}">Ajoute des cartes</a> pour commencer.</p>`}
    ${d.cards.length ? `<div class="row-head"><h2>Les cartes</h2><p class="legend muted small"><span class="dot d-done"></span>maîtrisée <span class="dot d-learn"></span>en cours <span class="dot d-new"></span>nouvelle</p></div>
    <ol class="card-list">${d.cards.map(c => `<li>${state(c)}<span class="cl-term">${esc(c.term)}</span><span class="cl-def">${esc(c.def)}</span></li>`).join('')}</ol>` : ''}
    <div class="danger-zone" id="dz"><button class="btn ghost" data-action="ask">${icon('trash')}Supprimer ce set</button></div>`, {
    wide: true,
    click: {
      ask: () => {
        document.getElementById('dz').innerHTML = `<p>Supprimer « ${esc(d.title)} » et ses ${plural(d.cards.length, 'carte')} ? Seule une sauvegarde exportée permettra de le récupérer.</p>
          <div class="actions"><button class="btn danger" data-action="del">Supprimer</button><button class="btn" data-action="keep">Annuler</button></div>`;
      },
      keep: () => route(),
      del: () => {
        decks[d.id] = { id: d.id, deleted: true, title: '', cards: [], updatedAt: 0 };
        touch(decks[d.id]);
        location.hash = '';
        toast('Set supprimé.');
      },
    },
  });
}

// ---------- edit
function editView(d) {
  let timer = null;
  const flush = () => { if (timer) { clearTimeout(timer); timer = null; touch(d); } };
  const later = () => { clearTimeout(timer); timer = setTimeout(flush, 600); };
  const row = (c, i) => `<li data-id="${c.id}">
      <span class="num">${i + 1}</span>
      <label class="sr" for="t-${c.id}">Terme ${i + 1}</label>
      <textarea id="t-${c.id}" data-field="term" rows="1" placeholder="Terme">${esc(c.term)}</textarea>
      <label class="sr" for="d-${c.id}">Définition ${i + 1}</label>
      <textarea id="d-${c.id}" data-field="def" rows="1" placeholder="Définition">${esc(c.def)}</textarea>
      <button class="icon-btn" data-action="rm" aria-label="Supprimer la carte ${i + 1}">${icon('trash')}</button></li>`;
  const draw = focusId => {
    mount(`
      <div class="edit-bar">
        <a class="back-link" href="#deck/${d.id}">${icon('back')}Retour au set</a>
        <a class="btn primary" href="#deck/${d.id}">${icon('check')}Terminé</a>
      </div>
      <section class="edit-head">
        <label class="field-label" for="title">Titre du set</label>
        <input id="title" class="title-input" value="${esc(d.title)}" autocomplete="off">
        <p class="muted small">Enregistré automatiquement.</p>
      </section>
      <details class="bulk"${d.cards.length ? '' : ' open'}>
        <summary>${icon('upload')}Importer plusieurs cartes d’un coup</summary>
        <p class="muted">Une carte par ligne : le terme, puis une tabulation, « ; », « - » ou « : », puis la définition. Un copier-coller depuis un tableur marche tel quel.</p>
        <label class="sr" for="bulk">Cartes à importer</label>
        <textarea id="bulk" rows="6" placeholder="Article 1240 ; Responsabilité du fait personnel&#10;Hello - Bonjour"></textarea>
        <button class="btn primary" data-action="bulk">Ajouter ces cartes</button>
      </details>
      <div class="row-head"><h2>${plural(d.cards.length, 'carte')}</h2></div>
      ${d.cards.length ? '<div class="edit-cols" aria-hidden="true"><span></span><span>Terme</span><span>Définition</span><span></span></div>' : ''}
      <ol class="edit-list">${d.cards.map(row).join('')}</ol>
      <button class="add-card" data-action="add">${icon('plus')}Ajouter une carte</button>`, {
      cleanup: flush,
      input: e => {
        const t = e.target;
        if (t.id === 'title') { d.title = t.value.trim() || 'Sans titre'; later(); return; }
        if (!t.dataset.field) return;
        const c = d.cards.find(x => x.id === t.closest('li').dataset.id);
        if (c) { c[t.dataset.field] = t.value; later(); autosize(t); }
      },
      click: {
        add: () => {
          const c = { id: uid(), term: '', def: '' };
          d.cards.push(c);
          touch(d);
          draw(`t-${c.id}`);
        },
        rm: el => {
          d.cards = d.cards.filter(c => c.id !== el.closest('li').dataset.id);
          touch(d);
          draw();
        },
        bulk: () => {
          const { cards, skipped } = parseImport(app.querySelector('#bulk').value);
          if (!cards.length) return toast('Aucune ligne reconnue. Sépare le terme et la définition par « ; » ou une tabulation.');
          d.cards.push(...cards.map(c => ({ id: uid(), ...c })));
          touch(d);
          draw();
          toast(`${plural(cards.length, 'carte')} ajoutée${cards.length > 1 ? 's' : ''}${skipped ? ` · ${skipped} ligne${skipped > 1 ? 's' : ''} ignorée${skipped > 1 ? 's' : ''}` : ''}.`);
        },
      },
    });
    app.querySelectorAll('.edit-list textarea').forEach(autosize);
    if (focusId) app.querySelector('#' + CSS.escape(focusId))?.focus();
  };
  draw();
}

// ---------- flashcards
function cardsView(d) {
  let order = playable(d), i = 0, flipped = false, defFirst = false;
  const canSpeak = 'speechSynthesis' in window;
  const flip = () => {
    flipped = !flipped;
    app.querySelector('.flash').classList.toggle('flipped', flipped);
    app.querySelector('.face.front').setAttribute('aria-hidden', flipped);
    app.querySelector('.face.back').setAttribute('aria-hidden', !flipped);
  };
  const go = k => { if (k >= 0 && k < order.length) { i = k; flipped = false; draw(); } };
  const draw = () => {
    const c = order[i];
    const [front, back] = defFirst ? [c.def, c.term] : [c.term, c.def];
    mount(`${backTo(d)}
      <div class="study-head"><h1 class="mode-title">Cartes</h1><span class="count">${i + 1} / ${order.length}</span></div>
      <button class="flash" data-action="flip">
        <span class="inner">
          <span class="face front"><span class="side-label">${defFirst ? 'Définition' : 'Terme'}</span><span class="face-text">${esc(front)}</span></span>
          <span class="face back" aria-hidden="true"><span class="side-label">${defFirst ? 'Terme' : 'Définition'}</span><span class="face-text">${esc(back)}</span></span>
        </span>
      </button>
      <div class="controls">
        <button class="btn round" data-action="prev" ${i ? '' : 'disabled'} aria-label="Carte précédente">${icon('back')}</button>
        ${canSpeak ? `<button class="btn" data-action="speak">${icon('speak')}Écouter</button>` : ''}
        <button class="btn" data-action="shuffle">${icon('shuffle')}Mélanger</button>
        <button class="btn" data-action="swap">${icon('swap')}${defFirst ? 'Terme d’abord' : 'Définition d’abord'}</button>
        <button class="btn round" data-action="next" ${i < order.length - 1 ? '' : 'disabled'} aria-label="Carte suivante">${icon('next')}</button>
      </div>
      <div class="progress thin" aria-hidden="true"><span style="width:${((i + 1) / order.length) * 100}%"></span></div>
      <p class="hint">Espace pour retourner · flèches pour changer de carte.</p>`, {
      cleanup: () => canSpeak && speechSynthesis.cancel(),
      click: {
        flip,
        prev: () => go(i - 1),
        next: () => go(i + 1),
        shuffle: () => { order = shuffle(order); i = 0; flipped = false; draw(); toast('Cartes mélangées.'); },
        swap: () => { defFirst = !defFirst; flipped = false; draw(); },
        speak: () => {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(flipped ? back : front);
          u.lang = 'fr-FR';
          speechSynthesis.speak(u);
        },
      },
      key: e => {
        if (e.key === ' ') { e.preventDefault(); flip(); }
        else if (e.key === 'ArrowRight') go(i + 1);
        else if (e.key === 'ArrowLeft') go(i - 1);
      },
    });
  };
  draw();
}

// ---------- learn: QCM first, then written answer; two right answers in a row = mastered
function learnView(d) {
  const all = playable(d), total = all.length;
  const queue = shuffle(all).map(c => ({ c, p: 0 }));
  const head = `${backTo(d)}<div class="study-head"><h1 class="mode-title">Apprendre</h1></div>`;
  let mastered = 0, cur = null, pending = null, opts = [];
  const bar = () => `<div class="progress" role="progressbar" aria-label="Cartes maîtrisées" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${mastered}"><span style="width:${(mastered / total) * 100}%"></span></div>
    <p class="muted small">${mastered} / ${total} maîtrisée${mastered > 1 ? 's' : ''}</p>`;

  function next() {
    pending = null;
    cur = queue.shift();
    if (!cur) {
      return mount(`${head}${bar()}<section class="done"><h2>Set maîtrisé</h2><p>Deux bonnes réponses d’affilée sur chacune des ${plural(total, 'carte')}.</p>
        <div class="actions"><a class="btn primary" href="#test/${d.id}">Passer le test</a><button class="btn" data-action="again">Recommencer</button></div></section>`,
      { click: { again: () => learnView(d) } });
    }
    if (cur.p === 0) {
      opts = buildQcm(all, cur.c);
      mount(`${head}${bar()}<section class="question"><p class="q-label">Choisis la définition</p><p class="prompt">${esc(cur.c.term)}</p>
        <div class="options">${opts.map((o, k) => `<button class="option" data-action="pick" data-k="${k}"><kbd>${k + 1}</kbd><span>${esc(o)}</span></button>`).join('')}</div></section>`, {
        click: { pick: el => answer(opts[+el.dataset.k] === cur.c.def, +el.dataset.k), cont: advance },
        key: e => { const k = +e.key - 1; if (!pending && k >= 0 && k < opts.length) answer(opts[k] === cur.c.def, k); },
      });
    } else {
      mount(`${head}${bar()}<form class="question"><p class="q-label">Écris le terme</p><p class="prompt">${esc(cur.c.def)}</p>
        <label class="sr" for="ans">Ta réponse</label>
        <input id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ta réponse">
        <div class="actions" id="ask-actions"><button class="btn primary" type="submit">Valider</button><button class="btn ghost" type="button" data-action="idk">Je ne sais pas</button></div></form>`, {
        submit: () => { const v = app.querySelector('#ans').value; if (!pending && v.trim()) answer(sameAnswer(v, cur.c.term), v); },
        click: { idk: () => answer(false, ''), cont: advance, override: () => { pending.ok = true; advance(); } },
      });
      app.querySelector('#ans').focus();
    }
  }

  function answer(ok, given) {
    if (pending) return;
    pending = { ok };
    const qcm = cur.p === 0;
    if (qcm) {
      app.querySelectorAll('.option').forEach((b, k) => {
        b.disabled = true;
        if (opts[k] === cur.c.def) b.classList.add('right');
        else if (k === given) b.classList.add('wrong');
      });
    } else {
      app.querySelector('#ans').disabled = true;
      app.querySelector('#ask-actions').remove();
    }
    const fb = document.createElement('div');
    fb.className = `feedback ${ok ? 'ok' : 'ko'}`;
    fb.setAttribute('role', 'status');
    fb.innerHTML = `${ok ? '<p><strong>Correct.</strong></p>'
      : `<p><strong>${given === '' ? 'Voici la réponse.' : 'Pas tout à fait.'}</strong> Réponse attendue : <span class="expected">${esc(qcm ? cur.c.def : cur.c.term)}</span></p>`}
      <div class="actions"><button class="btn primary" data-action="cont">Continuer</button>${!ok && !qcm && given !== '' ? '<button class="btn ghost" data-action="override">J’avais raison</button>' : ''}</div>`;
    app.querySelector('.question').append(fb);
    fb.querySelector('[data-action=cont]').focus();
  }

  function advance() {
    if (!pending) return;
    if (pending.ok) {
      cur.p++;
      if (cur.p >= 2) mastered++;
      else queue.splice(Math.min(queue.length, 3), 0, cur);
    } else {
      cur.p = 0;
      queue.splice(Math.min(queue.length, 2), 0, cur);
    }
    next();
  }
  next();
}

// ---------- test
function testView(d) {
  const all = playable(d);
  const head = `${backTo(d)}<div class="study-head"><h1 class="mode-title">Test</h1></div>`;
  const qs = shuffle(all).slice(0, 20).map((c, i) => {
    const type = ['qcm', 'write', 'tf'][i % 3];
    if (type === 'qcm') return { type, c, opts: buildQcm(all, c) };
    if (type === 'tf') {
      const other = shuffle(all.filter(o => o.id !== c.id && o.def !== c.def))[0];
      const truth = !other || Math.random() < 0.5;
      return { type, c, shown: truth ? c.def : other.def, truth };
    }
    return { type, c };
  });
  const body = (q, i) => {
    if (q.type === 'qcm') {
      return `<legend><span class="num">${i + 1}</span>Quelle est la définition ?</legend><p class="prompt sm">${esc(q.c.term)}</p>
        ${q.opts.map((o, k) => `<label class="choice"><input type="radio" name="q${i}" value="${k}"><span>${esc(o)}</span></label>`).join('')}`;
    }
    if (q.type === 'tf') {
      return `<legend><span class="num">${i + 1}</span>Vrai ou faux ?</legend><p class="prompt sm">${esc(q.c.term)} <span class="muted">→</span> ${esc(q.shown)}</p>
        <div class="tf"><label class="choice"><input type="radio" name="q${i}" value="1"><span>Vrai</span></label><label class="choice"><input type="radio" name="q${i}" value="0"><span>Faux</span></label></div>`;
    }
    return `<legend><span class="num">${i + 1}</span>Quel est le terme ?</legend><p class="prompt sm">${esc(q.c.def)}</p>
      <label class="sr" for="w${i}">Ta réponse</label><input id="w${i}" name="q${i}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ta réponse">`;
  };
  let graded = false;
  mount(`${head}<form class="test" novalidate>${qs.map((q, i) => `<fieldset class="tq" id="q${i}">${body(q, i)}</fieldset>`).join('')}
    <div class="actions" id="test-actions"><button class="btn primary" type="submit">Corriger</button></div></form>`, {
    submit: () => {
      if (graded) return;
      graded = true;
      const form = app.querySelector('form.test'), data = new FormData(form);
      let score = 0;
      qs.forEach((q, i) => {
        const v = data.get(`q${i}`);
        const ok = q.type === 'qcm' ? v !== null && q.opts[+v] === q.c.def
          : q.type === 'tf' ? v !== null && (v === '1') === q.truth
            : sameAnswer(v || '', q.c.term);
        score += ok;
        const fs = app.querySelector(`#q${i}`);
        fs.classList.add(ok ? 'ok' : 'ko');
        fs.disabled = true;
        if (!ok) {
          const right = q.type === 'write' ? q.c.term : q.type === 'qcm' ? q.c.def : q.truth ? 'Vrai' : `Faux : ${q.c.term} → ${q.c.def}`;
          fs.insertAdjacentHTML('beforeend', `<p class="expected-line">Réponse : ${esc(right)}</p>`);
        }
      });
      form.insertAdjacentHTML('afterbegin', `<div class="score" role="status"><strong>${score} / ${qs.length}</strong><span>${Math.round((score / qs.length) * 100)} %</span></div>`);
      app.querySelector('#test-actions').innerHTML = `<button class="btn primary" type="button" data-action="again">Nouveau test</button><a class="btn" href="#learn/${d.id}">Retravailler avec Apprendre</a>`;
      scrollTo(0, 0);
    },
    click: { again: () => { testView(d); scrollTo(0, 0); } },
  });
}

// ---------- match
function matchView(d) {
  const picks = shuffle(playable(d)).slice(0, 6);
  const tiles = shuffle(picks.flatMap(c => [{ k: c.id, t: c.term }, { k: c.id, t: c.def }]));
  let sel = null, left = picks.length, penalty = 0, timer = null;
  const t0 = performance.now();
  const clock = () => ((performance.now() - t0 + penalty) / 1000).toFixed(1);
  mount(`${backTo(d)}<div class="study-head"><h1 class="mode-title">Association</h1><span class="count timer" id="timer">0.0 s</span></div>
    ${d.bestMatch ? `<p class="muted small">Record : ${d.bestMatch.toFixed(1)} s</p>` : ''}
    <div class="match-grid">${tiles.map((x, i) => `<button class="tile" data-action="tile" data-i="${i}">${esc(x.t)}</button>`).join('')}</div>
    <p class="hint">Touche un terme puis sa définition. Une erreur ajoute 1 seconde.</p>`, {
    cleanup: () => clearInterval(timer),
    click: {
      again: () => matchView(d),
      tile: el => {
        const i = +el.dataset.i;
        if (sel === null) { sel = i; el.classList.add('sel'); return; }
        const a = app.querySelector(`[data-i="${sel}"]`);
        a.classList.remove('sel');
        if (sel !== i) {
          if (tiles[sel].k === tiles[i].k) {
            for (const b of [a, el]) { b.classList.add('gone'); b.disabled = true; }
            left--;
          } else {
            penalty += 1000;
            for (const b of [a, el]) { b.classList.add('wrong'); setTimeout(() => b.classList.remove('wrong'), 450); }
          }
        }
        sel = null;
        if (!left) finish();
      },
    },
  });
  timer = setInterval(() => { const t = document.getElementById('timer'); if (t) t.textContent = `${clock()} s`; }, 100);
  function finish() {
    clearInterval(timer);
    const time = +clock(), record = !d.bestMatch || time < d.bestMatch;
    if (record) { d.bestMatch = time; touch(d); }
    app.querySelector('.match-grid').outerHTML = `<section class="done"><h2>${time.toFixed(1)} s</h2><p>${record ? 'Nouveau record pour ce set.' : `Record : ${d.bestMatch.toFixed(1)} s.`}</p>
      <div class="actions"><button class="btn primary" data-action="again">Rejouer</button><a class="btn" href="#deck/${d.id}">Retour au set</a></div></section>`;
  }
}

// ---------- spaced repetition (one deck, or every deck when `only` is null)
function reviewView(only) {
  const now = Date.now(), due = [], fresh = [];
  for (const deck of only ? [only] : live()) {
    for (const c of playable(deck)) {
      if (!c.srs) fresh.push({ deck, c });
      else if (c.srs.due <= now) due.push({ deck, c });
    }
  }
  const queue = [...shuffle(due), ...fresh.slice(0, 20)]; // at most 20 new cards per session
  const back = only ? `#deck/${only.id}` : '#';
  const backLabel = only ? esc(only.title) : 'Mes sets';
  const LABELS = ['À revoir', 'Difficile', 'Bien', 'Facile'];
  const when = s => (s.interval ? `${s.interval} j` : '10 min');
  let item = null, revealed = false, done = 0;

  function next() {
    item = queue.shift();
    revealed = false;
    if (!item) {
      return mount(`<a class="back-link" href="${back}">${icon('back')}${backLabel}</a><section class="done"><h2>Révision terminée</h2>
        <p>${done ? `${plural(done, 'carte')} révisée${done > 1 ? 's' : ''}. ` : 'Rien à réviser pour l’instant. '}Les prochaines cartes reviendront au bon moment.</p>
        <a class="btn primary" href="${back}">Retour</a></section>`);
    }
    const t = Date.now();
    mount(`<a class="back-link" href="${back}">${icon('back')}${backLabel}</a>
      <div class="study-head"><h1 class="mode-title">Révision</h1><span class="count">${queue.length + 1} restante${queue.length ? 's' : ''}</span></div>
      ${only ? '' : `<p class="muted small">${esc(item.deck.title)}</p>`}
      <div class="flash static"><span class="face front"><span class="side-label">${item.c.srs ? 'Terme' : 'Nouvelle carte · Terme'}</span><span class="face-text">${esc(item.c.term)}</span></span></div>
      <div id="answer" hidden>
        <p class="answer-text">${esc(item.c.def)}</p>
        <div class="grades">${LABELS.map((l, g) => `<button class="btn grade g${g}" data-action="grade" data-g="${g}"><span><kbd>${g + 1}</kbd> ${l}</span><small>${when(review(item.c.srs, g, t))}</small></button>`).join('')}</div>
      </div>
      <button class="btn primary wide" id="reveal" data-action="reveal">Afficher la réponse</button>`, {
      click: { reveal, grade: el => grade(+el.dataset.g) },
      key: e => {
        if (!revealed && e.key === ' ') { e.preventDefault(); reveal(); }
        else if (revealed && /^[1-4]$/.test(e.key)) grade(+e.key - 1);
      },
    });
  }
  function reveal() {
    revealed = true;
    app.querySelector('#answer').hidden = false;
    app.querySelector('#reveal').hidden = true;
    app.querySelector('.grade.g2').focus();
  }
  function grade(g) {
    item.c.srs = review(item.c.srs, g, Date.now());
    touch(item.deck);
    done++;
    if (g === 0) queue.splice(Math.min(queue.length, 4), 0, item);
    next();
  }
  next();
}

// ---------- sync (Supabase). Without config.js values, the app stays local-only.
let sb = null, user = null, syncState = SUPABASE_URL ? 'loading' : 'off', syncMsg = '';
const pushTimers = {};
const LABELS = { off: 'Sur cet appareil', loading: 'Synchro…', signedout: 'Connexion', syncing: 'Synchronisation…', idle: 'Synchronisé', error: 'Erreur de synchro' };
function setSync(state, msg = '') {
  syncState = state;
  syncMsg = msg;
  syncLink.textContent = LABELS[state];
  syncLink.dataset.state = state;
}

async function initSync() {
  setSync(syncState);
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch {
    setSync('error', 'Le service de synchronisation ne répond pas. Tes sets restent enregistrés sur cet appareil.');
    if (location.hash === '#account') route();
    return;
  }
  sb.auth.onAuthStateChange((event, session) => {
    const before = user?.id;
    user = session?.user || null;
    if (event === 'PASSWORD_RECOVERY') { authMode = 'recover'; location.hash = 'account'; }
    // Supabase advises against awaiting its own calls inside this callback.
    if (user?.id !== before) {
      setTimeout(async () => {
        await refreshAdmin();
        if (user) pullAll();
        const name = location.hash.slice(1).split('/')[0];
        if (['', 'account', 'admin'].includes(name)) route();
      }, 0);
    }
    if (!user) setSync('signedout');
  });
  loadSettings();
  const { data } = await sb.auth.getSession();
  if (!data.session) { setSync('signedout'); route(); }
}

async function pullAll() {
  if (!sb || !user) return;
  setSync('syncing');
  const { data, error } = await sb.from('decks').select('id,data');
  if (error) return setSync('error', error.message);
  const { merged, toPush } = merge(decks, data);
  const changed = Object.keys(merged).some(id => merged[id] !== decks[id]);
  decks = merged;
  save();
  for (const id of toPush) if (!(await push(id))) return;
  setSync('idle');
  // Don't reset a study session in progress.
  const name = location.hash.slice(1).split('/')[0];
  if (changed && ['', 'deck', 'account', 'review'].includes(name) && !(name === 'review' && view.click?.grade)) route();
}

async function push(id) {
  const d = decks[id];
  if (!sb || !user || !d) return false;
  const { error } = await sb.from('decks').upsert({ id, data: d, updated_at: new Date(d.updatedAt || Date.now()).toISOString() });
  if (error) { setSync('error', error.message); return false; }
  return true;
}

function schedulePush(id) {
  if (!sb || !user) return;
  clearTimeout(pushTimers[id]);
  pushTimers[id] = setTimeout(async () => {
    delete pushTimers[id];
    setSync('syncing');
    if (await push(id)) setSync('idle');
  }, 1500);
}

function flushPushes() {
  for (const id of Object.keys(pushTimers)) {
    clearTimeout(pushTimers[id]);
    delete pushTimers[id];
    push(id);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPushes();
  else pullAll(); // pick up what another device changed meanwhile
});
addEventListener('online', pullAll);


// ---------- accounts
let authMode = 'in'; // in | up | forgot | recover
let isAdmin = false;
let settings = { signups_open: true, announcement: '' };
const fmtDate = s => (s ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(s)) : '—');

function fr(message = '') {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou mot de passe incorrect.';
  if (m.includes('already registered')) return 'Un compte existe déjà avec cet e-mail. Connecte-toi plutôt.';
  if (m.includes('email not confirmed')) return 'Confirme d’abord ton adresse avec le lien reçu par e-mail.';
  if (m.includes('inscriptions sont fermées') || m.includes('database error saving new user')) return 'Les inscriptions sont fermées pour le moment.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Trop de tentatives. Réessaie dans quelques minutes.';
  if (m.includes('password should be')) return 'Le mot de passe doit faire au moins 8 caractères.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Pas de connexion internet. Réessaie plus tard.';
  return message;
}

async function loadSettings() {
  const { data } = await sb.from('settings').select('signups_open,announcement').eq('id', 1).maybeSingle();
  if (data) settings = data;
  const bar = document.getElementById('announce');
  bar.textContent = settings.announcement;
  bar.hidden = !settings.announcement.trim();
}

async function refreshAdmin() {
  isAdmin = false;
  if (user) {
    const { data } = await sb.rpc('is_admin');
    isAdmin = data === true;
  }
  document.querySelector('[data-nav="admin"]').hidden = !isAdmin;
}

function accountView() {
  const back = `<a class="back-link" href="#">${icon('back')}Mes sets</a>`;
  const shell = inner => `${back}<div class="auth-wrap"><div class="auth-side" aria-hidden="true"><span class="sheet a3"></span><span class="sheet a2"></span><span class="sheet a1"><span class="sheet-label">Recto</span><span class="sheet-text">Tes fiches, sur tous tes appareils</span></span></div>${inner}</div>`;
  if (!SUPABASE_URL) {
    return mount(shell(`<section class="panel"><h1>Mon compte</h1><p>Les comptes ne sont pas encore activés sur ce site. Tes sets sont enregistrés dans ce navigateur : pense à exporter une sauvegarde de temps en temps.</p></section>`), { wide: true });
  }
  if (!sb) return mount(shell(`<section class="panel"><h1>Mon compte</h1><p>${esc(syncMsg || 'Connexion au service…')}</p></section>`), { wide: true });

  if (user && authMode !== 'recover') {
    const local = live().length;
    return mount(shell(`<section class="panel">
      <p class="eyebrow">Mon compte</p>
      <h1>${esc(user.email)}</h1>
      <p class="muted">Inscrit le ${fmtDate(user.created_at)}${isAdmin ? ' · <span class="badge-inline">Administrateur</span>' : ''}</p>
      <div class="sync-box"><span class="sync-dot" data-state="${syncState}"></span><div><strong>${esc(syncState === 'error' ? 'Erreur de synchronisation' : LABELS[syncState])}</strong><p class="muted small">${syncState === 'error' ? esc(syncMsg) : `${plural(local, 'set')} sur cet appareil, synchronisé${local > 1 ? 's' : ''} avec ton compte.`}</p></div></div>
      <div class="actions">
        <button class="btn" data-action="sync">${icon('review')}Synchroniser maintenant</button>
        ${isAdmin ? `<a class="btn" href="#admin">Espace admin</a>` : ''}
        <button class="btn ghost" data-action="out">Se déconnecter</button>
      </div>
      <div class="danger-zone" id="dz"><button class="btn ghost small-btn" data-action="ask">${icon('trash')}Supprimer mon compte</button></div>
    </section>`), {
      wide: true,
      click: {
        sync: pullAll,
        out: async () => { flushPushes(); await sb.auth.signOut(); toast('Déconnecté. Tes sets restent sur cet appareil.'); },
        ask: () => {
          document.getElementById('dz').innerHTML = `<p>Ton compte et tous les sets enregistrés en ligne seront effacés. Les sets restent sur cet appareil jusqu’à ce que tu les supprimes.</p>
            <div class="actions"><button class="btn danger" data-action="del">Supprimer définitivement</button><button class="btn" data-action="keep">Annuler</button></div>`;
        },
        keep: () => route(),
        del: async () => {
          const { error } = await sb.rpc('delete_my_account');
          if (error) return toast(fr(error.message));
          await sb.auth.signOut();
          toast('Compte supprimé.');
        },
      },
    });
  }

  const closed = !settings.signups_open;
  const tabs = authMode === 'in' || authMode === 'up' ? `<div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${authMode === 'in'}" data-action="mode" data-mode="in">Se connecter</button>
      <button type="button" role="tab" aria-selected="${authMode === 'up'}" data-action="mode" data-mode="up">Créer un compte</button>
    </div>` : '';
  const forms = {
    in: `<h1>Bon retour</h1><p class="muted">Connecte-toi avec ton compte Recto. Première visite ? Choisis « Créer un compte » juste au-dessus.</p>
      <label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="current-password" required>
      <button class="link-btn" type="button" data-action="mode" data-mode="forgot">Mot de passe oublié ?</button>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn primary lg" type="submit">Se connecter</button>`,
    up: closed ? `<h1>Inscriptions fermées</h1><p class="muted">Les nouvelles inscriptions sont fermées pour le moment. Si tu as déjà un compte, connecte-toi.</p>`
      : `<h1>Créer ton compte</h1><p class="muted">Gratuit. Tes sets se synchronisent automatiquement sur tous tes appareils, et ceux déjà créés ici sont gardés.</p>
      <label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>
      <label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
      <label for="password2">Confirme le mot de passe</label><input id="password2" name="password2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="muted small">Au moins 8 caractères.</p>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn primary lg" type="submit">Créer mon compte</button>`,
    forgot: `<h1>Mot de passe oublié</h1><p class="muted">Indique ton e-mail : tu recevras un lien pour choisir un nouveau mot de passe.</p>
      <label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required>
      <p class="form-error" id="err" role="alert"></p>
      <div class="actions"><button class="btn primary lg" type="submit">Envoyer le lien</button><button class="btn ghost" type="button" data-action="mode" data-mode="in">Retour</button></div>`,
    recover: `<h1>Nouveau mot de passe</h1><p class="muted">Choisis ton nouveau mot de passe.</p>
      <label for="password">Nouveau mot de passe</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
      <label for="password2">Confirme le mot de passe</label><input id="password2" name="password2" type="password" autocomplete="new-password" minlength="8" required>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn primary lg" type="submit">Enregistrer</button>`,
  };
  mount(shell(`<form class="panel" id="login" novalidate>${tabs}${forms[authMode]}</form>`), {
    wide: true,
    submit: () => auth(),
    click: { mode: el => { authMode = el.dataset.mode; route(); app.querySelector('#email, #password')?.focus(); } },
  });
}

async function auth() {
  const form = app.querySelector('#login');
  const err = form.querySelector('#err');
  if (!err || !form.reportValidity()) return;
  const f = form.elements, email = f.email?.value.trim(), password = f.password?.value;
  if (f.password2 && f.password2.value !== password) { err.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
  err.textContent = '';
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  let res;
  if (authMode === 'in') res = await sb.auth.signInWithPassword({ email, password });
  else if (authMode === 'up') res = await sb.auth.signUp({ email, password });
  else if (authMode === 'forgot') res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  else res = await sb.auth.updateUser({ password });
  button.disabled = false;
  if (res.error && authMode === 'in' && /invalid login credentials/i.test(res.error.message)) {
    err.innerHTML = 'E-mail ou mot de passe incorrect. Pas encore de compte Recto ? Ton compte GitHub ou Google ne marche pas ici : <button class="link-btn" type="button" data-action="mode" data-mode="up">crée ton compte Recto</button>.';
    return;
  }
  if (res.error) { err.textContent = fr(res.error.message); return; }
  if (authMode === 'up' && !res.data.session) { err.textContent = 'Compte créé. Clique sur le lien reçu par e-mail pour l’activer, puis connecte-toi.'; return; }
  if (authMode === 'forgot') { err.textContent = 'Si un compte existe avec cet e-mail, le lien vient de partir. Pense à vérifier les indésirables.'; return; }
  if (authMode === 'up') toast('Bienvenue ! Ton compte est créé et tes sets sont synchronisés.');
  if (authMode === 'recover') toast('Mot de passe modifié.');
  authMode = 'in';
  route();
}

// ---------- admin (every check is repeated server-side in supabase.sql)
function adminView() {
  const back = `<a class="back-link" href="#">${icon('back')}Mes sets</a>`;
  if (!sb || !user || !isAdmin) {
    return mount(`${back}<section class="panel"><h1>Espace admin</h1><p class="muted">${user ? 'Cette page est réservée aux administrateurs.' : 'Connecte-toi avec un compte administrateur pour accéder à cette page.'}</p>${user ? '' : '<a class="btn primary" href="#account">Se connecter</a>'}</section>`);
  }
  let users = [], confirmDel = null;
  mount(`${back}<header class="page-head"><p class="eyebrow">Administration</p><h1>Espace admin</h1><p class="muted">Gère les comptes et les réglages du site. Tu vois le nombre de sets de chacun, jamais leur contenu.</p></header><div id="admin-body" class="admin"><p class="muted">Chargement…</p></div>`, {
    wide: true,
    click: {
      reload: load,
      promote: el => setRole(el.dataset.id, true),
      demote: el => setRole(el.dataset.id, false),
      del: el => { confirmDel = el.dataset.id; draw(); },
      cancel: () => { confirmDel = null; draw(); },
      confirm: async el => {
        const { error } = await sb.rpc('admin_delete_user', { target: el.dataset.id });
        confirmDel = null;
        if (error) toast(fr(error.message)); else toast('Compte supprimé.');
        load();
      },
    },
    submit: async () => {
      const form = app.querySelector('#settings-form');
      const next = { signups_open: form.elements.open.checked, announcement: form.elements.announce.value.trim() };
      const { error } = await sb.from('settings').update(next).eq('id', 1);
      if (error) return toast(fr(error.message));
      settings = next;
      loadSettings();
      toast('Réglages enregistrés.');
    },
  });

  async function setRole(target, make) {
    const { error } = await sb.rpc('admin_set_admin', { target, make });
    if (error) toast(fr(error.message)); else toast(make ? 'Droits d’admin ajoutés.' : 'Droits d’admin retirés.');
    load();
  }

  async function load() {
    const { data, error } = await sb.rpc('admin_users');
    if (error) { app.querySelector('#admin-body').innerHTML = `<p class="form-error">${esc(fr(error.message))}</p>`; return; }
    users = data;
    draw();
  }

  function draw() {
    const body = app.querySelector('#admin-body');
    if (!body) return;
    const week = Date.now() - 7 * 864e5;
    const sum = k => users.reduce((n, u) => n + Number(u[k] || 0), 0);
    const recent = users.filter(u => Date.parse(u.created_at) > week).length;
    const active = users.filter(u => u.last_sign_in_at && Date.parse(u.last_sign_in_at) > week).length;
    body.innerHTML = `
      <section class="stats five" aria-label="Chiffres du site">
        <div class="stat"><span class="stat-num">${users.length}</span><span class="stat-label">comptes</span></div>
        <div class="stat"><span class="stat-num">${recent}</span><span class="stat-label">inscrits cette semaine</span></div>
        <div class="stat"><span class="stat-num">${active}</span><span class="stat-label">connectés cette semaine</span></div>
        <div class="stat"><span class="stat-num">${sum('decks')}</span><span class="stat-label">sets</span></div>
        <div class="stat"><span class="stat-num">${sum('cards')}</span><span class="stat-label">cartes</span></div>
      </section>
      <form class="panel admin-settings" id="settings-form">
        <h2>Réglages du site</h2>
        <label class="switch"><input type="checkbox" name="open" ${settings.signups_open ? 'checked' : ''}><span><strong>Inscriptions ouvertes</strong><span class="muted small">Décoche pour empêcher la création de nouveaux comptes. Les comptes existants continuent de marcher.</span></span></label>
        <label for="announce">Annonce affichée en haut du site</label>
        <textarea id="announce" name="announce" rows="2" maxlength="280" placeholder="Ex. : Maintenance dimanche à 20 h. Laisse vide pour ne rien afficher.">${esc(settings.announcement)}</textarea>
        <div class="actions"><button class="btn primary" type="submit">Enregistrer</button></div>
      </form>
      <section class="admin-users">
        <div class="row-head"><h2>Comptes <span class="pill">${users.length}</span></h2><button class="btn" data-action="reload">${icon('review')}Actualiser</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>E-mail</th><th>Inscription</th><th>Dernière connexion</th><th class="num">Sets</th><th class="num">Cartes</th><th><span class="sr">Actions</span></th></tr></thead>
          <tbody>${users.map(u => {
            const me = u.id === user.id;
            const actions = confirmDel === u.id
              ? `<span class="confirm">Supprimer ce compte et ses sets ?</span><button class="btn danger" data-action="confirm" data-id="${u.id}">Supprimer</button><button class="btn" data-action="cancel">Annuler</button>`
              : me ? '<span class="muted small">C’est toi</span>'
                : `${u.is_admin ? `<button class="btn" data-action="demote" data-id="${u.id}">Retirer admin</button>` : `<button class="btn" data-action="promote" data-id="${u.id}">Rendre admin</button>`}
                   <button class="btn ghost" data-action="del" data-id="${u.id}" aria-label="Supprimer ${esc(u.email)}">${icon('trash')}</button>`;
            return `<tr><td><span class="u-mail">${esc(u.email)}</span>${u.is_admin ? ' <span class="badge-inline">Admin</span>' : ''}</td>
              <td>${fmtDate(u.created_at)}</td><td>${fmtDate(u.last_sign_in_at)}</td>
              <td class="num">${u.decks}</td><td class="num">${u.cards}</td><td><div class="row-actions">${actions}</div></td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </section>`;
  }
  load();
}

route();
initSync();
