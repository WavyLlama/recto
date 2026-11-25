import { shuffle, sameAnswer, review, buildQcm } from './logic.js?v=18';
import {
  state, views, mount, app, esc, plural, icon, toast, playable, live, touch, touchCard, backTo, backHome, logStudy, recordAnswer,
  speak, canSpeak, langOf, faceHTML, renderMath, store,
} from './core.js?v=18';
import { explain, gradeAnswers, warmUp } from './ai.js?v=18';

const other = side => (side === 'term' ? 'def' : 'term');
const sideText = (c, side) => c[side];
const sideImg = (c, side) => (side === 'def' ? c.img : null);
const sideHTML = (c, side) => faceHTML(sideText(c, side), sideImg(c, side));
// A written answer: exact match first; otherwise, when signed in, the AI judges it on substance.
async function checkWritten(c, side, given) {
  if (sameAnswer(given, c[side])) return { ok: true };
  if (!state.user) return { ok: false };
  try {
    const [r] = await gradeAnswers([{ term: c.term, def: c.def, side, given }]);
    return { ok: r?.correct === true, note: r?.feedback || '', ai: true };
  } catch (err) {
    return { ok: false, aiError: err.message };
  }
}
const busyButton = () => {
  const b = app.querySelector('#ask-actions [type=submit]');
  if (b) { b.disabled = true; b.textContent = 'Vérification…'; }
};
// Feedback lines added by the AI check.
const aiLines = (r, ok) => (!r ? '' : r.aiError ? `<p class="muted small">L’IA n’a pas pu vérifier : ${esc(r.aiError)}</p>`
  : r.ai && r.note ? `<p class="ai-note">${icon('sparkle')}<span>${ok ? 'Accepté par l’IA : ' : ''}${esc(r.note)}</span></p>` : '');

const favTag = fav => (fav ? '<span class="pill">Favoris</span>' : '');
const head = (d, title, fav, extra = '') => `${backTo(d)}<div class="study-head"><h1 class="mode-title">${title} ${favTag(fav)}</h1>${extra}</div>`;

// Remembered question direction: 'term' shows the term, 'def' the definition, 'mix' either.
const DIRS = [['term', 'Terme → définition'], ['def', 'Définition → terme'], ['mix', 'Mélange']];
const getDir = () => store.get('recto.dir') || 'term';
const pickSide = dir => (dir === 'mix' ? (Math.random() < 0.5 ? 'term' : 'def') : dir);
const dirBar = dir => `<div class="seg" role="group" aria-label="Sens des questions">${DIRS.map(([k, l]) => `<button type="button" data-action="dir" data-dir="${k}" aria-pressed="${dir === k}">${l}</button>`).join('')}</div>`;

const starBtn = c => `<button class="btn round star-btn" data-action="star" aria-pressed="${!!c.star}" aria-label="${c.star ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${icon('star')}</button>`;
function toggleStar(d, c) {
  c.star = !c.star;
  if (!c.star) delete c.star;
  touchCard(d, c);
  const b = app.querySelector('.star-btn');
  if (b) { b.setAttribute('aria-pressed', !!c.star); b.setAttribute('aria-label', c.star ? 'Retirer des favoris' : 'Ajouter aux favoris'); }
  toast(c.star ? 'Ajoutée aux favoris.' : 'Retirée des favoris.');
}

// ---------- flashcards
views.cards = function cardsView(d, fav) {
  let order = playable(d, fav), i = 0, flipped = false, defFirst = false;
  if (!order.length) return mount(`${backTo(d)}<p class="empty">Aucune carte à afficher.</p>`);
  const flip = () => {
    flipped = !flipped;
    app.querySelector('.flash').classList.toggle('flipped', flipped);
    app.querySelector('.face.front').setAttribute('aria-hidden', flipped);
    app.querySelector('.face.back').setAttribute('aria-hidden', !flipped);
  };
  const go = k => { if (k >= 0 && k < order.length) { i = k; flipped = false; draw(); } };
  const draw = () => {
    const c = order[i];
    const [front, back] = defFirst ? ['def', 'term'] : ['term', 'def'];
    mount(`${head(d, 'Cartes', fav, `<span class="count">${i + 1} / ${order.length}</span>`)}
      <button class="flash" data-action="flip">
        <span class="inner">
          <span class="face front"><span class="side-label">${front === 'term' ? 'Terme' : 'Définition'}</span>${sideHTML(c, front)}</span>
          <span class="face back" aria-hidden="true"><span class="side-label">${back === 'term' ? 'Terme' : 'Définition'}</span>${sideHTML(c, back)}</span>
        </span>
      </button>
      <div class="controls">
        <button class="btn round" data-action="prev" ${i ? '' : 'disabled'} aria-label="Carte précédente">${icon('back')}</button>
        ${starBtn(c)}
        ${canSpeak ? `<button class="btn" data-action="speak">${icon('speak')}Écouter</button>` : ''}
        <button class="btn" data-action="shuffle">${icon('shuffle')}Mélanger</button>
        <button class="btn" data-action="swap">${icon('swap')}${defFirst ? 'Terme d’abord' : 'Définition d’abord'}</button>
        <button class="btn round" data-action="next" ${i < order.length - 1 ? '' : 'disabled'} aria-label="Carte suivante">${icon('next')}</button>
      </div>
      <div class="progress thin" aria-hidden="true"><span style="width:${((i + 1) / order.length) * 100}%"></span></div>
      <p class="hint">Espace pour retourner · flèches pour changer de carte · S pour les favoris · ? pour l’aide</p>`, {
      cleanup: () => canSpeak && speechSynthesis.cancel(),
      click: {
        flip,
        prev: () => go(i - 1),
        next: () => go(i + 1),
        star: () => toggleStar(d, c),
        shuffle: () => { order = shuffle(order); i = 0; flipped = false; draw(); toast('Cartes mélangées.'); },
        swap: () => { defFirst = !defFirst; flipped = false; draw(); },
        speak: () => { const side = flipped ? back : front; speak(c[side], langOf(d, side)); },
      },
      key: e => {
        if (e.key === ' ') { e.preventDefault(); flip(); }
        else if (e.key === 'ArrowRight') go(i + 1);
        else if (e.key === 'ArrowLeft') go(i - 1);
        else if (e.key.toLowerCase() === 's') toggleStar(d, c);
      },
    });
  };
  draw();
};

// ---------- learn: QCM first, then written answer; two right answers in a row = mastered
views.learn = function learnView(d, fav) {
  warmUp();
  const dir = getDir();
  const all = playable(d, fav), total = all.length;
  const pool = playable(d); // wrong options may come from the whole set
  const queue = shuffle(all).map(c => ({ c, p: 0 }));
  let mastered = 0, cur = null, pending = null, opts = [], q = 'term', checking = false;
  const top = () => `${head(d, 'Apprendre', fav)}${dirBar(dir)}
    <div class="progress" role="progressbar" aria-label="Cartes maîtrisées" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${mastered}"><span style="width:${(mastered / total) * 100}%"></span></div>
    <p class="muted small">${mastered} / ${total} maîtrisée${mastered > 1 ? 's' : ''}</p>`;
  const common = { dir: el => { store.set('recto.dir', el.dataset.dir); learnView(d, fav); } };

  function next() {
    pending = null;
    cur = queue.shift();
    if (!cur) {
      return mount(`${top()}<section class="done"><h2>Set maîtrisé</h2><p>Deux bonnes réponses d’affilée sur chacune des ${plural(total, 'carte')}.</p>
        <div class="actions"><a class="btn primary" href="#test/${d.id}${fav ? '/fav' : ''}">Passer le test</a><button class="btn" data-action="again">Recommencer</button></div></section>`,
      { click: { ...common, again: () => learnView(d, fav) } });
    }
    q = pickSide(dir);
    const a = other(q);
    if (cur.p === 0) {
      opts = buildQcm(pool, cur.c, a);
      mount(`${top()}<section class="question"><p class="q-label">Choisis ${a === 'def' ? 'la définition' : 'le terme'}</p><div class="prompt">${sideHTML(cur.c, q)}</div>
        <div class="options">${opts.map((o, k) => `<button class="option" data-action="pick" data-k="${k}"><kbd>${k + 1}</kbd><span>${esc(o)}</span></button>`).join('')}</div></section>`, {
        click: { ...common, pick: el => answer(opts[+el.dataset.k] === cur.c[a], +el.dataset.k), cont: advance, explain: doExplain },
        key: e => { const k = +e.key - 1; if (!pending && k >= 0 && k < opts.length) answer(opts[k] === cur.c[a], k); },
      });
    } else {
      mount(`${top()}<form class="question"><p class="q-label">Écris ${a === 'def' ? 'la définition' : 'le terme'}</p><div class="prompt">${sideHTML(cur.c, q)}</div>
        <label class="sr" for="ans">Ta réponse</label>
        <input id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ta réponse">
        <div class="actions" id="ask-actions"><button class="btn primary" type="submit">Valider</button><button class="btn ghost" type="button" data-action="idk">Je ne sais pas</button></div></form>`, {
        submit: async () => {
          const v = app.querySelector('#ans').value;
          if (pending || checking || !v.trim()) return;
          checking = true;
          busyButton();
          const r = await checkWritten(cur.c, a, v);
          checking = false;
          answer(r.ok, v, r);
        },
        click: { ...common, idk: () => answer(false, ''), cont: advance, explain: doExplain, override: () => { pending.ok = true; advance(); } },
      });
      app.querySelector('#ans').focus();
    }
  }

  function answer(ok, given, check = null) {
    if (pending) return;
    const a = other(q), qcm = cur.p === 0;
    pending = { ok, given: qcm ? opts[given] : given };
    logStudy();
    if (qcm) {
      app.querySelectorAll('.option').forEach((b, k) => {
        b.disabled = true;
        if (opts[k] === cur.c[a]) b.classList.add('right');
        else if (k === given) b.classList.add('wrong');
      });
    } else {
      app.querySelector('#ans').disabled = true;
      app.querySelector('#ask-actions').remove();
    }
    const fb = document.createElement('div');
    fb.className = `feedback ${ok ? 'ok' : 'ko'}`;
    fb.setAttribute('role', 'status');
    fb.innerHTML = `${ok ? `<p><strong>Correct.</strong>${check?.ai ? ` Réponse attendue : <span class="expected">${esc(cur.c[a])}</span>` : ''}</p>`
      : `<p><strong>${given === '' ? 'Voici la réponse.' : 'Pas tout à fait.'}</strong> Réponse attendue : <span class="expected">${esc(cur.c[a])}</span></p>`}
      ${aiLines(check, ok)}
      <div class="explain-slot"></div>
      <div class="actions"><button class="btn primary" data-action="cont">Continuer</button>
        ${!ok && !qcm && given !== '' ? '<button class="btn ghost" data-action="override">J’avais raison</button>' : ''}
        ${!ok && state.user ? `<button class="btn ghost" data-action="explain">${icon('sparkle')}Expliquer avec l’IA</button>` : ''}</div>`;
    app.querySelector('.question').append(fb);
    renderMath(fb);
    fb.querySelector('[data-action=cont]').focus();
  }

  async function doExplain(el) {
    el.disabled = true;
    const slot = app.querySelector('.explain-slot');
    slot.innerHTML = '<p class="muted small">L’IA réfléchit…</p>';
    try {
      slot.innerHTML = `<p class="ai-text">${esc(await explain(cur.c, pending.given, other(q)))}</p>`;
      renderMath(slot);
    } catch (err) {
      slot.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  }

  function advance() {
    if (!pending) return;
    if (pending.ok) {
      cur.p++;
      if (cur.p >= 2) { mastered++; recordAnswer(d, cur.c, true, cur.err ? 1 : 2); }
      else queue.splice(Math.min(queue.length, 3), 0, cur);
    } else {
      cur.p = 0;
      cur.err = true;
      queue.splice(Math.min(queue.length, 2), 0, cur);
    }
    next();
  }
  next();
};

// ---------- match
views.match = function matchView(d, fav) {
  const picks = shuffle(playable(d, fav)).slice(0, 6);
  const tiles = shuffle(picks.flatMap(c => [{ k: c.id, t: c.term }, { k: c.id, t: c.def, img: c.img }]));
  let sel = null, left = picks.length, penalty = 0, timer = null;
  const t0 = performance.now();
  const clock = () => ((performance.now() - t0 + penalty) / 1000).toFixed(1);
  mount(`${head(d, 'Association', fav, '<span class="count timer" id="timer">0.0 s</span>')}
    ${d.bestMatch ? `<p class="muted small">Record : ${d.bestMatch.toFixed(1)} s</p>` : ''}
    <div class="match-grid">${tiles.map((x, i) => `<button class="tile" data-action="tile" data-i="${i}">${x.img ? `<img src="${esc(x.img)}" alt="">` : ''}<span>${esc(x.t)}</span></button>`).join('')}</div>
    <p class="hint">Touche un terme puis sa définition. Une erreur ajoute 1 seconde.</p>`, {
    cleanup: () => clearInterval(timer),
    click: {
      again: () => matchView(d, fav),
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
    logStudy(picks.length);
    const time = +clock(), record = !d.bestMatch || time < d.bestMatch;
    if (record) { d.bestMatch = time; touch(d); }
    app.querySelector('.match-grid').outerHTML = `<section class="done"><h2>${time.toFixed(1)} s</h2><p>${record ? 'Nouveau record pour ce set.' : `Record : ${d.bestMatch.toFixed(1)} s.`}</p>
      <div class="actions"><button class="btn primary" data-action="again">Rejouer</button><a class="btn" href="#deck/${d.id}">Retour au set</a></div></section>`;
  }
};

// ---------- writing and dictation
views.write = function writeView(d, fav, only = null, modeArg = null) {
  warmUp();
  const mode = modeArg || store.get('recto.write') || 'write'; // write: read the definition, type the term · dictee: hear the term, type it
  const cards = only || shuffle(playable(d, fav));
  const missed = [];
  let i = 0, ok = 0, pending = null, checking = false;
  const bar = `<div class="seg" role="group" aria-label="Mode">
    <button type="button" data-action="mode" data-m="write" aria-pressed="${mode === 'write'}">${icon('write')}Écriture</button>
    ${canSpeak ? `<button type="button" data-action="mode" data-m="dictee" aria-pressed="${mode === 'dictee'}">${icon('headphones')}Dictée</button>` : ''}</div>`;
  const common = { mode: el => { store.set('recto.write', el.dataset.m); writeView(d, fav, null, el.dataset.m); } };

  function next() {
    pending = null;
    const c = cards[i];
    if (!c) {
      return mount(`${head(d, 'Écriture et dictée', fav)}${bar}<section class="done"><h2>${ok} / ${cards.length}</h2>
        <p>${missed.length ? `À retravailler : ${missed.map(x => esc(x.term)).join(', ')}.` : 'Aucune faute, bravo.'}</p>
        <div class="actions">${missed.length ? '<button class="btn primary" data-action="missed">Recommencer les erreurs</button>' : ''}<button class="btn" data-action="again">Recommencer</button></div></section>`, {
        click: { ...common, again: () => writeView(d, fav, null, mode), missed: () => writeView(d, fav, shuffle(missed), mode) },
      });
    }
    const dictee = mode === 'dictee';
    mount(`${head(d, 'Écriture et dictée', fav, `<span class="count">${i + 1} / ${cards.length}</span>`)}${bar}
      <form class="question">
        <p class="q-label">${dictee ? 'Écoute et écris le terme' : 'Écris le terme'}</p>
        ${dictee ? `<button class="btn lg listen" type="button" data-action="listen">${icon('speak')}Réécouter</button>` : `<div class="prompt">${sideHTML(c, 'def')}</div>`}
        <label class="sr" for="ans">Ta réponse</label>
        <input id="ans" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ta réponse">
        <div class="actions" id="ask-actions"><button class="btn primary" type="submit">Valider</button><button class="btn ghost" type="button" data-action="idk">Je ne sais pas</button></div>
      </form>`, {
      cleanup: () => canSpeak && speechSynthesis.cancel(),
      submit: async () => {
        const v = app.querySelector('#ans').value;
        if (pending || checking || !v.trim()) return;
        checking = true;
        busyButton();
        const r = await checkWritten(c, 'term', v);
        checking = false;
        answer(r.ok, v, r);
      },
      click: {
        ...common,
        listen: () => speak(c.term, langOf(d, 'term')),
        idk: () => answer(false, ''),
        cont: advance,
        override: () => { pending.ok = true; advance(); },
      },
    });
    app.querySelector('#ans').focus();
    if (dictee) speak(c.term, langOf(d, 'term'));

    function answer(good, given, check = null) {
      if (pending) return;
      pending = { ok: good };
      logStudy();
      app.querySelector('#ans').disabled = true;
      app.querySelector('#ask-actions').remove();
      const fb = document.createElement('div');
      fb.className = `feedback ${good ? 'ok' : 'ko'}`;
      fb.setAttribute('role', 'status');
      fb.innerHTML = `${good ? `<p><strong>Correct.</strong>${check?.ai ? ` Réponse attendue : <span class="expected">${esc(c.term)}</span>` : ''}</p>` : `<p><strong>${given ? 'Pas tout à fait.' : 'Voici la réponse.'}</strong> Réponse attendue : <span class="expected">${esc(c.term)}</span></p>`}
        ${aiLines(check, good)}
        ${dictee ? `<p class="muted small">${esc(c.def)}</p>` : ''}
        <div class="actions"><button class="btn primary" data-action="cont">Continuer</button>${!good && given ? '<button class="btn ghost" data-action="override">J’avais raison</button>' : ''}</div>`;
      app.querySelector('.question').append(fb);
      renderMath(fb);
      fb.querySelector('[data-action=cont]').focus();
    }
  }
  function advance() {
    if (!pending) return;
    recordAnswer(d, cards[i], pending.ok);
    if (pending.ok) ok++;
    else missed.push(cards[i]);
    i++;
    next();
  }
  if (!cards.length) return mount(`${backTo(d)}<p class="empty">Aucune carte à afficher.</p>`);
  next();
};

// ---------- spaced repetition (one deck, or every deck when `only` is null)
views.review = function reviewView(only, fav) {
  const now = Date.now(), due = [], fresh = [];
  for (const deck of only ? [only] : live()) {
    for (const c of playable(deck, fav)) {
      if (!c.srs) fresh.push({ deck, c });
      else if (c.srs.due <= now) due.push({ deck, c });
    }
  }
  const queue = [...shuffle(due), ...fresh.slice(0, 20)]; // at most 20 new cards per session
  const back = only ? `#deck/${only.id}` : '#';
  const backLink = only ? backTo(only) : backHome;
  const LABELS = ['À revoir', 'Difficile', 'Bien', 'Facile'];
  const when = s => (s.interval ? plural(s.interval, 'jour').replace(/^1 jour$/, '1 jour') : '10 min');
  let item = null, revealed = false, done = 0;

  function next() {
    item = queue.shift();
    revealed = false;
    if (!item) {
      return mount(`${backLink}<section class="done"><h2>Révision terminée</h2>
        <p>${done ? `${plural(done, 'carte')} révisée${done > 1 ? 's' : ''}. ` : 'Rien à réviser pour l’instant. '}Les prochaines cartes reviendront au bon moment.</p>
        <a class="btn primary" href="${back}">Retour</a></section>`);
    }
    const { deck, c } = item, t = Date.now();
    mount(`${backLink}
      <div class="study-head"><h1 class="mode-title">Révision ${favTag(fav)}</h1><span class="count">${queue.length + 1} restante${queue.length ? 's' : ''}</span></div>
      ${only ? '' : `<p class="muted small">${esc(deck.title)}</p>`}
      <div class="flash static"><span class="face front"><span class="side-label">${c.srs ? 'Terme' : 'Nouvelle carte · Terme'}</span>${sideHTML(c, 'term')}</span></div>
      <div class="controls">${starBtn(c)}${canSpeak ? `<button class="btn" data-action="speak">${icon('speak')}Écouter</button>` : ''}</div>
      <div id="answer" hidden>
        <div class="answer-text">${sideHTML(c, 'def')}</div>
        <div class="grades">${LABELS.map((l, g) => `<button class="btn grade g${g}" data-action="grade" data-g="${g}"><span><kbd>${g + 1}</kbd> ${l}</span><small>${when(review(c.srs, g, t))}</small></button>`).join('')}</div>
      </div>
      <button class="btn primary wide lg" id="reveal" data-action="reveal">Afficher la réponse</button>`, {
      cleanup: () => canSpeak && speechSynthesis.cancel(),
      click: {
        reveal,
        grade: el => grade(+el.dataset.g),
        star: () => toggleStar(deck, c),
        speak: () => (revealed ? speak(c.def, langOf(deck, 'def')) : speak(c.term, langOf(deck, 'term'))),
      },
      key: e => {
        if (!revealed && e.key === ' ') { e.preventDefault(); reveal(); }
        else if (revealed && /^[1-4]$/.test(e.key)) grade(+e.key - 1);
        else if (e.key.toLowerCase() === 's') toggleStar(deck, c);
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
    touchCard(item.deck, item.c);
    logStudy();
    done++;
    if (g === 0) queue.splice(Math.min(queue.length, 4), 0, item);
    next();
  }
  next();
};
