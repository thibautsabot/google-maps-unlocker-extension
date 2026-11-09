// Discovery: what the review script learns from the Maps script it fetches.
//
// Maps renames its functions and reshapes its code in every release, and this
// broke twice in one week: a renamed check, then a label compiled as a
// template literal. The fixtures are the parts of three real Maps builds that
// discovery reads. When Maps changes again and the feature goes quiet, save
// the new build's slices here and this fails until the extractors follow.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, suite, wait } from './lib/harness.mjs';

const t = suite('discovery');
const source = readFileSync(join(ROOT, 'reviews/ungate.js'), 'utf8');

async function learnFrom(fixture, { enabled = false, error = null, status = 200, root = {}, text: supplied } = {}) {
  const text = supplied ?? readFileSync(join(ROOT, 'tests/fixtures', fixture), 'utf8');
  const script = { src: 'https://www.google.com/maps/_/js/k=maps.m.fr.X/m=Y' };
  const logs = [];
  const listeners = [];
  const intervals = new Set();
  const observers = [];
  let asks = 0;
  const clicks = [];
  let selectedTab = null;
  const buttons = [];
  let withBody = false;
  const win = {
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    postMessage(data) { for (const fn of listeners) fn({ source: win, data }); },
    location: { origin: 'https://www.google.com' }
  };
  const enable = () => win.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features: { reviews: true } });

  const sandbox = {
    window: win,
    document: {
      querySelectorAll: (sel) => (sel.includes('script') ? [script]
        : sel.includes('aria-selected') ? (selectedTab ? [selectedTab] : [])
        : sel.startsWith('button') ? buttons
        : sel.includes('data-gm-reviews-more') ? buttons.filter((b) => b.attrs['data-gm-reviews-more'])
        : []),
      createTreeWalker: () => ({ nextNode: () => null }),
      querySelector: () => null,
      addEventListener(type, fn) { if (type === 'click') clicks.push(fn); },
      documentElement: {},
      get body() { return withBody ? {} : null; }
    },
    console: { log: (...args) => logs.push(args.join(' ')), debug() {}, warn: (...args) => logs.push(args.join(' ')) },
    fetch: async () => { asks++; if (error) throw error; return { status, text: async () => text }; },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
    setTimeout, clearTimeout,
    setInterval: (fn) => { intervals.add(fn); return fn; }, clearInterval: (fn) => intervals.delete(fn),
    Object, Reflect, Map, Set, Array, JSON, RegExp, String, Function, Promise,
    NodeFilter: { SHOW_ELEMENT: 1 }
  };
  sandbox.globalThis = sandbox;
  win._ = root;

  const keys = Object.keys(sandbox);
  new Function(...keys, source)(...keys.map((k) => sandbox[k]));
  if (enabled) enable();
  await wait(50);
  return {
    ...win.__GM_REVIEWS__.learned(), logs, enable, win,
    addButton: (label) => {
      withBody = true;
      const attrs = {}, shown = { display: '' };
      const button = { attrs, shown, getAttribute: (k) => (k === 'aria-label' ? label : attrs[k] ?? null),
        setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; },
        textContent: label,
        style: { setProperty: (k, v) => { shown.display = v; }, removeProperty: () => { shown.display = ''; } } };
      buttons.push(button);
      return button;
    },
    selectTab: (name) => { selectedTab = name ? { getAttribute: () => name, textContent: name } : null; },
    click: (label) => {
      const button = { getAttribute: () => label, textContent: label, setAttribute() { this.rewritten = true; } };
      const event = { target: { closest: () => button }, stopped: false,
        preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      for (const fn of clicks) fn(event);
      return { stopped: event.stopped, prevented: !!event.prevented, rewritten: !!button.rewritten };
    },
    tick: () => { for (const fn of [...intervals]) fn(); },
    mutate: () => { for (const fn of observers) fn(); },
    recover: () => { status = 200; error = null; },
    asks: () => asks, intervals: () => intervals.size
  };
}

// The same words in the three builds, under different names.
const old = await learnFrom('maps-2026-09-25.js');
const now = await learnFrom('maps-2026-09-29.js');
const latest = await learnFrom('maps-2026-10-23.js');
const plain = await learnFrom('maps-2026-10-06.js');

t.check('Sep 25 build: finds the sign-in check', old.check === 'xyd' && old.detector === 'field4-regex');
t.check('Sep 29 build: finds it under its new name', now.check === 'tW' && now.detector === 'field4-regex');
t.check('Oct 23 build: finds the inlined field-259 gate', latest.check === 'JK' && latest.detector === 'structural-fallback');
t.check('Oct 23 build: reads the Reviews tab label', latest.reviewsTab === 'Reviews');
t.check('Oct 6 build: finds the gate', plain.check === 'EW' && plain.detector === 'field4-regex');
t.check('Oct 6 build: learns both counted button labels', plain.countedLabels.includes('More reviews') && plain.countedLabels.includes('See more reviews'));
t.check('Oct 23 build: reads the templated see-more label', latest.seeMore === 'See more reviews');

for (const [label, got] of [['Sep 25', old], ['Sep 29', now]]) {
  t.check(`${label}: reads the see-more label`, got.seeMore === "Voir plus d'avis");
  t.check(`${label}: reads the reviews tab name`, got.reviewsTab === 'Avis');
  t.check(`${label}: reads the limited-view sentence`,
    got.notice.startsWith('Vous voyez un affichage limité de Google'));
}

t.check('disabled discovery stays quiet', old.logs.length === 0 && now.logs.length === 0 && latest.logs.length === 0);
old.enable();
old.enable();
t.check('enabling after discovery emits one result', old.logs.length === 1 && old.logs[0] === '[GM-REVIEWS] discovery ok detector=field4-regex');
const enabled = await learnFrom('maps-2026-10-23.js', { enabled: true });
t.check('enabled discovery emits one success', enabled.logs.length === 1 && enabled.logs[0] === '[GM-REVIEWS] discovery ok detector=structural-fallback');
const missing = await learnFrom(null, { enabled: true, text: 'unrelated bundle' });
t.check('missing gate emits one failure', missing.logs.length === 1 && missing.logs[0] === '[GM-REVIEWS] discovery failed reason=gate-not-found');
const offline = await learnFrom(null, { enabled: true, text: '', error: new Error('offline') });
t.check('fetch failure logs reason, not Error object', offline.logs.length === 1 && offline.logs[0] === '[GM-REVIEWS] discovery failed reason=offline');

const http = await learnFrom('maps-2026-09-25.js', { enabled: true, status: 503 });
t.check('HTTP error body is not learned', !http.check && http.logs[0] === '[GM-REVIEWS] discovery failed reason=HTTP 503');
http.recover();
http.mutate();
await wait(0);
t.check('failed bundle can be fetched again', http.asks() === 2 && http.logs.at(-1) === '[GM-REVIEWS] discovery ok detector=field4-regex');

const delayed = await learnFrom('maps-2026-09-25.js', { enabled: true, root: null });
t.check('missing root does not report success', delayed.logs.length === 0 && delayed.intervals() === 1);
delayed.win._ = { xyd: (value) => value };
delayed.tick();
t.check('success follows installation', delayed.logs.length === 1 && delayed.intervals() === 0 && delayed.win._.xyd(true) === false);
delayed.win.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features: { reviews: false } });
t.check('disabled wrapper delegates original function', delayed.win._.xyd(true) === true);

for (const [label, root] of [
  ['nonconfigurable gate', Object.defineProperty({}, 'xyd', { value: () => true })],
  ['foreign accessor', Object.defineProperty({}, 'xyd', { configurable: true, get: () => () => true })],
  ['nonextensible root', Object.preventExtensions({})]
]) {
  const got = await learnFrom('maps-2026-09-25.js', { enabled: true, root });
  t.check(`${label}: no premature success`, got.logs.length === 0);
  for (let i = 0; i < 50; i++) got.tick();
  t.check(`${label}: one bounded install failure`, got.intervals() === 0 && got.logs.length === 1 && got.logs[0] === '[GM-REVIEWS] discovery failed reason=wrap-failed');
  got.win._ = {};
  got.enable();
  t.check(`${label}: re-enable retries install`, got.win._.xyd() === false && got.logs.at(-1) === '[GM-REVIEWS] discovery ok detector=field4-regex');
}

// Clicks: the Reviews tab button is stopped before Maps can open the sign-in
// dialog; the overview button is pointed at the list action.
const clicky = await learnFrom('maps-2026-10-06.js', { enabled: true });
clicky.selectTab('Reviews');
t.check('Reviews tab: "More reviews (12)" is stopped', clicky.click('More reviews (12)').stopped);
t.check('Reviews tab: "More reviews" without a count is stopped', clicky.click('More reviews').stopped);
t.check('Reviews tab: unrelated buttons are untouched', !clicky.click('Write a review').stopped);
clicky.selectTab(null);
t.check('Overview: nothing is stopped', !clicky.click('See more reviews (12)').stopped);
t.check('Overview: "See more reviews (12)" is routed to the list', clicky.click('See more reviews (12)').rewritten);
// The button itself: hidden on the Reviews tab, back on the overview.
const more = await learnFrom('maps-2026-10-06.js', { enabled: true });
const moreButton = more.addButton('More reviews (12)');
const otherButton = more.addButton('Write a review');
more.selectTab('Reviews');
more.mutate();
await wait(300);
t.check('Reviews tab: the more-reviews button is hidden', moreButton.shown.display === 'none');
t.check('Reviews tab: other buttons stay', otherButton.shown.display === '');
more.selectTab(null);
more.mutate();
await wait(300);
t.check('Overview: the button is shown again', moreButton.shown.display === '');
more.selectTab('Reviews');
more.mutate();
await wait(300);
more.win.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features: { reviews: false } });
t.check('Feature off: the button is restored', moreButton.shown.display === '');

const off = await learnFrom('maps-2026-10-06.js');
off.selectTab('Reviews');
t.check('Feature off: clicks are left alone', !off.click('More reviews (12)').stopped);

process.exit(t.done());
