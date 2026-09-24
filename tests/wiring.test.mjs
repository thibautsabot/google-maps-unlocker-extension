// The checks that catch a split or a rename going wrong. Each of these
// stood for a real failure: files parse alone but clash in one scope, a
// message type relayed but never handled, a field dropped in the relay.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, read, manifest, BACKGROUND_FILES, PAGE_FILES, suite } from './lib/harness.mjs';

const t = suite('wiring');
const m = manifest();

// --- every file the manifest names exists ----------------------------------
{
  const named = [
    ...BACKGROUND_FILES(),
    ...m.content_scripts.flatMap((s) => s.js),
    m.background.service_worker,
    m.action?.default_popup
  ].filter(Boolean);

  const missing = named.filter((f) => !existsSync(join(ROOT, f)));
  t.check(`every file the manifest names exists (${named.length} named)`, missing.length === 0);
  if (missing.length) console.log('        missing:', missing.join(', '));
}

// --- the service worker loads the same list, in the same order -------------
{
  const worker = read(m.background.service_worker);
  const imported = [...worker.matchAll(/'([\w./-]+\.js)'/g)].map((x) => x[1]);
  const expected = ['common/compat.js', ...BACKGROUND_FILES()];

  t.check('Chrome loads the same background files as Firefox, in order',
    JSON.stringify(imported) === JSON.stringify(expected));
  if (JSON.stringify(imported) !== JSON.stringify(expected)) {
    console.log('        worker:  ', imported.join(', '));
    console.log('        manifest:', expected.join(', '));
  }
}

// --- one shared scope, so nothing may be declared twice --------------------
for (const [label, files] of [['background', BACKGROUND_FILES()], ['page', PAGE_FILES()]]) {
  const combined = files.map(read).join('\n');
  const names = [...combined.matchAll(/^\s*(?:const|let|var|async function|function)\s+(\w+)/gm)]
    .map((x) => x[1]);

  // Page scripts are each wrapped in their own IIFE, so only their top
  // level would clash; the background files share one scope outright.
  const top = label === 'background'
    ? [...combined.matchAll(/^(?:const|let|var|async function|function)\s+(\w+)/gm)].map((x) => x[1])
    : [];

  const dupes = [...new Set(top.filter((n) => top.filter((x) => x === n).length > 1))];
  t.check(`${label}: nothing is declared twice in the shared scope`, dupes.length === 0);
  if (dupes.length) console.log('        declared twice:', dupes.join(', '));

  let parses = true;
  try { new Function(combined); } catch (error) {
    parses = false;
    console.log(`        ${label} fails when concatenated:`, error.message);
  }
  t.check(`${label}: the files parse together as the browser loads them`, parses);
  void names;
}

// --- messages: sent, relayed, handled --------------------------------------
{
  const page = PAGE_FILES().map(read).join('\n');
  const bridge = read(m.content_scripts.find((s) => s.world !== 'MAIN').js.at(-1));
  const catalogue = read('common/features.js');
  const background = BACKGROUND_FILES().map(read).join('\n');

  const sent = new Set([
    ...[...page.matchAll(/ask\('([\w-]+)'/g)].map((x) => x[1]),
    ...[...page.matchAll(/tell\(\{ type: '([\w-]+)'/g)].map((x) => x[1])
  ]);
  const relayed = new Set(
    [...bridge.match(/\[([^\]]*)\]\.includes/s)[1].matchAll(/'(gm-[\w-]+)'/g)].map((x) => x[1]));
  const handled = new Set([...background.matchAll(/handles\([^,]+, '([\w-]+)'/g)].map((x) => x[1]));

  const dropped = [...sent].filter((type) => !relayed.has(type));
  const ignored = [...sent].filter((type) => !handled.has(type));
  const dead = [...relayed].filter((type) => !sent.has(type));

  t.check('every message the page sends is relayed', dropped.length === 0);
  if (dropped.length) console.log('        dropped:', dropped.join(', '));

  t.check('every message the page sends is handled', ignored.length === 0);
  if (ignored.length) console.log('        unhandled:', ignored.join(', '));

  t.check('the relay allows nothing that is never sent', dead.length === 0);
  if (dead.length) console.log('        dead:', dead.join(', '));

  // The relay forwards the whole payload; listing fields by hand dropped one
  // silently once, and the feature looked broken rather than unwired.
  t.check('the relay forwards the payload whole, not field by field',
    /\.\.\.payload|const \{ source, \.\.\.payload \}/.test(bridge));
}

// --- the background must not touch the DOM ---------------------------------
{
  const background = BACKGROUND_FILES().map(read).join('\n');
  const dom = [...background.matchAll(/\b(document|window|localStorage|sessionStorage)\./g)]
    .map((x) => x[1]);

  t.check('the background touches no DOM, so Chrome can run it as a service worker',
    dom.length === 0);
  if (dom.length) console.log('        uses:', [...new Set(dom)].join(', '));
}

// --- the popup's idea of a Maps page matches the manifest's -----------------
{
  const popup = read('popup/popup.js');
  const pattern = popup.match(/(\/\^https:.*?\/)\.test\(/);
  const matches = m.content_scripts[0].matches;

  const test = pattern ? new RegExp(pattern[1].slice(1, -1)) : null;
  const agrees = test && matches.every((pat) =>
    test.test(pat.replace('*://', 'https://').replace('/*', '/place/X')));

  t.check('the popup offers to reload the same pages the extension runs on', !!agrees);
}

// --- a feature is only real if the catalogue, the folders and the manifest
// --- all agree about it -----------------------------------------------------
{
  const catalogue = read('common/features.js');
  const listed = [...catalogue.matchAll(/id: '(\w+)'/g)].map((x) => x[1]);
  const scripts = [...BACKGROUND_FILES(), ...m.content_scripts.flatMap((s) => s.js)];

  const withoutScripts = listed.filter((id) => !scripts.some((f) => f.startsWith(`${id}/`)));
  t.check(`every feature in the catalogue has scripts (${listed.join(', ')})`,
    withoutScripts.length === 0);
  if (withoutScripts.length) console.log('        no folder:', withoutScripts.join(', '));

  const folders = [...new Set(scripts.map((f) => f.split('/')[0]))]
    .filter((d) => d !== 'common' && d !== 'popup');
  const unlisted = folders.filter((d) => !listed.includes(d));
  t.check('every feature folder is in the catalogue', unlisted.length === 0);
  if (unlisted.length) console.log('        not in the catalogue:', unlisted.join(', '));
}

// --- every message handled belongs to a registered feature -----------------
{
  const background = BACKGROUND_FILES().map(read).join('\n');
  const registered = [...background.matchAll(/handles\((null|'(\w+)')/g)].map((x) => x[2] ?? null);
  const catalogue = read('common/features.js');
  const known = [...catalogue.matchAll(/id: '(\w+)'/g)].map((x) => x[1]);

  const strangers = [...new Set(registered.filter((f) => f && !known.includes(f)))];
  t.check('handlers are registered against features that exist', strangers.length === 0);
  if (strangers.length) console.log('        unknown feature:', strangers.join(', '));

  t.check('the dispatcher names no feature of its own',
    !/'(photos|hours)'/.test(read('common/dispatch.js')));
}

// --- versions agree ---------------------------------------------------------
{
  const readme = read('README.txt');
  const stated = readme.split('\n')[0].trim().split(/\s+/).pop();
  t.check(`the README states the manifest's version (${m.version})`, stated === m.version);
}

process.exit(t.done());
