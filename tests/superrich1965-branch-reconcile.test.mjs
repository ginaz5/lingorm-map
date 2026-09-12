// Phase A1 branch reconciliation — docs/superrich1965-exchange-map-plan.zh-TW.md §2.3.
// The name pairs below are the real mismatches recorded in the plan, not invented ones.
import assert from 'node:assert/strict';
import test from 'node:test';

import { groupsOf, normalize, proposeMatch, reconcile, similarity, tokens }
  from '../scripts/superrich1965-branch-reconcile.mjs';

const branch = (id, en, extra = {}) => ({
  id, slug: `b-${id}`, title: { en, cn: '', th: '' },
  latitude: '13.7', longitude: '100.5', groups: [{ slug: 'main-branch' }], ...extra,
});
const entry = (code, name, extra = {}) =>
  ({ code, name, companyCode: 'A04', isDefault: false, ...extra });

// ─── normalisation ──────────────────────────────────────────────────────────

test('normalize collapses the spacing difference the two lists actually have', () => {
  assert.equal(normalize('Central World'), normalize('CentralWorld'));
  assert.equal(normalize('Silom Plaza (สีลมพลาซ่า)'), normalize('Silom Plaza'));
  assert.equal(normalize('THE EMSPHERE G FLOOR'), 'theemspheregfloor');
});

test('normalize keeps genuinely different branches apart', () => {
  assert.notEqual(normalize('Ratchadamri 1'), normalize('Ratchadamri 2'));
  assert.notEqual(normalize('The Emsphere 2nd Floor'), normalize('THE EMSPHERE G FLOOR'));
  assert.notEqual(normalize('Seacon Square Srinakarin'), normalize('Seacon Bangkae'));
});

test('tokens drops parenthesised Thai and punctuation', () => {
  assert.deepEqual(tokens('The Emsphere 2nd Floor (ดิ เอ็มสเฟียร์ ชั้น 2)'),
    ['the', 'emsphere', '2nd', 'floor']);
});

test('similarity is bounded and symmetric', () => {
  assert.equal(similarity('abc', 'abc'), 1);
  assert.equal(similarity('', ''), 1);
  assert.equal(similarity('a', 'zzzz'), 0);
  assert.equal(similarity('centralworld', 'centralembassy'),
               similarity('centralembassy', 'centralworld'));
});

// ─── matching tiers ─────────────────────────────────────────────────────────

test('spacing-only difference matches exactly', () => {
  const { top } = proposeMatch(entry('34', 'Central World'), [branch(70, 'CentralWorld')]);
  assert.equal(top.tier, 'exact');
  assert.equal(top.branch.id, 70);
});

test('an inserted word matches as a token subset, and never as exact', () => {
  // "Big C Ratchadapisek" vs "Big C Place Ratchadapisek": the extra word sits
  // in the middle, so neither normalised string contains the other — only the
  // token comparison catches it. Either way it must not be reported as exact,
  // because exact is the one tier the report lets a reviewer skip.
  const { top } = proposeMatch(
    entry('50', 'Big C Ratchadapisek'),
    [branch(80, 'Big C Place Ratchadapisek')]
  );
  assert.equal(top.tier, 'token-subset');
  assert.notEqual(top.tier, 'exact');
  assert.equal(top.branch.id, 80);
});

test('a trailing/leading word difference matches as contained', () => {
  const { top } = proposeMatch(entry('47', 'Emsphere'), [branch(81, 'The Emsphere')]);
  assert.equal(top.tier, 'contained');
  assert.equal(top.branch.id, 81);
});

test('the two Emsphere branches do not get confused', () => {
  const branches = [branch(90, 'THE EMSPHERE G FLOOR'), branch(91, 'The Emsphere 2nd Floor')];
  const second = proposeMatch(entry('51', 'The Emsphere 2nd Floor (ดิ เอ็มสเฟียร์ ชั้น 2)'), branches);
  const ground = proposeMatch(entry('64', 'THE EMSPHERE G FLOOR'), branches);
  assert.equal(second.top.branch.id, 91);
  assert.equal(ground.top.branch.id, 90);
});

test('Ratchadamri 1 and 2 stay on their own branches', () => {
  const branches = [branch(60, 'Ratchadamri 1'), branch(61, 'Ratchadamri 2')];
  assert.equal(proposeMatch(entry('36', 'Ratchadamri 1'), branches).top.branch.id, 60);
  assert.equal(proposeMatch(entry('35', 'Ratchadamri 2'), branches).top.branch.id, 61);
});

test('no plausible candidate still returns a row rather than throwing', () => {
  const { rows } = reconcile([entry('99', 'Somewhere Entirely Else')], [branch(70, 'CentralWorld')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, 'fuzzy');
  assert.ok(rows[0].score < 0.4, `expected a weak score, got ${rows[0].score}`);
});

test('an empty /branches list yields null ids, not a crash', () => {
  const { rows } = reconcile([entry('00', 'Silom Plaza')], []);
  assert.equal(rows[0].officialId, null);
  assert.equal(rows[0].tier, 'none');
});

// ─── the collision guard ────────────────────────────────────────────────────
// The orange rate response carries no branch identifier (plan §2), so a
// mapping that silently pairs two branch_no values with one branch could never
// be caught downstream. This must fail loudly here.

test('two entries landing on one branch are flagged, not silently merged', () => {
  const { rows, collisions } = reconcile(
    [entry('36', 'Ratchadamri'), entry('35', 'Ratchadamri')],
    [branch(60, 'Ratchadamri')]
  );
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].officialId, 60);
  assert.deepEqual(collisions[0].codes.sort(), ['35', '36']);
  assert.ok(rows.every((r) => r.collision === true));
});

test('clean pairings report no collisions', () => {
  const { rows, collisions } = reconcile(
    [entry('36', 'Ratchadamri 1'), entry('35', 'Ratchadamri 2')],
    [branch(60, 'Ratchadamri 1'), branch(61, 'Ratchadamri 2')]
  );
  assert.deepEqual(collisions, []);
  assert.ok(rows.every((r) => r.collision === false));
  assert.deepEqual(rows.map((r) => r.officialId).sort(), [60, 61]);
});

test('unmatched entries never collide with each other on a null id', () => {
  const { collisions } = reconcile(
    [entry('98', 'Nowhere A'), entry('99', 'Nowhere B')],
    []
  );
  assert.deepEqual(collisions, []);
});

// ─── groups ─────────────────────────────────────────────────────────────────

test('groupsOf accepts both the object and the bare-string shape', () => {
  assert.deepEqual(groupsOf({ groups: [{ slug: 'main-branch' }] }), ['main-branch']);
  assert.deepEqual(groupsOf({ groups: ['partner'] }), ['partner']);
  assert.deepEqual(groupsOf({ groups: [{ name: 'Our Branch' }] }), ['Our Branch']);
  assert.deepEqual(groupsOf({}), []);
  assert.deepEqual(groupsOf(null), []);
});

test('the group is carried onto the row so Our vs Partner can be read off', () => {
  const { rows } = reconcile(
    [entry('E52-01', 'Terminal 21 Pattaya', { companyCode: 'E52' })],
    [branch(120, 'Terminal 21 Pattaya', { groups: [{ slug: 'partner' }] })]
  );
  assert.deepEqual(rows[0].groups, ['partner']);
  assert.equal(rows[0].companyCode, 'E52');
});
