// AI features. The model is called by the Supabase Edge Function "ai" (supabase/functions/ai),
// which holds the API key and enforces a daily quota per account.
import { uid, cleanDeck, normalize } from './logic.js?v=18';
import { state, views, mount, app, esc, plural, icon, toast, touch, backHome, backTo, loadScript, playable, renderMath, store } from './core.js?v=18';
import { reportError } from './sync.js?v=18';

async function callAi(body) {
  if (!state.sb || !state.user) throw new Error('Connecte-toi pour utiliser l’IA.');
  const { data, error } = await state.sb.functions.invoke('ai', { body });
  if (error) {
    let msg = 'L’IA ne répond pas pour le moment. Réessaie dans un instant.';
    try { msg = (await error.context.json()).error || msg; } catch { /* keep the generic message */ }
    reportError(`IA (${body.mode}) : ${msg}`);
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Starts the AI function before the first answer, so that answer does not wait for it to boot.
let warmedAt = 0;
export function warmUp() {
  if (!state.sb || !state.user || Date.now() - warmedAt < 120_000) return;
  warmedAt = Date.now();
  state.sb.functions.invoke('ai', { body: { mode: 'ping' } }).catch(() => {});
}

// Asks the AI whether written answers are right in substance. items: [{ term, def, side, given }].
export async function gradeAnswers(items) {
  const { results } = await callAi({ mode: 'grade', items });
  return Array.isArray(results) ? results : [];
}

// Exam: writes the questions of up to 12 slots (cards: [{ k, term, def }]).
export async function examQuestions(payload) {
  const { questions } = await callAi({ mode: 'exam', ...payload });
  return Array.isArray(questions) ? questions : [];
}
// Exam: corrects every written answer of a copy in one request.
export async function correctExam(items) {
  const { results } = await callAi({ mode: 'correct', items });
  return Array.isArray(results) ? results : [];
}

// Explanations already given are kept on this device: asking again is instant and free.
// The key covers the card's text, so editing the card asks the AI again.
const EXPL = 'recto.explanations';
const hash = s => [...s].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(36);
export async function explain(card, given, answerSide) {
  const key = hash(`${card.term}|${card.def}|${answerSide}|${normalize(given || '')}`);
  let saved = {};
  try { saved = JSON.parse(store.get(EXPL)) || {}; } catch { /* start empty */ }
  if (saved[key]) return saved[key];
  const { text } = await callAi({ mode: 'explain', term: card.term, def: card.def, given: given || '', side: answerSide });
  if (text) {
    saved[key] = text;
    const keys = Object.keys(saved);
    for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete saved[k]; // keep the 300 most recent
    store.set(EXPL, JSON.stringify(saved));
  }
  return text;
}

// Writes three plausible wrong definitions per card, used first by the QCM.
export async function improveQcm(d) {
  const cards = playable(d).filter(c => !c.alt).slice(0, 40);
  if (!cards.length) return toast('Les QCM de ce set sont déjà améliorés.');
  toast(`L’IA prépare des propositions pour ${plural(cards.length, 'carte')}…`);
  try {
    const { items } = await callAi({ mode: 'distractors', cards: cards.map(c => ({ id: c.id, term: c.term, def: c.def })) });
    let n = 0;
    for (const it of items || []) {
      const c = d.cards.find(x => x.id === it.id);
      if (!c || !Array.isArray(it.alts)) continue;
      c.alt = it.alts.filter(a => typeof a === 'string' && a.trim()).slice(0, 3);
      c.u = Date.now();
      n++;
    }
    touch(d);
    toast(`QCM améliorés pour ${plural(n, 'carte')}.`);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- generate cards from notes
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
async function pdfText(file) {
  await loadScript(`${PDFJS}/pdf.min.js`);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    pages.push(content.items.map(x => x.str).join(' '));
  }
  return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim();
}
async function imageData(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

const MAX_TEXT = 20000;
views.ai = function aiView(target) {
  const back = target ? backTo(target) : backHome;
  let source = 'text', text = '', image = null, imageUrl = '', results = null, busy = false, error = '', title = '';
  if (!state.sb || !state.user) {
    return mount(`${back}<section class="panel"><h1>Générer des cartes avec l’IA</h1><p class="muted">Connecte-toi pour utiliser l’IA : le service tourne sur le serveur de Recto, avec une limite quotidienne par compte.</p>
      <div class="actions"><a class="btn primary" href="#account">Se connecter</a></div></section>`);
  }
  const draw = () => {
    mount(`${back}
      <header class="page-head"><p class="eyebrow">${icon('sparkle')} Générer avec l’IA</p><h1>Crée des cartes à partir de ton cours</h1>
        <p class="muted">Colle un texte, importe un PDF ou une photo de tes notes. Tu relis et corriges les cartes avant de les ajouter${target ? ` à « ${esc(target.title)} »` : ''}.</p></header>
      ${results ? resultsHTML() : `<form class="panel ai-form" id="ai-form" novalidate>
        <div class="tabs three" role="tablist">
          ${[['text', 'Texte'], ['pdf', 'PDF'], ['photo', 'Photo']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${source === k}" data-action="src" data-s="${k}">${l}</button>`).join('')}
        </div>
        ${source === 'text' ? `<label for="ai-text">Ton cours ou tes notes</label><textarea id="ai-text" rows="10" maxlength="${MAX_TEXT}" placeholder="Colle ici un chapitre, un résumé, une liste de vocabulaire…">${esc(text)}</textarea><p class="muted small"><span id="count">${text.length}</span> / ${MAX_TEXT} caractères</p>` : ''}
        ${source === 'pdf' ? `<label class="drop" for="ai-pdf">${icon('file')}<span>${text ? `Texte extrait : ${text.length} caractères. Choisir un autre PDF` : 'Choisir un fichier PDF (40 pages au plus)'}</span></label><input type="file" id="ai-pdf" accept="application/pdf,.pdf" hidden>` : ''}
        ${source === 'photo' ? `<label class="drop" for="ai-photo">${imageUrl ? `<img src="${imageUrl}" alt="Aperçu de la photo">` : icon('image')}<span>${imageUrl ? 'Choisir une autre photo' : 'Prendre ou choisir une photo de tes notes'}</span></label><input type="file" id="ai-photo" accept="image/*" hidden>` : ''}
        <div class="field-row">
          <label class="field"><span class="field-label">Nombre de cartes</span><select id="ai-count">${[10, 20, 30, 40].map(n => `<option${n === 20 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <p class="form-error" role="alert">${esc(error)}</p>
        <button class="btn primary lg" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Génération en cours…' : `${icon('sparkle')}Générer les cartes`}</button>
        <p class="muted small">L’IA peut se tromper : relis toujours les cartes. N’envoie pas d’informations personnelles.</p>
      </form>`}`, {
      wide: true,
      click: {
        src: el => { source = el.dataset.s; text = source === 'text' ? text : ''; image = null; imageUrl = ''; error = ''; draw(); },
        drop: el => { results.splice(+el.dataset.i, 1); draw(); },
        restart: () => { results = null; draw(); },
        save,
      },
      input: e => {
        if (e.target.id === 'ai-text') { text = e.target.value; app.querySelector('#count').textContent = text.length; }
        const i = e.target.dataset.i;
        if (i !== undefined && results) results[+i][e.target.dataset.f] = e.target.value;
        if (e.target.id === 'ai-title') title = e.target.value;
      },
      change: async e => {
        const f = e.target.files?.[0];
        if (!f) return;
        error = '';
        try {
          if (e.target.id === 'ai-pdf') {
            toast('Lecture du PDF…');
            text = (await pdfText(f)).slice(0, MAX_TEXT);
            if (!text) error = 'Ce PDF ne contient pas de texte lisible (c’est peut-être un scan) : essaie avec une photo.';
          } else if (e.target.id === 'ai-photo') {
            image = await imageData(f);
            imageUrl = `data:image/jpeg;base64,${image}`;
          }
        } catch {
          error = 'Impossible de lire ce fichier.';
        }
        draw();
      },
      submit: async () => {
        if (busy) return;
        if (!text.trim() && !image) { error = source === 'text' ? 'Colle d’abord ton cours.' : 'Choisis d’abord un fichier.'; return draw(); }
        busy = true;
        error = '';
        const count = +app.querySelector('#ai-count').value;
        draw();
        try {
          const out = await callAi({ mode: 'generate', text: text.slice(0, MAX_TEXT), image, count });
          results = (out.cards || []).filter(c => c.term && c.def).map(c => ({ term: String(c.term), def: String(c.def) }));
          title = out.title || 'Cartes générées';
          if (!results.length) { results = null; error = 'L’IA n’a trouvé aucune notion à mettre en cartes dans ce contenu.'; }
        } catch (err) {
          error = err.message;
        }
        busy = false;
        draw();
      },
    });
  };
  const resultsHTML = () => `<section class="panel">
      <div class="row-head"><h2>${results.length} carte${results.length > 1 ? 's' : ''} proposée${results.length > 1 ? 's' : ''}</h2><button class="btn ghost" data-action="restart">Recommencer</button></div>
      ${target ? '' : `<label for="ai-title">Titre du nouveau set</label><input id="ai-title" value="${esc(title)}">`}
      <ol class="edit-list ai-list">${results.map((c, i) => `<li>
        <span class="num">${i + 1}</span>
        <div class="cell"><label class="sr" for="r-t-${i}">Terme ${i + 1}</label><textarea id="r-t-${i}" data-i="${i}" data-f="term" rows="1">${esc(c.term)}</textarea></div>
        <div class="cell"><label class="sr" for="r-d-${i}">Définition ${i + 1}</label><textarea id="r-d-${i}" data-i="${i}" data-f="def" rows="2">${esc(c.def)}</textarea></div>
        <div class="row-tools"><button class="icon-btn danger-hover" type="button" data-action="drop" data-i="${i}" aria-label="Retirer la carte ${i + 1}">${icon('trash')}</button></div></li>`).join('')}</ol>
      <div class="actions"><button class="btn primary lg" data-action="save" ${results.length ? '' : 'disabled'}>${icon('check')}Ajouter ${plural(results.length, 'carte')}${target ? ` à « ${esc(target.title)} »` : ''}</button></div>
    </section>`;
  function save() {
    const cards = results.filter(c => c.term.trim() && c.def.trim()).map(c => ({ id: uid(), term: c.term.trim(), def: c.def.trim(), u: Date.now() }));
    let d = target;
    if (d) d.cards.push(...cards);
    else {
      d = cleanDeck({ id: uid(), title: (title || 'Cartes générées').trim().slice(0, 200), cards, updatedAt: 0, tu: 0 });
      state.decks[d.id] = d;
    }
    touch(d, !target);
    toast(`${plural(cards.length, 'carte')} ajoutée${cards.length > 1 ? 's' : ''}.`);
    location.hash = `deck/${d.id}`;
  }
  draw();
  renderMath(app);
};
