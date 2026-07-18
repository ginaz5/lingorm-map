import assert from 'node:assert/strict';
import test from 'node:test';

import { assessResolvedPlace } from '../scripts/resolve.mjs';

const resolved = {
  placeId: 'place-1',
  name: 'Example',
  address: '',
  lat: 13.75,
  lng: 100.5,
  businessStatus: 'OPERATIONAL',
  types: [],
};

test('resolver flags a candidate when stored coordinates are missing', () => {
  const result = assessResolvedPlace('Example', Number.NaN, Number.NaN, resolved);
  assert.equal(result.distanceMeters, null);
  assert.equal(result.flagForReview, true);
  assert.equal(result.reason, 'no_stored_coords');
});

test('resolver flags a candidate when Google omits coordinates', () => {
  const result = assessResolvedPlace('Example', 13.75, 100.5, { ...resolved, lat: null });
  assert.equal(result.distanceMeters, null);
  assert.equal(result.flagForReview, true);
  assert.equal(result.reason, 'no_resolved_coords');
});

test('resolver flags candidates farther than 150 meters', () => {
  const result = assessResolvedPlace('Example', 13.75, 100.5, { ...resolved, lat: 13.76 });
  assert.ok(result.distanceMeters > 150);
  assert.equal(result.flagForReview, true);
  assert.equal(result.reason, 'moved_over_150m');
});

test('resolver accepts candidates within 150 meters', () => {
  const result = assessResolvedPlace('Example', 13.75, 100.5, resolved);
  assert.equal(result.distanceMeters, 0);
  assert.equal(result.flagForReview, false);
  assert.equal(result.reason, null);
});
