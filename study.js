import { shuffle, sameAnswer, review, buildQcm } from './logic.js?v=8';
import {
  state, views, mount, app, esc, plural, icon, toast, playable, live, touch, touchCard, backTo, backHome, logStudy, recordAnswer,
  speak, canSpeak, langOf, faceHTML, renderMath, store,
} from './core.js?v=8';
import { explain } from './ai.js?v=8';

const other = side => (side === 'term' ? 'def' : 'term');
const sideText = (c, side) => c[side];
const sideImg = (c, side) => (side === 'def' ? c.img : null);
const sideHTML = (c, side) => faceHTML(sideText(c, side), sideImg(c, side));
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
  const dir = getDir();
  const all = playable(d, fav), total = all.length;
  const pool = playable(d); // wrong options may come from the whole set
  const queue = shuffle(all).map(c => ({ c, p: 0 }));
  let mastered = 0, cur = null, pending = null, opts = [], q = 'term';
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
        submit: () => { const v = app.querySelector('#ans').value; if (!pending && v.trim()) answer(sameAnswer(v, cur.c[a]), v); },
        click: { ...common, idk: () => answer(false, ''), cont: advance, explain: doExplain, override: () => { pending.ok = true; advance(); } },
      });
      app.querySelector('#ans').focus();
    }
  }

  function answer(ok, given) {
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
    fb.innerHTML = `${ok ? '<p><strong>Correct.</strong></p>'
      : `<p><strong>${given === '' ? 'Voici la réponse.' : 'Pas tout à fait.'}</strong> Réponse attendue : <span class="expected">${esc(cur.c[a])}</span></p>`}
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

// ---------- test: options screen, then a graded exam
const TYPES = [['qcm', 'QCM'], ['write', 'Réponse écrite'], ['tf', 'Vrai ou faux']];
views.test = function testView(d, fav) {
  const all = playable(d, fav), pool = playable(d);
  const saved = (() => { try { return JSON.parse(store.get('recto.test')) || {}; } catch { return {}; } })();
  const opt = { count: saved.count || 20, types: saved.types || ['qcm', 'write', 'tf'], dir: saved.dir || 'term', timer: !!saved.timer };
  const counts = [5, 10, 20, 50].filter(n => n < all.length);

  mount(`${head(d, 'Test', fav)}
    <form class="panel test-setup" id="setup">
      <h2>Paramètres du test</h2>
      <fieldset><legend>Nombre de questions</legend><div class="seg">${[...counts, all.length].map(n => `<label><input type="radio" name="count" value="${n}" ${Math.min(opt.count, all.length) === n ? 'checked' : ''}><span>${n === all.length ? `Toutes (${n})` : n}</span></label>`).join('')}</div></fieldset>
      <fieldset><legend>Types de questions</legend><div class="checks">${TYPES.map(([k, l]) => `<label class="check"><input type="checkbox" name="types" value="${k}" ${opt.types.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
      <fieldset><legend>Question sur</legend><div class="seg">${DIRS.map(([k, l]) => `<label><input type="radio" name="dir" value="${k}" ${opt.dir === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
      <label class="check"><input type="checkbox" name="timer" ${opt.timer ? 'checked' : ''}><span>Afficher un chronomètre</span></label>
      <p class="form-error" id="err" role="alert"></p>
      <button class="btn primary lg" type="submit">Commencer le test</button>
    </form>`, {
    submit: () => {
      const f = new FormData(app.querySelector('#setup'));
      const types = f.getAll('types');
      if (!types.length) { app.querySelector('#err').textContent = 'Choisis au moins un type de question.'; return; }
      const o = { count: +f.get('count'), types, dir: f.get('dir'), timer: f.get('timer') === 'on' };
      store.set('recto.test', JSON.stringify(o));
      run(o);
    },
  });

  function run(o) {
    const picked = shuffle(all).slice(0, o.count);
    const kinds = shuffle(picked.map((_, i) => o.types[i % o.types.length]));
    const qs = picked.map((c, i) => {
      const type = kinds[i], q = pickSide(o.dir), a = other(q);
      if (type === 'qcm') return { type, c, q, a, opts: buildQcm(pool, c, a) };
      if (type === 'tf') {
        const wrong = shuffle(pool.filter(x => x.id !== c.id && x[a] !== c[a]))[0];
        const truth = !wrong || Math.random() < 0.5;
        return { type, c, q, a, shown: truth ? c[a] : wrong[a], truth };
      }
      return { type, c, q, a };
    });
    const body = (x, i) => {
      const what = x.a === 'def' ? 'la définition' : 'le terme';
      if (x.type === 'qcm') {
        return `<legend><span class="num">${i + 1}</span>Choisis ${what}</legend><div class="prompt sm">${sideHTML(x.c, x.q)}</div>
          ${x.opts.map((o2, k) => `<label class="choice"><input type="radio" name="q${i}" value="${k}"><span>${esc(o2)}</span></label>`).join('')}`;
      }
      if (x.type === 'tf') {
        return `<legend><span class="num">${i + 1}</span>Vrai ou faux ?</legend><div class="prompt sm">${sideHTML(x.c, x.q)}</div><p class="tf-shown">${icon('next')}${esc(x.shown)}</p>
          <div class="tf"><label class="choice"><input type="radio" name="q${i}" value="1"><span>Vrai</span></label><label class="choice"><input type="radio" name="q${i}" value="0"><span>Faux</span></label></div>`;
      }
      return `<legend><span class="num">${i + 1}</span>Écris ${what}</legend><div class="prompt sm">${sideHTML(x.c, x.q)}</div>
        <label class="sr" for="w${i}">Ta réponse</label><input id="w${i}" name="q${i}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Ta réponse">`;
    };
    let graded = false, timer = null;
    const t0 = Date.now();
    const elapsed = () => { const s = Math.round((Date.now() - t0) / 1000); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
    mount(`${head(d, 'Test', fav, o.timer ? '<span class="count timer" id="timer">0 min 00 s</span>' : `<span class="count">${plural(qs.length, 'question')}</span>`)}
      <form class="test" novalidate>${qs.map((x, i) => `<fieldset class="tq" id="q${i}">${body(x, i)}</fieldset>`).join('')}
      <div class="actions" id="test-actions"><button class="btn primary lg" type="submit">Corriger</button></div></form>`, {
      cleanup: () => clearInterval(timer),
      submit: () => {
        if (graded) return;
        graded = true;
        clearInterval(timer);
        const form = app.querySelector('form.test'), data = new FormData(form);
        let score = 0;
        qs.forEach((x, i) => {
          const v = data.get(`q${i}`);
          const ok = x.type === 'qcm' ? v !== null && x.opts[+v] === x.c[x.a]
            : x.type === 'tf' ? v !== null && (v === '1') === x.truth
              : sameAnswer(v || '', x.c[x.a]);
          score += ok;
          recordAnswer(d, x.c, ok);
          const fs = app.querySelector(`#q${i}`);
          fs.classList.add(ok ? 'ok' : 'ko');
          fs.disabled = true;
          if (!ok) {
            const right = x.type === 'tf' ? (x.truth ? 'Vrai' : `Faux : ${x.c[x.q]} → ${x.c[x.a]}`) : x.c[x.a];
            fs.insertAdjacentHTML('beforeend', `<p class="expected-line">Réponse : ${esc(right)}</p>`);
          }
        });
        logStudy(qs.length);
        form.insertAdjacentHTML('afterbegin', `<div class="score" role="status"><strong>${score} / ${qs.length}</strong><span>${Math.round((score / qs.length) * 100)} %</span><span class="muted">en ${elapsed()}</span></div>`);
        app.querySelector('#test-actions').innerHTML = `<button class="btn primary" type="button" data-action="again">Nouveau test</button><a class="btn" href="#learn/${d.id}${fav ? '/fav' : ''}">Retravailler avec Apprendre</a>`;
        renderMath(form);
        scrollTo(0, 0);
      },
      click: { again: () => { testView(d, fav); scrollTo(0, 0); } },
    });
    if (o.timer) timer = setInterval(() => { const el = document.getElementById('timer'); if (el) el.textContent = elapsed(); }, 1000);
  }
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
  const mode = modeArg || store.get('recto.write') || 'write'; // write: read the definition, type the term · dictee: hear the term, type it
  const cards = only || shuffle(playable(d, fav));
  const missed = [];
  let i = 0, ok = 0, pending = null;
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
      submit: () => { const v = app.querySelector('#ans').value; if (!pending && v.trim()) answer(sameAnswer(v, c.term), v); },
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

    function answer(good, given) {
      if (pending) return;
      pending = { ok: good };
      logStudy();
      app.querySelector('#ans').disabled = true;
      app.querySelector('#ask-actions').remove();
      const fb = document.createElement('div');
      fb.className = `feedback ${good ? 'ok' : 'ko'}`;
      fb.setAttribute('role', 'status');
      fb.innerHTML = `${good ? '<p><strong>Correct.</strong></p>' : `<p><strong>${given ? 'Pas tout à fait.' : 'Voici la réponse.'}</strong> Réponse attendue : <span class="expected">${esc(c.term)}</span></p>`}
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
