import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImport, parseCsv, toCsv, sameAnswer, review, buildQcm, merge, mergeDeck, cleanDeck, cleanProfile, mergeProfile, streak, dayKey, slug, DAY } from '../logic.js';

test('parseImport picks the first separator by priority', () => {
  const { cards, skipped } = parseImport('Paris\tcapitale ; France\nArticle 1240 ; Responsabilité\nHello - Bonjour\nsans séparateur\n\n');
  assert.deepEqual(cards, [
    { term: 'Paris', def: 'capitale ; France' },
    { term: 'Article 1240', def: 'Responsabilité' },
    { term: 'Hello', def: 'Bonjour' },
  ]);
  assert.equal(skipped, 1);
});

test('CSV round trip keeps quotes, separators and line breaks', () => {
  const cards = [{ term: 'a;b', def: 'dit "oui"' }, { term: 'multi', def: 'ligne 1\nligne 2' }];
  assert.deepEqual(parseCsv(toCsv(cards)).cards, cards);
  assert.deepEqual(parseCsv('terme,definition\nchat,cat\nchien,dog\n').cards, [{ term: 'chat', def: 'cat' }, { term: 'chien', def: 'dog' }]);
  assert.equal(parseCsv('a;b\nseul;\n').skipped, 1);
});

test('sameAnswer tolerates case, accents, articles and small typos', () => {
  assert.ok(sameAnswer('athenes', 'Athènes'));
  assert.ok(sameAnswer("l'arbre", 'Arbre'));
  assert.ok(sameAnswer('la Responsabilite', 'responsabilité'));
  assert.ok(sameAnswer('Stokholm', 'Stockholm'));
  assert.ok(!sameAnswer('Rom', 'Oslo'));
  assert.ok(!sameAnswer('', 'Paris'));
  assert.ok(!sameAnswer('chat', 'char'));
});

test('FSRS: first answers, growth on success, drop on lapse', () => {
  const now = new Date(2026, 10, 18, 20, 0).getTime();
  const good = review(undefined, 2, now);
  assert.equal(good.interval, 4);
  assert.equal(good.due, new Date(2026, 10, 22).getTime()); // due from midnight
  assert.equal(review(undefined, 3, now).interval, 14);
  const again = review(undefined, 0, now);
  assert.equal(again.interval, 0);
  assert.equal(again.due, now + 10 * 60e3);
  const second = review(good, 2, good.due);
  assert.ok(second.interval > good.interval * 2, `second interval ${second.interval}`);
  const hard = review(good, 1, good.due);
  assert.ok(hard.interval < second.interval);
  const lapse = review(second, 0, second.due);
  assert.equal(lapse.lapses, 1);
  assert.ok(lapse.s < second.s);
  assert.ok(lapse.d > second.d);
});

test('buildQcm: answer once, no duplicates, AI distractors first', () => {
  const cards = ['a', 'b', 'b', 'c', 'd', 'e'].map((def, i) => ({ id: String(i), term: 't' + i, def }));
  for (let k = 0; k < 50; k++) {
    const opts = buildQcm(cards, cards[0]);
    assert.equal(opts.length, 4);
    assert.equal(opts.filter(o => o === 'a').length, 1);
    assert.equal(new Set(opts).size, 4);
  }
  assert.equal(buildQcm(cards.slice(0, 2), cards[0]).length, 2);
  const withAlt = { ...cards[0], alt: ['x', 'y', 'z'] };
  assert.deepEqual(buildQcm(cards, withAlt).sort(), ['a', 'x', 'y', 'z']);
  assert.deepEqual(buildQcm(cards, cards[0], 'term').filter(o => o === 't0'), ['t0']);
});

test('cleanDeck migrates v1 data and rejects junk', () => {
  assert.equal(cleanDeck({ id: 'x' }), null);
  assert.equal(cleanDeck({ id: 'x', updatedAt: 1, title: 't', cards: 'nope' }), null);
  const v1 = cleanDeck({ id: 'x', updatedAt: 5, title: 't', evil: 1, cards: [{ id: 'c', term: 'a', def: 'b', srs: { interval: 3, ease: 2.5, reps: 2, due: 10 * DAY } }, { id: 2 }] });
  assert.equal(v1.cards.length, 1);
  assert.equal(v1.evil, undefined);
  assert.deepEqual(Object.keys(v1.cards[0].srs), ['s', 'd', 'last', 'reps', 'lapses', 'interval', 'due']);
  assert.equal(v1.cards[0].srs.s, 3);
  const tomb = cleanDeck({ id: 'x', deleted: true, title: '', cards: [], updatedAt: 3 });
  assert.equal(tomb.purged, true);
  const trashed = cleanDeck({ id: 'x', deleted: true, deletedAt: 4, title: 't', cards: [], updatedAt: 4 });
  assert.equal(trashed.purged, undefined);
  assert.equal(trashed.deleted, true);
});

const deck = (id, t, cards, extra = {}) => cleanDeck({ id, title: id, cards, updatedAt: t, tu: 0, ...extra });
const card = (id, term, u) => ({ id, term, def: 'd', u });

test('mergeDeck keeps edits made on both devices', () => {
  const base = deck('a', 10, [card('1', 'un', 1), card('2', 'deux', 1), card('3', 'trois', 1)]);
  const phone = deck('a', 20, [card('1', 'UN', 20), card('2', 'deux', 1), card('3', 'trois', 1), card('4', 'quatre', 20)]);
  const laptop = deck('a', 30, [card('1', 'un', 1), card('3', 'trois', 1)], { gone: { 2: 30 }, title: 'Nouveau titre', tu: 30 });
  const m = mergeDeck(phone, laptop);
  assert.deepEqual(m.cards.map(c => c.term), ['UN', 'trois', 'quatre']);
  assert.equal(m.title, 'Nouveau titre');
  assert.equal(m.updatedAt, 30);
  assert.deepEqual(mergeDeck(laptop, phone), m);
  // a card edited after its deletion elsewhere comes back
  const edited = deck('a', 40, [card('2', 'deux bis', 40)]);
  assert.ok(mergeDeck(laptop, edited).cards.some(c => c.id === '2'));
  assert.equal(mergeDeck(base, null).id, 'a');
});

test('merge: pushes what the server lacks, never the untouched example', () => {
  const local = { a: deck('a', 5, []), c: deck('c', 3, []), ex: deck('ex', 0, []) };
  const rows = [{ id: 'a', data: deck('a', 2, []) }, { id: 'r', data: deck('r', 4, []) }, { id: 'bad', data: { nope: 1 } }];
  const { merged, toPush } = merge(local, rows);
  assert.equal(merged.a.updatedAt, 5);
  assert.equal(merged.r.updatedAt, 4);
  assert.equal(merged.bad, undefined);
  assert.deepEqual(toPush.sort(), ['a', 'c']);
  assert.deepEqual(merge({ a: deck('a', 2, []) }, [{ id: 'a', data: deck('a', 2, []) }]).toPush, []);
});

test('profile merge and streaks', () => {
  const now = new Date(2026, 10, 18, 9).getTime();
  const d = n => dayKey(now - n * DAY);
  const a = cleanProfile({ days: { [d(0)]: { n: 5, t: 60 }, [d(1)]: { n: 3, t: 10 } }, goal: 30, goalAt: 2 });
  const b = cleanProfile({ days: { [d(1)]: { n: 7, t: 5 }, [d(2)]: { n: 1, t: 1 }, [d(9)]: { n: 2 } }, goal: 10, goalAt: 1 });
  const m = mergeProfile(a, b);
  assert.deepEqual(m.days[d(1)], { n: 7, t: 10 });
  assert.equal(m.goal, 30);
  assert.deepEqual(mergeProfile(b, a), m);
  assert.deepEqual(streak(m.days, now), { current: 3, best: 3 });
  assert.equal(streak(b.days, now).current, 2); // today not studied yet: the streak counts from yesterday
  assert.equal(cleanProfile({ goal: 9999 }).goal, 500);
});

test('slug fits the share-link format', () => {
  assert.match(slug(), /^[a-z0-9]{12}$/);
});
