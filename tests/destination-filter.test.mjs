import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COUNTRY_CODES,
  DESTINATION_KEYS,
  isValidDestinationPair,
} from '../src/data/destinations.js';
import {
  DESTINATION_FILTER_STORAGE_KEY,
  countrySelectionState,
  fitDestinationMenuHeight,
  loadDestinationFilter,
  reconcileDestinationFilter,
  saveDestinationFilter,
  toggleCountryDestinations,
} from '../src/features/destination-filter.js';
import { state } from '../src/core/state.js';

test('destination taxonomy exposes stable countries and valid pairs', () => {
  assert.deepEqual(COUNTRY_CODES, ['TH', 'VN', 'TW', 'HK', 'MO']);
  assert.deepEqual(DESTINATION_KEYS, [
    'bangkok',
    'khon-kaen',
    'chiang-mai',
    'khao-yai',
    'koh-samui',
    'pattaya',
    'ubon-ratchathani',
    'ho-chi-minh-city',
    'taipei',
    'taichung',
    'kaohsiung',
    'tainan',
    'hualien',
    'hong-kong',
    'macau',
  ]);
  assert.equal(isValidDestinationPair('TH', 'bangkok'), true);
  assert.equal(isValidDestinationPair('VN', 'bangkok'), false);
  assert.equal(isValidDestinationPair('TW', 'kaohsiung'), true);
  assert.equal(isValidDestinationPair('HK', 'hong-kong'), true);
  assert.equal(isValidDestinationPair('MO', 'macau'), true);
  assert.equal(isValidDestinationPair('TW', 'hong-kong'), false);
});

test('destination menu height stays above the mobile panel boundary', () => {
  const button = {
    getBoundingClientRect: () => ({ bottom: 231 }),
  };
  const menu = { style: { maxHeight: '' } };

  assert.equal(
    fitDestinationMenuHeight(
      /** @type {HTMLElement} */ (/** @type {unknown} */ (button)),
      /** @type {HTMLElement} */ (/** @type {unknown} */ (menu)),
      512,
    ),
    267,
  );
  assert.equal(menu.style.maxHeight, '267px');

  assert.equal(
    fitDestinationMenuHeight(
      /** @type {HTMLElement} */ (/** @type {unknown} */ (button)),
      /** @type {HTMLElement} */ (/** @type {unknown} */ (menu)),
      900,
    ),
    460,
  );
  assert.equal(menu.style.maxHeight, '460px');
});

test('destination selections persist across reload and ignore unknown keys', () => {
  const values = new Map([
    [
      DESTINATION_FILTER_STORAGE_KEY,
      JSON.stringify(['koh-samui', 'unknown', 'bangkok']),
    ],
  ]);
  const previousStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage'
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });

  try {
    loadDestinationFilter();
    assert.deepEqual(
      [...state.selectedDestinations].sort(),
      ['bangkok', 'koh-samui']
    );
    assert.equal(state.pendingDestinationFit, true);

    state.selectedDestinations = new Set(['koh-samui', 'bangkok']);
    saveDestinationFilter();
    assert.equal(
      values.get(DESTINATION_FILTER_STORAGE_KEY),
      JSON.stringify(['bangkok', 'koh-samui'])
    );
  } finally {
    if (previousStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousStorageDescriptor);
    } else {
      delete globalThis.localStorage;
    }
    state.selectedDestinations = new Set();
    state.pendingDestinationFit = false;
  }
});

test('country checkbox selects all children, reports partial state, and toggles off', () => {
  const available = new Set(['bangkok', 'khon-kaen', 'ho-chi-minh-city']);
  state.selectedDestinations = new Set(['bangkok']);

  try {
    assert.deepEqual(countrySelectionState('TH', available), {
      checked: false,
      indeterminate: true,
    });

    toggleCountryDestinations('TH', available);
    assert.deepEqual(
      [...state.selectedDestinations].sort(),
      ['bangkok', 'khon-kaen']
    );
    assert.deepEqual(countrySelectionState('TH', available), {
      checked: true,
      indeterminate: false,
    });

    state.selectedDestinations.add('ho-chi-minh-city');
    assert.deepEqual(countrySelectionState('VN', available), {
      checked: true,
      indeterminate: false,
    });

    toggleCountryDestinations('TH', available);
    assert.deepEqual([...state.selectedDestinations], ['ho-chi-minh-city']);
  } finally {
    state.selectedDestinations = new Set();
  }
});

test('loaded public data removes unavailable saved destinations and persists the repair', () => {
  const values = new Map();
  const previousStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage'
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  state.data = [
    { status: 'Published', destinationKey: 'bangkok' },
    { status: 'Paused', destinationKey: 'koh-samui' },
  ];
  state.selectedDestinations = new Set(['bangkok', 'koh-samui']);
  state.pendingDestinationFit = true;

  try {
    assert.equal(reconcileDestinationFilter(), true);
    assert.deepEqual([...state.selectedDestinations], ['bangkok']);
    assert.equal(
      values.get(DESTINATION_FILTER_STORAGE_KEY),
      JSON.stringify(['bangkok'])
    );
    assert.equal(state.pendingDestinationFit, true);
  } finally {
    if (previousStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', previousStorageDescriptor);
    } else {
      delete globalThis.localStorage;
    }
    state.data = [];
    state.selectedDestinations = new Set();
    state.pendingDestinationFit = false;
  }
});

test('empty public data preserves saved destinations after a loading failure', () => {
  state.data = [];
  state.selectedDestinations = new Set(['koh-samui']);
  state.pendingDestinationFit = true;

  try {
    assert.equal(reconcileDestinationFilter(), false);
    assert.deepEqual([...state.selectedDestinations], ['koh-samui']);
    assert.equal(state.pendingDestinationFit, true);
  } finally {
    state.selectedDestinations = new Set();
    state.pendingDestinationFit = false;
  }
});
