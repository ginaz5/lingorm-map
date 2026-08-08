import assert from 'node:assert/strict';
import test from 'node:test';

import { setLang } from '../src/core/i18n.js';
import { state } from '../src/core/state.js';
import {
  trackEvent,
  trackFavoriteToggle,
  trackFilterApply,
  trackLanguageChange,
  trackLocateResult,
  trackLocationAction,
  trackLocationOpen,
  trackSearchComplete,
  trackTabView,
} from '../src/services/analytics.js';

const location = {
  id: 'sample-cafe',
  nameEn: 'Sample Cafe',
  nameZh: '範例咖啡廳',
  alt: '',
  catEn: 'Cafe',
  catZh: '咖啡廳',
  notesEn: '',
  notesZh: '',
  icon: '☕',
  lat: '13.7',
  lng: '100.5',
  maps: '',
  status: 'Published',
  src: '',
  approx: '',
  sourceUrl: '',
  countryCode: 'TH',
  destinationKey: 'bangkok',
  type: 'JKR Picks',
};

test('trackEvent is a no-op outside a browser context', () => {
  const previousWindow = globalThis.window;
  delete globalThis.window;

  try {
    assert.equal(trackEvent('test_event'), false);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('location analytics queue stable dimensions and interaction details', () => {
  const previousWindow = globalThis.window;
  const previousLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  globalThis.window = { dataLayer: [] };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem() {} },
  });

  try {
    setLang('en');
    state.provider = 'google';

    trackLocationOpen(location, 'map_marker');
    trackLocationAction(location, 'directions', 'popup');
    trackFavoriteToggle(location, 'add', 'list_card');

    const common = {
      location_id: 'sample-cafe',
      location_name: 'Sample Cafe',
      location_category: 'Cafe',
      location_type: 'JKR Picks',
      destination: 'bangkok',
      map_provider: 'google',
      ui_language: 'en',
    };
    assert.deepEqual(globalThis.window.dataLayer, [
      { ...common, interaction_source: 'map_marker', event: 'location_open' },
      {
        ...common,
        action: 'directions',
        interaction_source: 'popup',
        event: 'location_action',
      },
      {
        ...common,
        favorite_action: 'add',
        interaction_source: 'list_card',
        event: 'favorite_toggle',
      },
    ]);
  } finally {
    setLang('zh');
    state.provider = null;
    globalThis.window = previousWindow;
    if (previousLocalStorageDescriptor) {
      Object.defineProperty(
        globalThis,
        'localStorage',
        previousLocalStorageDescriptor,
      );
    } else {
      delete globalThis.localStorage;
    }
  }
});

test('trackEvent creates the GTM queue when it does not exist yet', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};

  try {
    assert.equal(trackEvent('early_event', { ready: true }), true);
    assert.deepEqual(globalThis.window.dataLayer, [
      { ready: true, event: 'early_event' },
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('discovery and preference analytics exclude raw search and location data', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { dataLayer: [] };
  state.provider = 'here';

  try {
    trackFilterApply('destination', 'destination:bangkok', 12, 'select', 2);
    trackSearchComplete(7, 0);
    trackLocateResult('denied');
    trackTabView('map');
    trackLanguageChange('zh', 'en');

    assert.deepEqual(globalThis.window.dataLayer, [
      {
        map_provider: 'here', ui_language: 'zh',
        filter_type: 'destination', filter_value: 'destination:bangkok',
        filter_action: 'select', selected_count: 2, result_count: 12,
        event: 'filter_apply',
      },
      {
        map_provider: 'here', ui_language: 'zh', query_length: 7,
        result_count: 0, has_results: false, event: 'search_complete',
      },
      {
        map_provider: 'here', ui_language: 'zh', result: 'denied',
        event: 'locate_result',
      },
      {
        map_provider: 'here', ui_language: 'zh', tab: 'map', event: 'tab_view',
      },
      {
        map_provider: 'here', ui_language: 'zh', from_language: 'zh',
        to_language: 'en', event: 'language_change',
      },
    ]);

    const serialized = JSON.stringify(globalThis.window.dataLayer);
    assert.doesNotMatch(serialized, /latitude|longitude|query_text|search_term/);
  } finally {
    state.provider = null;
    globalThis.window = previousWindow;
  }
});
