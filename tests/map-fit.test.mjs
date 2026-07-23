import assert from 'node:assert/strict';
import test from 'node:test';

import { fitMapToVisibleLocations } from '../src/map.js';
import { state } from '../src/state.js';

function resetState() {
  state.data = [];
  state.visIdx = [];
  state.map = null;
  state.provider = null;
  state.pendingDestinationFit = false;
}

test('Google fits multiple visible results with padding', () => {
  const calls = [];
  state.data = [
    { lat: '13.7', lng: '100.5' },
    { lat: '16.4', lng: '102.8' },
  ];
  state.visIdx = [0, 1];
  state.provider = 'google';
  state.pendingDestinationFit = true;
  state.map = {
    fitBounds: (bounds, padding) => calls.push({ bounds, padding }),
  };

  try {
    assert.equal(fitMapToVisibleLocations(), true);
    assert.deepEqual(calls, [{
      bounds: {
        north: 16.4,
        south: 13.7,
        east: 102.8,
        west: 100.5,
      },
      padding: 48,
    }]);
    assert.equal(state.pendingDestinationFit, false);
  } finally {
    resetState();
  }
});

test('single visible result centers both providers at place-level zoom', () => {
  const centers = [];
  const zooms = [];
  state.data = [{ lat: '10.77', lng: '106.69' }];
  state.visIdx = [0];
  state.provider = 'here';
  state.map = {
    setCenter: center => centers.push(center),
    setZoom: zoom => zooms.push(zoom),
  };

  try {
    assert.equal(fitMapToVisibleLocations(), true);
    assert.deepEqual(centers, [{ lat: 10.77, lng: 106.69 }]);
    assert.deepEqual(zooms, [14]);
  } finally {
    resetState();
  }
});

test('HERE fits multiple visible results with equal padding', () => {
  const lookAtCalls = [];
  class Rect {
    constructor(north, west, south, east) {
      this.north = north;
      this.west = west;
      this.south = south;
      this.east = east;
    }
  }
  const previousH = globalThis.H;
  globalThis.H = { geo: { Rect } };
  state.data = [
    { lat: '13.7', lng: '100.5' },
    { lat: '16.4', lng: '102.8' },
  ];
  state.visIdx = [0, 1];
  state.provider = 'here';
  state.map = {
    getViewModel: () => ({
      setLookAtData: (options, animate) => lookAtCalls.push({ options, animate }),
    }),
  };

  try {
    assert.equal(fitMapToVisibleLocations(), true);
    assert.deepEqual(lookAtCalls, [{
      options: {
        bounds: new Rect(16.4, 100.5, 13.7, 102.8),
        padding: { top: 48, right: 48, bottom: 48, left: 48 },
      },
      animate: true,
    }]);
  } finally {
    globalThis.H = previousH;
    resetState();
  }
});

test('blank coordinates are ignored rather than treated as zero', () => {
  const centers = [];
  state.data = [
    { lat: '', lng: '' },
    { lat: '13.7', lng: '100.5' },
  ];
  state.visIdx = [0, 1];
  state.provider = 'google';
  state.map = {
    setCenter: center => centers.push(center),
    setZoom: () => {},
  };

  try {
    assert.equal(fitMapToVisibleLocations(), true);
    assert.deepEqual(centers, [{ lat: 13.7, lng: 100.5 }]);
  } finally {
    resetState();
  }
});

test('no visible results preserve the viewport', () => {
  state.map = {};
  state.provider = 'google';
  state.visIdx = [];
  state.pendingDestinationFit = true;

  try {
    assert.equal(fitMapToVisibleLocations(), false);
    assert.equal(state.pendingDestinationFit, false);
  } finally {
    resetState();
  }
});
