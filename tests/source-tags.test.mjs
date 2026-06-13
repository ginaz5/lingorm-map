// Switched from regex extraction to direct import (Option B modularisation)
import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSources } from '../src/render.js';

test('renderSources labels repeated Threads tags by handle', () => {
  const row = {
    src: 'Trip.com + Threads + Threads + Google Maps',
    sourceUrl: [
      'https://tw.trip.com/moments/detail/bangkok-191-140507082/',
      'https://www.threads.com/@nightviper74/post/DId7paOJUKp',
      'https://www.threads.com/@my_go_go_d/post/DDVt-bayjvt',
      'https://maps.app.goo.gl/KoHpGcDNJB7bxsQ49',
    ].join(', '),
  };

  const html = renderSources(row);

  assert.match(html, />Trip.com</);
  assert.match(html, />Threads @nightviper74</);
  assert.match(html, />Threads @my_go_go_d</);
  assert.match(html, />Google Maps</);
});
