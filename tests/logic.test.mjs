import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, sameAnswer, review, buildQcm, merge, cleanDeck } from '../logic.js';

test('parseImport picks the first separator by priority', () => {
  const { cards, skipped } = parseImport('Paris\tcapitale ; France\nArticle 1240 ; Responsabilité\nHello - Bonjour\nsans séparateur\n\n');
  assert.deepEqual(cards, [
    { term: 'Paris', def: 'capitale ; France' },
    { term: 'Article 1240', def: 'Responsabilité' },
    { term: 'Hello', def: 'Bonjour' },
  ]);
  assert.equal(skipped, 1);
});

test('sameAnswer tolerates case, accents, articles and one typo', () => {
  assert.ok(sameAnswer('athenes', 'Athènes'));
  assert.ok(sameAnswer("l'arbre", 'Arbre'));
  assert.ok(sameAnswer('la Responsabilite', 'responsabilité'));
  assert.ok(sameAnswer('Stokholm', 'Stockholm'));
  assert.ok(!sameAnswer('Rom', 'Oslo'));
  assert.ok(!sameAnswer('', 'Paris'));
  assert.ok(!sameAnswer('chat', 'char')); // short words need an exact match
});

test('review schedules by grade and resets on "à revoir"', () => {
  const now = new Date(2026, 10, 18, 20, 0).getTime();
  const good = review(undefined, 2, now);
  assert.equal(good.interval, 1);
  assert.equal(good.due, new Date(2026, 10, 19).getTime()); // due from midnight
  const again = review(good, 2, good.due);
  assert.equal(again.interval, 3);
  const easy = review(undefined, 3, now);
  assert.equal(easy.interval, 3);
  const lapse = review(again, 0, now);
  assert.equal(lapse.reps, 0);
  assert.equal(lapse.due, now + 10 * 60e3);
  assert.ok(lapse.ease < again.ease);
});

test('buildQcm has the answer once and no duplicate options', () => {
  const cards = ['a', 'b', 'b', 'c', 'd', 'e'].map((def, i) => ({ id: String(i), term: 't' + i, def }));
  for (let k = 0; k < 50; k++) {
    const opts = buildQcm(cards, cards[0]);
    assert.equal(opts.length, 4);
    assert.equal(opts.filter(o => o === 'a').length, 1);
    assert.equal(new Set(opts).size, 4);
  }
  assert.equal(buildQcm(cards.slice(0, 2), cards[0]).length, 2);
});

test('cleanDeck rejects junk and strips unknown fields', () => {
  assert.equal(cleanDeck({ id: 'x' }), null);
  assert.equal(cleanDeck({ id: 'x', updatedAt: 1, title: 't', cards: 'nope' }), null);
  const d = cleanDeck({ id: 'x', updatedAt: 1, title: 't', evil: 1, cards: [{ id: 'c', term: 'a', def: 'b', srs: { due: 'x' } }, { id: 2 }] });
  assert.deepEqual(d, { id: 'x', title: 't', cards: [{ id: 'c', term: 'a', def: 'b' }], updatedAt: 1 });
});

test('merge: newest wins, local-only edited decks are pushed, untouched example is not', () => {
  const deck = (id, t) => ({ id, title: id, cards: [], updatedAt: t });
  const local = { a: deck('a', 5), b: deck('b', 1), c: deck('c', 3), ex: deck('ex', 0) };
  const rows = [{ id: 'a', data: deck('a', 2) }, { id: 'b', data: deck('b', 9) }, { id: 'r', data: deck('r', 4) }, { id: 'bad', data: { nope: 1 } }];
  const { merged, toPush } = merge(local, rows);
  assert.equal(merged.a.updatedAt, 5);
  assert.equal(merged.b.updatedAt, 9);
  assert.equal(merged.r.updatedAt, 4);
  assert.equal(merged.bad, undefined);
  assert.deepEqual(toPush.sort(), ['a', 'c']);
});
