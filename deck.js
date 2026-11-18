import { uid, parseImport, parseCsv, toCsv, cleanDeck } from './logic.js?v=5';
import {
  state, views, mount, app, esc, plural, icon, toast, download, playable, dueIn, newIn, mastery, tint, meter, touch, touchCard,
  removeCards, backHome, backTo, autosize, live, trashed, purge, fmtDate, LANGS, MASTERED_DAYS, TRASH_DAYS, fr,
} from './core.js?v=5';
import { shareHTML, shareActions, stopShare, onShareChange } from './social.js?v=5';
import { improveQcm } from './ai.js?v=5';

const favOnly = {}; // deck id -> study only starred cards

// Close an open "more" menu when clicking elsewhere.
document.addEventListener('click', e => {
  for (const m of document.querySelectorAll('details.more[open]')) if (!m.contains(e.target)) m.open = false;
});

// ---------- one deck
views.deck = function deckView(d) {
  const all = playable(d), stars = all.filter(c => c.star).length;
  if (!stars) favOnly[d.id] = false;
  const fav = favOnly[d.id], cards = fav ? all.filter(c => c.star) : all;
  const n = cards.length, due = dueIn(d), fresh = newIn(d), m = mastery(d);
  const suffix = fav ? '/fav' : '';
  const mode = (key, name, desc, ok = true) => (ok ? `<a class="mode" href="#${key}/${d.id}${suffix}"><span class="mode-ic">${icon(key)}</span><span class="mode-text"><strong>${name}</strong><span>${desc}</span></span>${icon('next', 'chev')}</a>` : '');
  const dot = c => (!c.srs ? '<span class="dot d-new" title="Jamais étudiée"></span>' : c.srs.interval >= MASTERED_DAYS ? '<span class="dot d-done" title="Maîtrisée"></span>' : '<span class="dot d-learn" title="En cours"></span>');
  const draw = () => mount(`
    ${backHome}
    <header class="deck-hero ${tint(d)}">
      <div class="deck-hero-text">
        <p class="eyebrow">${plural(d.cards.length, 'carte')}${d.folder ? ` · ${esc(d.folder)}` : ''}${d.bestMatch ? ` · record ${d.bestMatch.toFixed(1)} s` : ''}</p>
        <h1>${esc(d.title)}</h1>
        <div class="deck-progress">${meter(m)}<p class="muted small"><strong>${m.mastered}</strong> maîtrisée${m.mastered > 1 ? 's' : ''} · <strong>${m.learning}</strong> en cours · <strong>${fresh}</strong> jamais étudiée${fresh > 1 ? 's' : ''}</p></div>
      </div>
      <div class="actions">
        ${all.length ? `<a class="btn primary" href="#review/${d.id}${suffix}">${icon('review')}Réviser${due ? ` (${due})` : ''}</a>` : ''}
        <a class="btn" href="#edit/${d.id}">${icon('edit')}Modifier</a>
        <button class="btn" data-action="share" aria-expanded="false">${icon('share')}Partager</button>
        <details class="more">
          <summary class="btn round" aria-label="Plus d’actions">${icon('more')}</summary>
          <div class="more-menu" role="menu">
            <a role="menuitem" href="#ai/${d.id}">${icon('sparkle')}Générer des cartes avec l’IA</a>
            ${all.length >= 2 ? `<button role="menuitem" data-action="qcm">${icon('sparkle')}Améliorer les QCM avec l’IA</button>` : ''}
            <button role="menuitem" data-action="dup">${icon('copy')}Dupliquer le set</button>
            <button role="menuitem" data-action="csv">${icon('download')}Exporter en CSV</button>
            <a role="menuitem" href="#print/${d.id}">${icon('print')}Imprimer</a>
            <button role="menuitem" data-action="trash" class="danger-item">${icon('trash')}Mettre à la corbeille</button>
          </div>
        </details>
      </div>
    </header>
    <div id="share-slot" hidden></div>
    ${stars ? `<div class="seg" role="group" aria-label="Cartes étudiées">
      <button type="button" data-action="fav" data-v="0" aria-pressed="${!fav}">Toutes les cartes (${all.length})</button>
      <button type="button" data-action="fav" data-v="1" aria-pressed="${!!fav}">${icon('star')}Favoris (${stars})</button>
    </div>` : ''}
    ${n ? `<nav class="modes" aria-label="Modes d’étude">
      ${mode('cards', 'Cartes', 'Retourner et parcourir, avec lecture à voix haute')}
      ${mode('learn', 'Apprendre', 'QCM puis réponse écrite, jusqu’à la maîtrise', n >= 2)}
      ${mode('test', 'Test', 'Examen noté, questions et chrono au choix', n >= 2)}
      ${mode('match', 'Association', d.bestMatch ? `Ton record : ${d.bestMatch.toFixed(1)} s` : 'Relier les paires contre la montre', n >= 2)}
      ${mode('write', 'Écriture et dictée', 'Écris la réponse, ou écoute et écris')}
    </nav>` : `<p class="empty">Ce set est vide. <a href="#edit/${d.id}">Ajoute des cartes</a> ou <a href="#ai/${d.id}">fais-les générer par l’IA</a>.</p>`}
    ${d.cards.length ? `<div class="row-head"><h2>Les cartes</h2><p class="legend muted small"><span class="dot d-done"></span>maîtrisée (retenue 3 semaines et plus) <span class="dot d-learn"></span>en cours <span class="dot d-new"></span>jamais étudiée</p></div>
    <ol class="card-list">${d.cards.map(c => `<li>${dot(c)}<span class="cl-term">${esc(c.term)}</span><span class="cl-def">${c.img ? `<img class="thumb" src="${esc(c.img)}" alt="" loading="lazy">` : ''}${esc(c.def)}</span>
      <button class="star-btn" data-action="star" data-id="${c.id}" aria-pressed="${!!c.star}" aria-label="${c.star ? 'Retirer des favoris' : 'Ajouter aux favoris'} : ${esc(c.term)}">${icon('star')}</button></li>`).join('')}</ol>` : ''}`, {
    wide: true,
    change: e => onShareChange(d, e.target),
    click: {
      fav: el => { favOnly[d.id] = el.dataset.v === '1'; deckView(d); },
      star: el => {
        const c = d.cards.find(x => x.id === el.dataset.id);
        c.star = !c.star;
        if (!c.star) delete c.star;
        touchCard(d, c);
        deckView(d);
      },
      share: el => {
        const slot = app.querySelector('#share-slot');
        slot.hidden = !slot.hidden;
        el.setAttribute('aria-expanded', !slot.hidden);
        if (!slot.hidden) slot.innerHTML = shareHTML(d);
      },
      ...shareActions(d, () => { app.querySelector('#share-slot').innerHTML = shareHTML(d); }),
      qcm: async el => {
        el.closest('details').open = false;
        await improveQcm(d);
      },
      dup: () => {
        const copy = cleanDeck({ id: uid(), title: `${d.title} (copie)`, folder: d.folder, langTerm: d.langTerm, langDef: d.langDef, updatedAt: 0, tu: 0,
          cards: d.cards.map(c => ({ id: uid(), term: c.term, def: c.def, u: Date.now(), ...(c.img ? { img: c.img } : {}), ...(c.alt ? { alt: c.alt } : {}) })) });
        state.decks[copy.id] = copy;
        touch(copy, true);
        toast('Set dupliqué. La progression repart de zéro sur la copie.');
        location.hash = `deck/${copy.id}`;
      },
      csv: el => {
        el.closest('details').open = false;
        download(`${d.title.replace(/[\\/:*?"<>|]+/g, '-')}.csv`, toCsv(d.cards), 'text/csv;charset=utf-8');
      },
      trash: () => {
        if (d.shareId) stopShare(d, true);
        d.deleted = true;
        d.deletedAt = Date.now();
        touch(d, true);
        toast(`Set mis à la corbeille. Tu peux le restaurer pendant ${TRASH_DAYS} jours.`);
        location.hash = '';
      },
    },
  });
  draw();
};

// ---------- edit
async function resizeImage(file, max = 1200) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
export function removeImage(url) {
  const path = url && url.split('/object/public/images/')[1];
  if (path && state.sb) state.sb.storage.from('images').remove([decodeURIComponent(path)]);
}

views.edit = function editView(d) {
  let timer = null, meta = false, dragId = null, imgFor = null, swapAsk = false;
  const flush = () => { if (timer) { clearTimeout(timer); timer = null; touch(d, meta); meta = false; } };
  const later = (isMeta = false) => { meta ||= isMeta; clearTimeout(timer); timer = setTimeout(flush, 600); };
  const folders = [...new Set(live().map(x => x.folder).filter(Boolean))];
  const langSelect = (id, value, label) => `<label class="field"><span class="field-label">${label}</span><select id="${id}">${LANGS.map(([k, l]) => `<option value="${k}"${k === (value || 'fr-FR') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
  const row = (c, i) => `<li data-id="${c.id}">
      <span class="grip" draggable="true" title="Glisser pour déplacer" aria-hidden="true">${icon('grip')}</span>
      <span class="num">${i + 1}</span>
      <div class="cell"><label class="sr" for="t-${c.id}">Terme ${i + 1}</label><textarea id="t-${c.id}" data-field="term" rows="1" placeholder="Terme">${esc(c.term)}</textarea></div>
      <div class="cell"><label class="sr" for="d-${c.id}">Définition ${i + 1}</label><textarea id="d-${c.id}" data-field="def" rows="1" placeholder="Définition">${esc(c.def)}</textarea>
        ${c.img ? `<div class="img-row"><img class="thumb" src="${esc(c.img)}" alt=""><button class="link-btn" type="button" data-action="noimg">Retirer l’image</button></div>` : ''}</div>
      <div class="row-tools">
        <button class="icon-btn star-btn" type="button" data-action="star" aria-pressed="${!!c.star}" aria-label="Favori, carte ${i + 1}">${icon('star')}</button>
        <button class="icon-btn" type="button" data-action="img" aria-label="${c.img ? 'Changer l’image' : 'Ajouter une image'}, carte ${i + 1}">${icon('image')}</button>
        <span class="updown"><button class="icon-btn sm" type="button" data-action="up" aria-label="Monter la carte ${i + 1}" ${i ? '' : 'disabled'}>${icon('up')}</button><button class="icon-btn sm" type="button" data-action="down" aria-label="Descendre la carte ${i + 1}" ${i < d.cards.length - 1 ? '' : 'disabled'}>${icon('down')}</button></span>
        <button class="icon-btn danger-hover" type="button" data-action="rm" aria-label="Supprimer la carte ${i + 1}">${icon('trash')}</button>
      </div></li>`;
  const addCards = (cards, skipped) => {
    if (!cards.length) return toast('Aucune ligne reconnue. Sépare le terme et la définition par « ; » ou une tabulation.');
    d.cards.push(...cards.map(c => ({ id: uid(), u: Date.now(), ...c })));
    touch(d);
    draw();
    toast(`${plural(cards.length, 'carte')} ajoutée${cards.length > 1 ? 's' : ''}${skipped ? ` · ${skipped} ligne${skipped > 1 ? 's' : ''} ignorée${skipped > 1 ? 's' : ''}` : ''}.`);
  };
  const move = (id, to) => {
    const from = d.cards.findIndex(c => c.id === id);
    if (from < 0 || to < 0 || to >= d.cards.length || from === to) return;
    const [c] = d.cards.splice(from, 1);
    d.cards.splice(to, 0, c);
    touch(d);
    draw(`[data-id="${id}"] .grip`);
  };
  const cardOf = el => d.cards.find(c => c.id === el.closest('li[data-id]').dataset.id);

  const draw = focus => {
    mount(`
      <div class="edit-bar">
        <a class="back-link" href="#deck/${d.id}">${icon('back')}Retour au set</a>
        <a class="btn primary" href="#deck/${d.id}">${icon('check')}Terminé</a>
      </div>
      <section class="edit-head panel">
        <label class="field"><span class="field-label">Titre du set</span><input id="title" class="title-input" value="${esc(d.title)}" autocomplete="off"></label>
        <div class="field-row">
          <label class="field"><span class="field-label">Dossier</span><input id="folder" list="folders" value="${esc(d.folder || '')}" placeholder="Ex. : Droit civil" autocomplete="off"></label>
          <datalist id="folders">${folders.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
          ${langSelect('lt', d.langTerm, 'Langue des termes')}
          ${langSelect('ld', d.langDef, 'Langue des définitions')}
        </div>
        <p class="muted small">Enregistré automatiquement. Les langues servent à la lecture à voix haute. Écris une formule entre $…$, par exemple $E = mc^2$.</p>
      </section>
      <div class="tools">
        <details class="bulk"${d.cards.length ? '' : ' open'}>
          <summary>${icon('upload')}Importer plusieurs cartes</summary>
          <p class="muted small">Une carte par ligne : le terme, puis une tabulation, « ; », « - » ou « : », puis la définition. Un copier-coller depuis un tableur ou un export Quizlet marche tel quel.</p>
          <label class="sr" for="bulk">Cartes à importer</label>
          <textarea id="bulk" rows="6" placeholder="Article 1240 ; Responsabilité du fait personnel&#10;Hello - Bonjour"></textarea>
          <div class="actions"><button class="btn primary" type="button" data-action="bulk">Ajouter ces cartes</button><label class="btn" for="file">${icon('file')}Depuis un fichier CSV ou texte</label><input type="file" id="file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden></div>
        </details>
        <a class="btn" href="#ai/${d.id}">${icon('sparkle')}Générer avec l’IA</a>
        ${d.cards.length ? `<button class="btn" type="button" data-action="swap">${icon('swap')}Inverser termes et définitions</button>` : ''}
      </div>
      ${swapAsk ? `<div class="confirm-box"><p>Inverser les termes et les définitions des ${plural(d.cards.length, 'carte')} ? Tu pourras refaire l’opération pour revenir en arrière.</p><div class="actions"><button class="btn primary" type="button" data-action="swapok">Inverser</button><button class="btn" type="button" data-action="swapno">Annuler</button></div></div>` : ''}
      <div class="row-head"><h2>${plural(d.cards.length, 'carte')}</h2></div>
      ${d.cards.length ? '<div class="edit-cols" aria-hidden="true"><span></span><span></span><span>Terme</span><span>Définition</span><span></span></div>' : ''}
      <ol class="edit-list">${d.cards.map(row).join('')}</ol>
      <button class="add-card" type="button" data-action="add">${icon('plus')}Ajouter une carte</button>
      <input type="file" id="img-file" accept="image/*" hidden>`, {
      cleanup: flush,
      input: e => {
        const t = e.target;
        if (t.id === 'title') { d.title = t.value.trim() || 'Sans titre'; later(true); return; }
        if (t.id === 'folder') { d.folder = t.value.trim(); if (!d.folder) delete d.folder; later(true); return; }
        if (!t.dataset.field) return;
        const c = cardOf(t);
        if (c) { c[t.dataset.field] = t.value; c.u = Date.now(); later(); autosize(t); }
      },
      change: async e => {
        const t = e.target;
        if (t.id === 'lt' || t.id === 'ld') { d[t.id === 'lt' ? 'langTerm' : 'langDef'] = t.value; touch(d, true); return; }
        if (t.id === 'file' && t.files[0]) {
          const f = t.files[0], text = await f.text();
          const { cards, skipped } = /\.csv$/i.test(f.name) ? parseCsv(text) : parseImport(text);
          addCards(cards, skipped);
          return;
        }
        if (t.id === 'img-file' && t.files[0] && imgFor) {
          const c = imgFor, file = t.files[0];
          t.value = '';
          toast('Envoi de l’image…');
          try {
            const blob = await resizeImage(file);
            const path = `${state.user.id}/${d.id}/${c.id}-${Date.now()}.jpg`;
            const { error } = await state.sb.storage.from('images').upload(path, blob, { contentType: 'image/jpeg' });
            if (error) throw error;
            removeImage(c.img);
            c.img = state.sb.storage.from('images').getPublicUrl(path).data.publicUrl;
            touchCard(d, c);
            draw();
            toast('Image ajoutée.');
          } catch (err) {
            toast(`Image non envoyée : ${fr(err.message || 'format non reconnu')}`);
          }
        }
      },
      click: {
        add: () => {
          const c = { id: uid(), term: '', def: '', u: Date.now() };
          d.cards.push(c);
          touch(d);
          draw(`#t-${c.id}`);
        },
        rm: el => {
          const c = cardOf(el);
          removeImage(c.img);
          removeCards(d, [c.id]);
          draw();
        },
        star: el => { const c = cardOf(el); c.star = !c.star; if (!c.star) delete c.star; touchCard(d, c); draw(); },
        up: el => { const c = cardOf(el); move(c.id, d.cards.indexOf(c) - 1); },
        down: el => { const c = cardOf(el); move(c.id, d.cards.indexOf(c) + 1); },
        img: el => {
          if (!state.user) return toast('Connecte-toi pour ajouter des images : elles sont stockées avec ton compte.');
          imgFor = cardOf(el);
          app.querySelector('#img-file').click();
        },
        noimg: el => { const c = cardOf(el); removeImage(c.img); delete c.img; touchCard(d, c); draw(); },
        bulk: () => { const { cards, skipped } = parseImport(app.querySelector('#bulk').value); addCards(cards, skipped); },
        swap: () => { swapAsk = true; draw(); },
        swapno: () => { swapAsk = false; draw(); },
        swapok: () => {
          const now = Date.now();
          for (const c of d.cards) { [c.term, c.def] = [c.def, c.term]; c.u = now; }
          [d.langTerm, d.langDef] = [d.langDef, d.langTerm];
          if (!d.langTerm) delete d.langTerm;
          if (!d.langDef) delete d.langDef;
          swapAsk = false;
          touch(d, true);
          draw();
          toast('Termes et définitions inversés.');
        },
      },
      dragstart: e => {
        const li = e.target.closest?.('li[data-id]');
        if (!li || !e.target.closest('.grip')) return;
        dragId = li.dataset.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragId);
        e.dataTransfer.setDragImage(li, 24, 24);
        li.classList.add('dragging');
      },
      dragover: e => {
        const li = dragId && e.target.closest?.('li[data-id]');
        if (!li) return;
        e.preventDefault();
        const below = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
        app.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
        li.classList.add(below ? 'drop-after' : 'drop-before');
      },
      drop: e => {
        const li = dragId && e.target.closest?.('li[data-id]');
        if (!li) return;
        e.preventDefault();
        const below = li.classList.contains('drop-after');
        const from = d.cards.findIndex(c => c.id === dragId);
        let to = d.cards.findIndex(c => c.id === li.dataset.id) + (below ? 1 : 0);
        if (from < to) to--;
        const id = dragId;
        dragId = null;
        move(id, to);
      },
      dragend: () => {
        dragId = null;
        app.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after'));
      },
    });
    app.querySelectorAll('.edit-list textarea').forEach(autosize);
    if (focus) app.querySelector(focus)?.focus();
  };
  draw();
};

// ---------- print
views.print = function printView(d) {
  mount(`
    <div class="no-print edit-bar">${backTo(d)}<button class="btn primary" data-action="print">${icon('print')}Imprimer</button></div>
    <header class="print-head"><h1>${esc(d.title)}</h1><p class="muted">${plural(d.cards.length, 'carte')}${d.folder ? ` · ${esc(d.folder)}` : ''}</p></header>
    <table class="print-table"><thead><tr><th>Terme</th><th>Définition</th></tr></thead>
      <tbody>${d.cards.map(c => `<tr><td>${esc(c.term)}</td><td>${c.img ? `<img class="thumb" src="${esc(c.img)}" alt="">` : ''}${esc(c.def)}</td></tr>`).join('')}</tbody></table>`, {
    wide: true,
    click: { print: () => print() },
  });
};

// ---------- trash
views.trash = function trashView() {
  let ask = null;
  const draw = () => {
    const list = trashed();
    mount(`${backHome}
      <header class="page-head"><h1>Corbeille</h1><p class="muted">Les sets supprimés restent ici ${TRASH_DAYS} jours, puis disparaissent définitivement.</p></header>
      ${list.length ? `<ul class="trash-list">${list.map(d => {
        const left = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - d.deletedAt) / 864e5));
        return `<li class="${tint(d)}"><div><strong>${esc(d.title)}</strong><span class="muted small">${plural(d.cards.length, 'carte')} · supprimé le ${fmtDate(d.deletedAt)} · encore ${plural(left, 'jour')}</span></div>
          <div class="actions">${ask === d.id
            ? `<span class="confirm">Supprimer définitivement ?</span><button class="btn danger" data-action="purge" data-id="${d.id}">Supprimer</button><button class="btn" data-action="cancel">Annuler</button>`
            : `<button class="btn" data-action="restore" data-id="${d.id}">${icon('restore')}Restaurer</button><button class="btn ghost" data-action="ask" data-id="${d.id}">Supprimer définitivement</button>`}</div></li>`;
      }).join('')}</ul>` : '<p class="empty">La corbeille est vide.</p>'}`, {
      wide: true,
      click: {
        restore: el => {
          const d = state.decks[el.dataset.id];
          delete d.deleted;
          delete d.deletedAt;
          touch(d, true);
          toast('Set restauré.');
          draw();
        },
        ask: el => { ask = el.dataset.id; draw(); },
        cancel: () => { ask = null; draw(); },
        purge: el => {
          const d = state.decks[el.dataset.id];
          for (const c of d.cards) removeImage(c.img);
          purge(d);
          ask = null;
          toast('Set supprimé définitivement.');
          draw();
        },
      },
    });
  };
  draw();
};

