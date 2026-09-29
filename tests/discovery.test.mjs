// Discovery: what the review script learns from the Maps script it fetches.
//
// Maps renames its functions and reshapes its code in every release, and this
// broke twice in one week: a renamed check, then a label compiled as a
// template literal. The fixtures are the parts of two real Maps builds that
// discovery reads. When Maps changes again and the feature goes quiet, save
// the new build's slices here and this fails until the extractors follow.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, suite, wait } from './lib/harness.mjs';

const t = suite('discovery');
const source = readFileSync(join(ROOT, 'reviews/ungate.js'), 'utf8');

async function learnFrom(fixture) {
  const text = readFileSync(join(ROOT, 'tests/fixtures', fixture), 'utf8');
  const script = { src: 'https://www.google.com/maps/_/js/k=maps.m.fr.X/m=Y' };
  const win = { addEventListener() {}, postMessage() {}, location: { origin: 'https://www.google.com' } };

  const sandbox = {
    window: win,
    document: {
      querySelectorAll: (sel) => (sel.includes('script') ? [script] : []),
      querySelector: () => null,
      addEventListener() {},
      documentElement: {},
      body: null
    },
    console: { log() {}, debug() {}, warn() {} },
    fetch: async () => ({ text: async () => text }),
    MutationObserver: class { observe() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    Object, Reflect, Map, Set, Array, JSON, RegExp, String, Function, Promise,
    NodeFilter: { SHOW_ELEMENT: 1 }
  };
  sandbox.globalThis = sandbox;
  win._ = {};

  const keys = Object.keys(sandbox);
  new Function(...keys, source)(...keys.map((k) => sandbox[k]));
  await wait(50);
  return win.__GM_REVIEWS__.learned();
}

// The same words in the two builds, under different names.
const old = await learnFrom('maps-2026-09-25.js');
const now = await learnFrom('maps-2026-09-29.js');

t.check('Sep 25 build: finds the sign-in check', old.check === 'xyd');
t.check('Sep 29 build: finds it under its new name', now.check === 'tW');

for (const [label, got] of [['Sep 25', old], ['Sep 29', now]]) {
  t.check(`${label}: reads the see-more label`, got.seeMore === "Voir plus d'avis");
  t.check(`${label}: reads the reviews tab name`, got.reviewsTab === 'Avis');
  t.check(`${label}: reads the limited-view sentence`,
    got.notice.startsWith('Vous voyez un affichage limité de Google'));
}

process.exit(t.done());
