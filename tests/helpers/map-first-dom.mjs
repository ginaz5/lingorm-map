// Minimal DOM for the map-first layout: full-bleed #map under a floating
// #map-top bar, with #panel as the mobile bottom sheet or desktop side panel.
export function element(extra = {}) {
  const target = new EventTarget();
  const attributes = new Map();
  const classes = new Set();
  return Object.assign(target, {
    dataset: {},
    hidden: false,
    innerHTML: '',
    scrollTop: 0,
    textContent: '',
    style: { values: {}, setProperty(name, value) { this.values[name] = value; } },
    classList: {
      toggle(name, force) {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    getClientRects() { return [{}]; },
    focus() {},
  }, extra);
}

/**
 * @param {{ width?: number, height?: number, mapTopBottom?: number }} [options]
 */
export function makeMapFirstDom({ width = 390, height = 800, mapTopBottom = 112 } = {}) {
  const mobile = width <= 700;
  const peek = 112;
  const mapHeight = mobile ? height - peek : height;
  const mapLeft = mobile ? 0 : 408;
  const elements = {
    map: element({
      clientWidth: width - mapLeft,
      clientHeight: mapHeight,
      getBoundingClientRect: () => ({ top: 0, left: mapLeft, bottom: mapHeight, right: width }),
    }),
    'map-top': element({ getBoundingClientRect: () => ({ top: 12, bottom: mapTopBottom }) }),
    'app-body': element(),
    panel: element({ offsetLeft: 0, offsetWidth: mobile ? width : 408 }),
    'sheet-handle': element(),
    'panel-toggle': element(),
    'panel-results': element(),
    'loc-list': element(),
    'place-detail': element({ hidden: true }),
    'place-detail-body': element(),
  };
  const listeners = [];
  const view = {
    innerWidth: width,
    innerHeight: height,
    matchMedia: query => ({ matches: query.includes('max-width: 700px') && mobile, addEventListener() {} }),
    addEventListener: (type, fn) => listeners.push([type, fn]),
  };
  const documentRoot = {
    defaultView: view,
    documentElement: element(),
    getElementById: id => elements[id] ?? null,
    querySelectorAll: () => [],
    createElement: () => element(),
  };
  return { elements, view, documentRoot };
}
