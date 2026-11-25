// Test mode: an exam written by the AI from the set's cards, taken one question per screen,
// then corrected (written answers in one AI request) and marked out of 20.
// The exam in progress is kept in this browser (recto.exam.<set id>), so it survives a reload.
import { shuffle, review, EXAM_TYPES, examSlots, cleanQuestion, gradeAuto, fromAi, examCriteria, naResult, scoreOf, levelOf, masterSrs, answered } from './logic.js?v=18';
import { views, mount, app, esc, plural, icon, toast, playable, touchCard, backTo, logStudy, store, canSpeak, speak, langOf, MASTERED_DAYS } from './core.js?v=18';
import { examQuestions, correctExam, warmUp } from './ai.js?v=18';

const DIFFS = { facile: 'Facile', intermediaire: 'Intermédiaire', difficile: 'Difficile', mixte: 'Mixte' };
const DIFF_TEXT = { facile: 'Connaître les notions.', intermediaire: 'Les comprendre et s’en servir.', difficile: 'Raisonner, nuancer, éviter les pièges.', mixte: 'Un mélange des trois niveaux.' };
const DEFAULTS = {
  preset: null, types: ['qcm', 'vf', 'ouverte'], qcmMode: 'both', vfJustify: false, difficulty: 'mixte', focus: 'equilibre', count: 10, only: 'all',
  mode: 'exam', correction: 'end', timed: true, duration: 20, random: true, scale: 'weighted', external: false,
};
const PRESETS = {
  express: ['Révision express', 'QCM et vrai/faux faciles, corrigés au fur et à mesure.', () => ({ types: ['qcm', 'vf'], difficulty: 'facile', focus: 'connaissances', count: 15, mode: 'training', correction: 'immediate', timed: false })],
  partiel: ['Simulation de partiel', 'Cas pratiques et questions rédigées, en temps limité.', () => ({ types: ['cas', 'reflexion', 'ouverte', 'qcm'], difficulty: 'mixte', focus: 'raisonnement', count: 8, mode: 'exam', timed: true, duration: 90 })],
  difficile: ['Mode difficile', 'QCM à plusieurs réponses, réflexion et cas exigeants.', () => ({ types: ['qcm', 'reflexion', 'cas'], qcmMode: 'multi', difficulty: 'difficile', focus: 'raisonnement', count: 8, mode: 'exam', timed: true, duration: 45 })],
  marathon: ['Marathon', 'Trente questions de tous les formats.', () => ({ types: Object.keys(EXAM_TYPES), difficulty: 'mixte', count: 30, mode: 'exam', timed: true, duration: 90 })],
  surprise: ['Mode surprise', 'Formats tirés au sort, cartes pas encore maîtrisées d’abord.', () => ({ types: shuffle(Object.keys(EXAM_TYPES)).slice(0, 3), difficulty: 'mixte', count: 12, only: 'weak', mode: 'exam', timed: true, duration: 30 })],
};

const CFG = 'recto.exam.cfg';
const keyOf = id => `recto.exam.${id}`;
const load = k => { try { return JSON.parse(store.get(k)) || null; } catch { return null; } };
let draft = null, resumeAt = 0, tick = null, gen = null, busy = false;

const elapsed = () => draft.elapsed + (resumeAt ? (Date.now() - resumeAt) / 1000 : 0);
function save(dr = draft) {
  if (!dr) return;
  if (dr === draft && resumeAt) { dr.elapsed = elapsed(); resumeAt = Date.now(); }
  store.set(keyOf(dr.deckId), JSON.stringify(dr));
}
function pause() {
  clearInterval(tick);
  if (draft && resumeAt) { draft.elapsed = elapsed(); resumeAt = 0; save(); }
}
const forget = id => store.set(keyOf(id), '');
const here = d => location.hash.startsWith(`#test/${d.id}`);
const head = d => `${backTo(d)}<div class="study-head"><h1 class="mode-title">Test ${draft?.fav ? '<span class="pill">Favoris</span>' : ''}</h1></div>`;
const fmt = x => (Math.round(x * 10) / 10).toLocaleString('fr-FR');
const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`; };
const duration = s => { s = Math.round(s); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
const total = qs => qs.reduce((n, q) => n + q.points, 0);
const typeLabel = t => EXAM_TYPES[t]?.label || t;
// Google's free AI is often saturated for a few seconds: one more try after a pause.
async function retry(fn) {
  try { return await fn(); } catch (err) {
    if (!/saturée|ne répond pas|pas pu répondre/.test(err.message)) throw err;
    await new Promise(res => setTimeout(res, 4000));
    return fn();
  }
}

views.test = function testView(d, fav) {
  warmUp();
  if (gen && gen.deckId === d.id && !gen.done) return generating(d);
  draft = load(keyOf(d.id));
  if (draft?.phase === 'correcting') return correct(d);
  setup(d, fav);
};

// ---------- settings
function setup(d, fav) {
  const o = { ...DEFAULTS, ...(load(CFG) || {}) };
  const all = playable(d, fav);
  const weak = all.filter(c => !c.srs || c.srs.interval < MASTERED_DAYS);
  const maxQ = Math.min(30, Math.max(5, all.length * 3));
  const saved = draft;

  const seg = (k, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-action="set" data-k="${k}" data-v="${v}" aria-pressed="${String(o[k]) === v}">${l}</button>`).join('')}</div>`;
  const toggle = (k, title, text) => `<label class="toggle"><span><strong>${title}</strong>${text ? `<span class="muted small">${text}</span>` : ''}</span><input type="checkbox" class="sw" data-k="${k}" ${o[k] ? 'checked' : ''}></label>`;
  const opt = (action, k, v, on, title, text) => `<button type="button" class="opt-tile" data-action="${action}" data-k="${k}" data-v="${v}" aria-pressed="${on}"><span class="tick">${icon('check')}</span><strong>${title}</strong><span class="muted small">${text}</span></button>`;

  function draw() {
    o.count = Math.min(o.count, maxQ);
    const n = o.only === 'weak' && weak.length ? weak.length : all.length;
    const resume = saved?.questions?.length && saved.phase !== 'done';
    mount(`${backTo(d)}<div class="study-head"><h1 class="mode-title">Test ${fav ? '<span class="pill">Favoris</span>' : ''}</h1><span class="count">Examen rédigé par l’IA à partir de tes cartes</span></div>
      ${resume ? `<div class="exam-notice"><span>${icon('clock')}Un examen est en cours : ${plural(saved.questions.length, 'question')}, ${saved.questions.filter(q => answered(q, saved.answers[q.id])).length} avec une réponse.</span><span class="actions"><button class="btn primary" data-action="resume">Reprendre</button><button class="btn ghost" data-action="abandon">Abandonner</button></span></div>`
        : saved?.results ? `<div class="exam-notice"><span>${icon('chart')}Ta dernière copie : ${fmt(scoreOf(saved.questions, saved.results).score20)} / 20.</span><span class="actions"><button class="btn" data-action="resume">Revoir la correction</button></span></div>` : ''}
      <div class="presets">${Object.entries(PRESETS).map(([k, [t, text]]) => `<button type="button" class="preset" data-action="preset" data-k="${k}" aria-pressed="${o.preset === k}" ${k === 'surprise' && !weak.length ? 'disabled' : ''}><strong>${t}</strong><span class="muted small">${text}</span></button>`).join('')}</div>
      <div class="exam-setup">
        <div class="panel setup-main">
          <fieldset><legend>Types de questions</legend>
            <div class="opt-grid">${Object.entries(EXAM_TYPES).map(([k, t]) => opt('type', k, k, o.types.includes(k), t.label, t.desc)).join('')}</div>
            ${o.types.includes('qcm') ? `<div class="sub-opt"><span class="muted small">QCM</span>${seg('qcmMode', [['single', 'Une bonne réponse'], ['multi', 'Plusieurs'], ['both', 'Les deux']])}</div>` : ''}
            ${o.types.includes('vf') ? toggle('vfJustify', 'Justifier les vrai/faux', 'La justification est corrigée par l’IA (40 % des points).') : ''}
          </fieldset>
          <fieldset><legend>Difficulté</legend>
            <div class="opt-grid four">${Object.entries(DIFFS).map(([k, l]) => opt('set', 'difficulty', k, o.difficulty === k, l, DIFF_TEXT[k])).join('')}</div>
            <div class="sub-opt"><span class="muted small">Orientation</span>${seg('focus', [['connaissances', 'Connaissances'], ['equilibre', 'Équilibré'], ['raisonnement', 'Raisonnement']])}</div>
          </fieldset>
          <fieldset><legend>Cartes interrogées</legend>
            ${seg('only', [['all', `Toutes (${all.length})`], ['weak', `Pas encore maîtrisées (${weak.length})`]])}
          </fieldset>
          <fieldset><legend>Nombre de questions : <strong id="count-val">${o.count}</strong></legend>
            <input type="range" min="3" max="${maxQ}" value="${o.count}" data-k="count" aria-label="Nombre de questions">
          </fieldset>
          <fieldset><legend>Déroulement</legend>
            ${seg('mode', [['exam', 'Examen'], ['training', 'Entraînement']])}
            <p class="muted small">${o.mode === 'exam' ? 'Ni indice ni correction avant la remise de la copie.' : 'Indices disponibles, correction question par question ou à la fin.'}</p>
            ${o.mode === 'training' ? `<div class="sub-opt"><span class="muted small">Correction</span>${seg('correction', [['immediate', 'Après chaque question'], ['end', 'À la fin']])}</div>` : ''}
            ${toggle('timed', 'Chronométré', o.mode === 'exam' ? 'La copie est remise automatiquement à la fin du temps.' : 'Le temps est indicatif en entraînement.')}
            ${o.timed ? `<label class="range-row"><span class="muted small">Durée : <strong id="duration-val">${o.duration} min</strong></span><input type="range" min="5" max="180" step="5" value="${o.duration}" data-k="duration" aria-label="Durée en minutes"></label>` : ''}
            ${toggle('random', 'Ordre aléatoire des questions', o.random ? '' : 'Sinon, par format : des QCM au cas pratique.')}
            <div class="sub-opt"><span class="muted small">Barème</span>${seg('scale', [['weighted', 'Pondéré'], ['uniform', 'Uniforme']])}</div>
            <p class="muted small">${o.scale === 'weighted' ? 'QCM et vrai/faux 1 point, association 2, question ouverte 3, réflexion 4, cas pratique 6, ramené sur 20.' : 'Chaque question vaut autant, ramené sur 20.'}</p>
            ${toggle('external', 'Autoriser les connaissances extérieures', 'Sinon, l’IA ne demande rien qui ne soit pas dans tes cartes.')}
          </fieldset>
        </div>
        <aside class="panel exam-recap">
          <h2>Ton examen</h2>
          <dl>
            <dt>Cartes</dt><dd>${n}${o.only === 'weak' && weak.length ? ' pas maîtrisées' : ''}</dd>
            <dt>Questions</dt><dd>${o.count}</dd>
            <dt>Formats</dt><dd>${o.types.map(typeLabel).join(', ') || '—'}</dd>
            <dt>Difficulté</dt><dd>${DIFFS[o.difficulty]}</dd>
            <dt>Mode</dt><dd>${o.mode === 'exam' ? 'Examen' : `Entraînement, correction ${o.correction === 'immediate' ? 'immédiate' : 'à la fin'}`}</dd>
            <dt>Durée</dt><dd>${o.timed ? `${o.duration} min` : 'Libre'}</dd>
            <dt>Barème</dt><dd>${o.scale === 'weighted' ? 'Pondéré' : 'Uniforme'}, sur 20</dd>
          </dl>
          <p class="form-error" role="alert">${o.types.length ? '' : 'Choisis au moins un type de question.'}</p>
          <button class="btn primary lg" data-action="go" ${o.types.length ? '' : 'disabled'}>${icon('sparkle')}Générer l’examen</button>
          <p class="muted small">L’IA rédige les questions à partir de tes cartes. Compte 10 à 30 secondes par tranche de 6 questions.</p>
        </aside>
      </div>`, {
      wide: true,
      click: {
        set: el => { o[el.dataset.k] = el.dataset.v; o.preset = null; draw(); },
        type: el => { const k = el.dataset.k; o.types = o.types.includes(k) ? o.types.filter(t => t !== k) : [...o.types, k]; o.preset = null; draw(); },
        preset: el => { Object.assign(o, DEFAULTS, PRESETS[el.dataset.k][2](), { preset: el.dataset.k }); draw(); },
        go: () => { store.set(CFG, JSON.stringify(o)); generate(d, fav, { ...o }); },
        resume: () => show(d),
        abandon: () => {
          if (!confirm('Abandonner cet examen ? Les questions et tes réponses seront perdues.')) return;
          forget(d.id);
          draft = null;
          setup(d, fav);
        },
      },
      input: e => {
        const k = e.target.dataset.k;
        if (e.target.type !== 'range') return;
        o[k] = +e.target.value;
        const out = app.querySelector(`#${k}-val`);
        if (out) out.textContent = k === 'duration' ? `${o[k]} min` : o[k];
      },
      change: e => {
        const k = e.target.dataset.k;
        if (!k) return;
        o[k] = e.target.type === 'checkbox' ? e.target.checked : +e.target.value;
        o.preset = null;
        draw();
      },
    });
  }
  draw();
}

// ---------- generation: 6 questions per AI request, 3 requests at the same time
async function generate(d, fav, o) {
  const all = playable(d, fav);
  const weak = all.filter(c => !c.srs || c.srs.interval < MASTERED_DAYS);
  const pool = shuffle(o.only === 'weak' && weak.length ? weak : all);
  const slots = examSlots(pool, o);
  const batches = [];
  for (let i = 0; i < slots.length; i += 6) batches.push(slots.slice(i, i + 6));
  gen = { deckId: d.id, fav, o, total: slots.length, questions: [], errors: [], stop: false, done: false };
  const g = gen;
  generating(d);
  const one = async bs => {
    const ids = [...new Set(bs.flatMap(s => s.cards))];
    const k = id => ids.indexOf(id) + 1;
    try {
      const raw = await retry(() => examQuestions({
        cards: ids.map(id => pool.find(c => c.id === id)).map(c => ({ k: k(c.id), term: c.term, def: c.def })),
        slots: bs.map(s => ({ ...s, cards: s.cards.map(k) })),
        focus: o.focus,
        external: o.external,
      }));
      bs.forEach((s, i) => {
        const q = cleanQuestion(raw.find(r => Number(r?.slot) === i + 1) || raw[i], s, o.scale === 'uniform');
        if (q) g.questions.push(q); else g.errors.push('Une question mal formée a été écartée.');
      });
    } catch (err) {
      g.errors.push(err.message);
      if (/limite|Connecte/i.test(err.message)) g.stop = true;
    }
    if (gen === g && here(d) && !g.done) generating(d);
  };
  // shortcut: 3 parallel requests fits Gemini's and Groq's per-minute free limits for one user; lower it if many people generate at once.
  const queue = batches.slice();
  await Promise.all([0, 1, 2].map(async () => { while (queue.length && !g.stop) await one(queue.shift()); }));
  g.done = true;
  if (gen !== g) return;
  if (g.questions.length === g.total) start(d, g.fav, g.o, g.questions);
  else if (here(d)) generating(d);
}

function generating(d) {
  const g = gen, pct = Math.round((g.questions.length / g.total) * 100);
  const head0 = `${backTo(d)}<div class="study-head"><h1 class="mode-title">Test</h1></div>`;
  if (!g.done) {
    return mount(`${head0}<section class="panel exam-wait">
      <div class="wait-top"><span class="spinner" aria-hidden="true"></span><strong>L’IA rédige ton examen à partir de tes cartes…</strong></div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${g.total}" aria-valuenow="${g.questions.length}"><span style="width:${pct}%"></span></div>
      <p class="muted small">${g.questions.length} / ${g.total} questions prêtes</p>
      ${g.errors.length ? `<p class="small warn-text">${esc(g.errors.at(-1))}</p>` : ''}
      <div class="actions"><button class="btn" data-action="stop">Arrêter</button></div>
    </section>`, { click: { stop: () => { g.stop = true; toast('Arrêt après les questions en cours…'); } } });
  }
  mount(`${head0}<section class="panel exam-wait">
    <h2>${g.questions.length ? 'Examen incomplet' : 'L’examen n’a pas pu être créé'}</h2>
    <p>${g.questions.length ? `${plural(g.questions.length, 'question')} sur ${g.total} ont pu être rédigées.` : 'Aucune question n’a pu être rédigée.'}</p>
    ${g.errors.length ? `<ul class="muted small">${[...new Set(g.errors)].map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    <div class="actions">
      ${g.questions.length ? `<button class="btn primary" data-action="partial">Commencer avec ${plural(g.questions.length, 'question')}</button>` : ''}
      <button class="btn" data-action="retry">${icon('restore')}Réessayer</button>
      <button class="btn ghost" data-action="back">Revenir aux réglages</button>
    </div></section>`, {
    click: {
      partial: () => start(d, g.fav, g.o, g.questions),
      retry: () => generate(d, g.fav, g.o),
      back: () => { gen = null; setup(d, g.fav); },
    },
  });
}

function start(d, fav, o, questions) {
  gen = null;
  const order = Object.keys(EXAM_TYPES);
  draft = {
    deckId: d.id, fav: !!fav, config: o,
    questions: o.random ? shuffle(questions) : questions.slice().sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)),
    answers: {}, marked: {}, checked: {}, hints: {}, cur: 0, phase: 'instructions', elapsed: 0, applied: [],
  };
  save();
  if (here(d)) show(d);
}

function show(d) {
  if (!draft) return setup(d);
  if (draft.phase === 'instructions') return instructions(d);
  if (draft.phase === 'taking') return taking(d);
  if (draft.phase === 'correcting') return correct(d);
  results(d);
}

// ---------- instructions
function instructions(d) {
  const c = draft.config, qs = draft.questions, tot = total(qs);
  const byType = Object.entries(qs.reduce((m, q) => ({ ...m, [q.type]: (m[q.type] || 0) + 1 }), {}));
  mount(`${head(d)}<div class="exam-intro">
    <section class="panel">
      <p class="eyebrow">Consignes</p>
      <h2>${plural(qs.length, 'question')}, note sur 20</h2>
      <ul class="rules">
        <li>${byType.map(([t, n]) => `${typeLabel(t)} : ${n}`).join(' · ')}</li>
        <li>${c.timed ? `Durée : <strong>${c.duration} minutes</strong>.${c.mode === 'exam' ? ' La copie est remise automatiquement à la fin du temps.' : ''} Le chronomètre s’arrête si tu quittes l’examen.` : 'Pas de limite de temps.'}</li>
        <li>${c.mode === 'exam' ? 'Mode examen : ni indice ni correction avant la remise. Une fois remise, ta copie ne peut plus être modifiée.' : `Mode entraînement : indices disponibles, correction ${c.correction === 'immediate' ? 'question par question' : 'à la fin'}.`}</li>
        <li>Navigue librement entre les questions, marque celles où tu veux revenir et modifie tes réponses jusqu’à la remise.</li>
        <li>Les QCM, vrai/faux et associations sont corrigés tout de suite. Tes réponses rédigées sont corrigées par l’IA en une seule fois, critère par critère ; une formulation différente de la tienne est acceptée si elle est juste.</li>
        <li>Ta progression : chaque carte dont toutes les questions sont réussies est validée comme maîtrisée, les autres repassent en cours d’apprentissage.</li>
      </ul>
      <div class="actions"><button class="btn primary lg" data-action="begin">${icon('next')}Commencer${c.timed ? ' le chronomètre' : ''}</button><button class="btn ghost" data-action="abandon">Annuler cet examen</button></div>
    </section>
    <aside class="panel">
      <h2>Barème</h2>
      <ol class="bareme">${qs.map(q => `<li><span>${typeLabel(q.type)}</span><strong>${fmt((q.points / tot) * 20)} pt${(q.points / tot) * 20 >= 2 ? 's' : ''}</strong></li>`).join('')}</ol>
    </aside></div>`, {
    wide: true,
    click: {
      begin: () => { draft.phase = 'taking'; save(); taking(d); },
      abandon: () => { if (!confirm('Annuler cet examen ? Les questions seront perdues.')) return; forget(d.id); const fav = draft.fav; draft = null; setup(d, fav); },
    },
  });
}

// ---------- the copy
function answerArea(q, a, locked) {
  const dis = locked ? 'disabled' : '';
  if (q.type === 'qcm') {
    const sel = Array.isArray(a) ? a : [];
    return `<p class="muted small">${q.multiple ? 'Plusieurs bonnes réponses possibles.' : 'Une seule bonne réponse.'}</p>
      <div class="opts">${q.options.map((o, i) => `<button type="button" class="opt" data-action="pick" data-i="${i}" aria-pressed="${sel.includes(i)}" ${dis}><span class="k">${String.fromCharCode(65 + i)}</span><span>${esc(o)}</span></button>`).join('')}</div>`;
  }
  if (q.type === 'vf') {
    return `<div class="opts two">${[[true, 'Vrai'], [false, 'Faux']].map(([v, l]) => `<button type="button" class="opt" data-action="vf" data-v="${v ? 1 : 0}" aria-pressed="${a?.v === v}" ${dis}>${l}</button>`).join('')}</div>
      ${q.justify ? `<label class="field-label" for="ans-j">Justifie ta réponse</label><textarea id="ans-j" data-field="j" rows="4" ${dis}>${esc(a?.j || '')}</textarea>` : ''}`;
  }
  if (q.type === 'association') {
    return `<p class="muted small">Associe chaque notion à la bonne proposition.</p><div class="assoc">${q.pairs.map((p, i) => `<div class="assoc-row"><strong>${esc(p.left)}</strong>
      <select data-i="${i}" ${dis} aria-label="Proposition pour ${esc(p.left)}"><option value="">Choisir…</option>${q.rightOrder.map(j => `<option value="${j}" ${String(a?.[i]) === String(j) ? 'selected' : ''}>${esc(q.pairs[j].right)}</option>`).join('')}</select></div>`).join('')}</div>`;
  }
  const ph = q.type === 'cas' ? 'Faits et qualification, problème, règle applicable, application aux faits, conclusion…' : q.type === 'reflexion' ? 'Explique, compare, argumente…' : 'Rédige ta réponse…';
  const words = String(a || '').trim() ? String(a).trim().split(/\s+/).length : 0;
  return `<label class="sr" for="ans">Ta réponse</label><textarea id="ans" data-field="t" rows="${q.type === 'cas' ? 12 : q.type === 'reflexion' ? 9 : 6}" placeholder="${ph}" ${dis}>${esc(a || '')}</textarea>
    <p class="muted small" id="wc">${plural(words, 'mot')}</p>`;
}

function taking(d) {
  const dr = draft, qs = dr.questions, n = qs.length, q = qs[dr.cur], c = dr.config, tot = total(qs);
  const train = c.mode === 'training', chk = dr.checked[q.id], a = dr.answers[q.id];
  const done = qs.filter(x => answered(x, dr.answers[x.id])).length;
  const marked = qs.filter(x => dr.marked[x.id]).length;
  const navClass = (x, i) => [dr.checked[x.id] ? `v-${dr.checked[x.id].verdict}` : answered(x, dr.answers[x.id]) ? 'ans' : '', i === dr.cur ? 'cur' : '', dr.marked[x.id] ? 'mk' : ''].join(' ');
  const pts = (q.points / tot) * 20;
  mount(`<div class="ex-top">
      <div>${backTo(d)}<p class="muted small">${train ? 'Entraînement' : 'Examen'} · ${plural(n, 'question')}</p></div>
      <span class="timer" id="timer" ${c.timed ? '' : 'title="Temps écoulé"'}></span>
      <button class="btn ghost" data-action="quit">Quitter</button>
    </div>
    <div class="progress thin" aria-hidden="true"><span id="bar" style="width:${(done / n) * 100}%"></span></div>
    <div class="exam">
      <section class="qcard">
        <div class="qhead"><span class="qnum">Question ${dr.cur + 1} / ${n}</span><span class="tag accent">${typeLabel(q.type)}</span><span class="tag">${DIFFS[q.difficulty] || ''}</span><span class="tag">${fmt(pts)} pt${pts >= 2 ? 's' : ''}</span>
          ${canSpeak ? `<button class="btn ghost small-btn" data-action="listen">${icon('speak')}Écouter</button>` : ''}</div>
        <div class="qtext">${q.type === 'vf' ? '<span class="muted">Vrai ou faux ?</span> ' : ''}${esc(q.prompt)}</div>
        ${answerArea(q, a, !!chk)}
        ${train && dr.hints[q.id] && q.hint ? `<p class="ai-note">${icon('sparkle')}<span><strong>Indice :</strong> ${esc(q.hint)}</span></p>` : ''}
        ${chk ? `<div class="corr-inline v-${chk.verdict}">${verdictLine(chk, q, tot)}${corrBody(q, a, chk, false)}</div>` : ''}
        <div class="qfoot">
          <button class="btn" data-action="go" data-i="${dr.cur - 1}" ${dr.cur ? '' : 'disabled'}>${icon('back')}Précédente</button>
          <button class="btn ghost" data-action="mark" aria-pressed="${!!dr.marked[q.id]}">${icon('flag')}${dr.marked[q.id] ? 'Marquée' : 'Marquer'}</button>
          ${train && q.hint && !dr.hints[q.id] && !chk ? `<button class="btn ghost" data-action="hint">${icon('sparkle')}Indice</button>` : ''}
          ${train && c.correction === 'immediate' && !chk ? `<button class="btn" data-action="check" id="check" ${answered(q, a) && !busy ? '' : 'disabled'}>${busy ? 'Correction…' : `${icon('check')}Valider et corriger`}</button>` : ''}
          <span class="spacer"></span>
          ${dr.cur < n - 1 ? `<button class="btn primary" data-action="go" data-i="${dr.cur + 1}">Suivante${icon('next')}</button>` : '<button class="btn primary" data-action="submit">Remettre ma copie</button>'}
        </div>
      </section>
      <aside class="panel qside">
        <h3>Questions</h3>
        <div class="qnav">${qs.map((x, i) => `<button type="button" class="${navClass(x, i)}" data-action="go" data-i="${i}" aria-label="Question ${i + 1}${dr.marked[x.id] ? ', marquée' : ''}">${i + 1}</button>`).join('')}</div>
        <p class="qlegend muted small"><span><i class="l-ans"></i>Répondues <b id="n-done">${done}</b></span><span><i></i>Sans réponse <b id="n-left">${n - done}</b></span><span><i class="l-mk"></i>Marquées ${marked}</span></p>
        <button class="btn primary wide" data-action="submit">Remettre ma copie</button>
        <p class="muted small">Tes réponses sont enregistrées au fur et à mesure.</p>
      </aside>
    </div>`, {
    wide: true,
    cleanup: pause,
    click: {
      go: el => { const i = +el.dataset.i; if (i < 0 || i >= n) return; window.speechSynthesis?.cancel(); dr.cur = i; save(); taking(d); scrollTo({ top: 0, behavior: 'smooth' }); },
      mark: () => { dr.marked[q.id] = !dr.marked[q.id]; save(); taking(d); },
      hint: () => { dr.hints[q.id] = true; save(); taking(d); },
      pick: el => {
        const i = +el.dataset.i;
        let sel = Array.isArray(a) ? a.slice() : [];
        sel = q.multiple ? (sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i].sort()) : [i];
        dr.answers[q.id] = sel; save(); taking(d);
      },
      vf: el => { dr.answers[q.id] = { ...(a || {}), v: el.dataset.v === '1' }; save(); taking(d); },
      listen: () => speak(`${q.type === 'vf' ? 'Vrai ou faux ? ' : ''}${q.prompt}${q.type === 'qcm' ? `. ${q.options.map((o, i) => `Réponse ${String.fromCharCode(65 + i)} : ${o}`).join('. ')}` : ''}`, langOf(d, 'def')),
      check: () => checkNow(d, q),
      submit: () => submit(d, false),
      quit: () => { location.hash = `deck/${d.id}`; },
    },
    input: e => {
      const f = e.target.dataset.field;
      if (!f) return;
      dr.answers[q.id] = f === 'j' ? { ...(dr.answers[q.id] || {}), j: e.target.value } : e.target.value;
      save();
      const wc = app.querySelector('#wc');
      if (wc) { const w = e.target.value.trim() ? e.target.value.trim().split(/\s+/).length : 0; wc.textContent = plural(w, 'mot'); }
      refreshNav();
    },
    change: e => {
      if (e.target.tagName !== 'SELECT') return;
      dr.answers[q.id] = { ...(dr.answers[q.id] || {}), [e.target.dataset.i]: e.target.value === '' ? '' : +e.target.value };
      save();
      refreshNav();
    },
    key: e => {
      if (e.key === 'ArrowRight' && dr.cur < n - 1) app.querySelector(`.qnav [data-i="${dr.cur + 1}"]`)?.click();
      if (e.key === 'ArrowLeft' && dr.cur > 0) app.querySelector(`.qnav [data-i="${dr.cur - 1}"]`)?.click();
    },
  });
  // Typing does not redraw the page: only the counters follow.
  function refreshNav() {
    const k = qs.filter(x => answered(x, dr.answers[x.id])).length;
    app.querySelector('#bar').style.width = `${(k / n) * 100}%`;
    app.querySelector('#n-done').textContent = k;
    app.querySelector('#n-left').textContent = n - k;
    app.querySelector(`.qnav [data-i="${dr.cur}"]`)?.classList.toggle('ans', answered(q, dr.answers[q.id]));
    const cb = app.querySelector('#check');
    if (cb && !busy) cb.disabled = !answered(q, dr.answers[q.id]);
  }
  resumeAt = Date.now();
  const el = app.querySelector('#timer');
  const update = () => {
    if (!el.isConnected || draft !== dr) return clearInterval(tick);
    if (!c.timed) { el.textContent = clock(elapsed()); return; }
    const left = c.duration * 60 - elapsed();
    el.classList.toggle('low', left <= 60);
    if (left > 0) el.textContent = clock(left);
    else if (c.mode === 'exam') { clearInterval(tick); toast('Temps écoulé : ta copie est remise.'); submit(d, true); }
    else el.textContent = `+${clock(-left)}`;
  };
  update();
  tick = setInterval(update, 1000);
}

// Training with correction after each question: one AI request for that answer only.
async function checkNow(d, q) {
  const dr = draft, a = dr.answers[q.id];
  if (!answered(q, a) || busy) return;
  let r = gradeAuto(q, a);
  if (!r) {
    busy = true;
    taking(d);
    try {
      const [x] = await correctExam([aiItem(d, q, a)]);
      r = x ? fromAi(q, x) : null;
    } catch (err) { toast(err.message); }
    busy = false;
  }
  if (r) { dr.checked[q.id] = r; save(dr); }
  if (draft === dr && here(d) && dr.phase === 'taking') taking(d);
}

function submit(d, auto) {
  const dr = draft;
  if (!auto) {
    const left = dr.questions.filter(q => !answered(q, dr.answers[q.id])).length;
    const mk = dr.questions.filter(q => dr.marked[q.id]).length;
    if (!confirm(`${left ? `${plural(left, 'question')} sans réponse. ` : 'Toutes les questions ont une réponse. '}${mk ? `${plural(mk, 'question marquée')} pour y revenir. ` : ''}Une fois remise, ta copie ne peut plus être modifiée.\n\nRemettre ta copie ?`)) return;
  }
  pause();
  dr.phase = 'correcting';
  save(dr);
  correct(d);
}

// ---------- correction
const cardsOf = (d, q) => q.cards.map(id => d.cards.find(c => c.id === id)).filter(Boolean).map(c => ({ term: c.term, def: c.def }));
const aiItem = (d, q, a) => ({
  id: q.id, type: q.type, question: q.prompt, criteria: examCriteria(q), cards: cardsOf(d, q),
  expected: q.type === 'vf' ? `${q.answer ? 'Vrai' : 'Faux'}. ${q.explanation}` : q.expected,
  answer: q.type === 'vf' ? `${a.v ? 'Vrai' : 'Faux'} (bonne réponse). Justification : ${a.j}` : String(a),
});

async function correct(d) {
  const dr = draft;
  const pre = { ...dr.checked, ...(dr.results || {}) };
  const res = {}, todo = [];
  for (const q of dr.questions) {
    if (pre[q.id] && pre[q.id].verdict !== 'na') { res[q.id] = pre[q.id]; continue; }
    const r = gradeAuto(q, dr.answers[q.id]);
    if (r) res[q.id] = r; else todo.push(q);
  }
  if (todo.length) {
    if (here(d)) mount(`${head(d)}<section class="panel exam-wait"><div class="wait-top"><span class="spinner" aria-hidden="true"></span><strong>Correction de ta copie…</strong></div>
      <p class="muted">Les QCM, vrai/faux et associations sont déjà corrigés. L’IA corrige maintenant ${todo.length > 1 ? `tes ${todo.length} réponses rédigées` : 'ta réponse rédigée'} en une seule fois, critère par critère.</p></section>`);
    try {
      const out = await retry(() => correctExam(todo.map(q => aiItem(d, q, dr.answers[q.id]))));
      todo.forEach((q, i) => { const x = out.find(r => r?.id === q.id) || out[i]; res[q.id] = x ? fromAi(q, x) : naResult(q, 'L’IA n’a pas renvoyé cette correction.'); });
    } catch (err) {
      for (const q of todo) res[q.id] = naResult(q, err.message);
    }
  }
  dr.results = res;
  dr.phase = 'done';
  progress(d, dr);
  save(dr);
  const sc = scoreOf(dr.questions, res);
  if (sc.na) toast(`${sc.na > 1 ? `${sc.na} réponses n’ont pas pu être corrigées` : 'Une réponse n’a pas pu être corrigée'} : relance la correction.`);
  if (draft === dr && here(d)) results(d);
}

// Cards whose questions are all right become learned; the others go back to learning.
// Each card is counted once per copy, as soon as all its questions are corrected.
function progress(d, dr) {
  const byCard = {};
  for (const q of dr.questions) for (const id of q.cards) (byCard[id] ||= []).push(dr.results[q.id]);
  const now = Date.now();
  dr.learned ||= 0;
  dr.relearn ||= 0;
  for (const [id, rs] of Object.entries(byCard)) {
    if (dr.applied.includes(id) || rs.some(r => !r || r.verdict === 'na')) continue;
    const c = d.cards.find(x => x.id === id && !x.gone);
    if (!c) continue;
    const ok = rs.every(r => r.verdict === 'ok');
    c.srs = ok ? masterSrs(c.srs, now, MASTERED_DAYS) : review(c.srs, 0, now);
    if (ok) dr.learned++; else dr.relearn++;
    touchCard(d, c);
    dr.applied.push(id);
  }
  if (!dr.logged) { logStudy(dr.questions.length); dr.logged = true; }
}

const none = '<span class="muted">Aucune réponse</span>';
function answerText(q, a) {
  if (!answered(q, a)) return none;
  if (q.type === 'qcm') return a.map(i => esc(`${String.fromCharCode(65 + i)}. ${q.options[i]}`)).join('<br>');
  if (q.type === 'vf') return `${a.v ? 'Vrai' : 'Faux'}${a.j ? `<br>Justification : ${esc(a.j)}` : ''}`;
  if (q.type === 'association') return q.pairs.map((p, i) => `${esc(p.left)} → ${a[i] === '' || a[i] == null ? '—' : esc(q.pairs[a[i]].right)}`).join('<br>');
  return esc(a);
}
const VERDICT = { ok: 'Réussie', pa: 'Partielle', ko: 'Ratée', na: 'Non corrigée' };
const verdictLine = (r, q, tot) => `<p class="verdict"><span class="tag v-${r.verdict}">${VERDICT[r.verdict]}</span><strong>${fmt((r.earned / tot) * 20)} / ${fmt((q.points / tot) * 20)} pt</strong></p>`;
const bullets = (title, xs, cls) => (xs?.length ? `<div class="c-list ${cls}"><h4>${title}</h4><ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
function corrBody(q, a, r, withAnswer = true) {
  const tot = total(draft.questions);
  return `${withAnswer ? `<div class="corr-grid"><div><h4>Ta réponse</h4><p class="pre">${answerText(q, a)}</p></div><div><h4>Réponse attendue</h4><p class="pre">${esc(r.expected || q.expected || '')}</p></div></div>`
    : `<div class="corr-grid one"><div><h4>Réponse attendue</h4><p class="pre">${esc(r.expected || q.expected || '')}</p></div></div>`}
    ${r.criteria?.length ? `<table class="crit"><tbody>${r.criteria.map(c => `<tr><td>${esc(c.label)}${c.comment ? `<span class="muted small">${esc(c.comment)}</span>` : ''}</td><td class="num">${fmt((c.awarded / tot) * 20)} / ${fmt((c.max / tot) * 20)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${bullets('Points forts', r.strengths, 'good')}${bullets('Erreurs', r.errors, 'bad')}${bullets('Il manquait', r.missing, 'miss')}
    ${r.explanation || q.explanation ? `<p class="ai-note">${icon('sparkle')}<span>${esc(r.explanation || q.explanation)}</span></p>` : ''}
    ${r.confidence === 'faible' ? '<p class="muted small">L’IA n’est pas sûre de cette correction : vérifie avec ton cours.</p>' : ''}
    ${r.error ? `<p class="small warn-text">Pas encore corrigée : ${esc(r.error)}</p>` : ''}`;
}

function results(d) {
  const dr = draft, qs = dr.questions, res = dr.results, tot = total(qs);
  const sc = scoreOf(qs, res);
  const count = v => qs.filter(q => res[q.id]?.verdict === v).length;
  const failed = qs.filter(q => res[q.id]?.verdict !== 'ok');
  mount(`${head(d)}
    <section class="result-hero">
      <div class="note"><strong>${fmt(sc.score20)}</strong><span>/ 20</span></div>
      <div class="rh-text">
        <p class="eyebrow">${sc.na ? 'Note provisoire' : 'Résultat'}</p>
        <h2>${levelOf(sc.score20)}</h2>
        <p class="muted">${sc.max ? Math.round((sc.earned / sc.max) * 100) : 0} % des points · en ${duration(dr.elapsed)} · ${count('ok')} réussie${count('ok') > 1 ? 's' : ''}, ${count('pa')} partielle${count('pa') > 1 ? 's' : ''}, ${count('ko')} ratée${count('ko') > 1 ? 's' : ''}</p>
        <p class="small">${icon('cards')}${dr.learned ? `${plural(dr.learned, 'carte')} validée${dr.learned > 1 ? 's' : ''} comme maîtrisée${dr.learned > 1 ? 's' : ''}` : 'Aucune carte validée'}${dr.relearn ? `, ${plural(dr.relearn, 'carte')} repassée${dr.relearn > 1 ? 's' : ''} en cours d’apprentissage` : ''}.</p>
      </div>
    </section>
    ${sc.na ? `<div class="exam-notice warn"><span>${sc.na > 1 ? `${sc.na} réponses n’ont pas pu être corrigées` : 'Une réponse n’a pas pu être corrigée'} : la note ne compte que les questions corrigées.</span><span class="actions"><button class="btn primary" data-action="recorrect">${icon('restore')}Relancer la correction</button></span></div>` : ''}
    <div class="actions">
      ${failed.length ? `<button class="btn primary" data-action="redo">Refaire les questions ratées (${failed.length})</button>` : ''}
      <button class="btn" data-action="fresh">${icon('sparkle')}Nouvel examen</button>
      <a class="btn ghost" href="#learn/${d.id}${dr.fav ? '/fav' : ''}">Retravailler avec Apprendre</a>
    </div>
    <h2>Correction détaillée</h2>
    <div class="corr-list">${qs.map((q, i) => {
      const r = res[q.id] || naResult(q, '');
      return `<details class="corr v-${r.verdict}" ${r.verdict === 'ok' ? '' : 'open'}>
        <summary><span class="num">${i + 1}</span><span class="corr-title">${esc(q.prompt.length > 110 ? `${q.prompt.slice(0, 110)}…` : q.prompt)}</span><span class="tag">${typeLabel(q.type)}</span><span class="tag v-${r.verdict}">${fmt((r.earned / tot) * 20)} / ${fmt((q.points / tot) * 20)}</span></summary>
        <div class="corr-body"><p class="qtext">${q.type === 'vf' ? '<span class="muted">Vrai ou faux ?</span> ' : ''}${esc(q.prompt)}</p>${corrBody(q, dr.answers[q.id], r)}</div>
      </details>`;
    }).join('')}</div>`, {
    wide: true,
    click: {
      recorrect: () => { dr.phase = 'correcting'; save(dr); correct(d); },
      redo: () => start(d, dr.fav, dr.config, failed.map(q => ({ ...q }))),
      fresh: () => { forget(d.id); const fav = dr.fav; draft = null; setup(d, fav); scrollTo(0, 0); },
    },
  });
}
