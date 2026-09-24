// Enough of a browser to run the extension outside one.
//
// The background files are evaluated into a single scope, exactly as
// Firefox's background.scripts list and Chrome's importScripts do, with a
// fake browser.* in front of them. Nothing here talks to the network or to
// Google: every reply is handed in by the test.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { args, frame, page, photo } from './real.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (file) => readFileSync(join(ROOT, file), 'utf8');

export const manifest = () => JSON.parse(read('manifest.json'));

export const BACKGROUND_FILES = () => manifest().background.scripts;
export const PAGE_FILES = () =>
  manifest().content_scripts.find((s) => s.world === 'MAIN').js;

// --- a fake browser ---------------------------------------------------------

// Cookie stores are numbered like Chrome's rather than named like Firefox's,
// so the store lookup is exercised rather than the fallback.
export function fakeBrowser({
  features = { hours: false, photos: true },
  saved = null,
  jar = [cookie('NID', 'ordinary')],
  privateSession = () => [cookie('NID', 'fresh-private', { session: false })],
  privateOpen = false
} = {}) {
  const did = [];
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });

  const store = { features, ...(saved ? { goodRoll: saved } : {}) };
  let normal = [...jar];
  let priv = privateOpen ? privateSession() : [];
  let issued = 0;

  const browser = {
    storage: {
      local: {
        get: async (key) => (key in store ? { [key]: store[key] } : {}),
        set: async (patch) => { Object.assign(store, patch); },
        remove: async (key) => { delete store[key]; }
      },
      onChanged: on('storage')
    },

    cookies: {
      getAllCookieStores: async () => (priv.length || privateOpen
        ? [{ id: '0', tabIds: [1] }, { id: '1', tabIds: [99] }]
        : [{ id: '0', tabIds: [1] }]),

      getAll: async ({ storeId } = {}) => (
        storeId === '1' ? priv : storeId === '0' ? normal : [...normal, ...priv]),

      set: async (c) => {
        did.push(`cookie ${c.name}=${c.value}`);
        normal = normal.filter((x) => x.name !== c.name).concat([{ ...c, storeId: '0' }]);
      },

      remove: async ({ name, storeId }) => {
        if (storeId === '1') priv = priv.filter((c) => c.name !== name);
        else normal = normal.filter((c) => c.name !== name);
      },

      onChanged: on('cookie')
    },

    tabs: {
      query: async () => (priv.length || privateOpen
        ? [{ id: 1, incognito: false }, { id: 99, incognito: true }]
        : [{ id: 1, incognito: false }]),
      reload: async () => did.push('RELOAD'),
      update: async (id, { url }) => did.push(`OPEN ${url}`),
      sendMessage: async (id, m) => did.push((m.quiet ? 'log: ' : 'TOAST: ') + m.text),
      onRemoved: on('tab-removed')
    },

    windows: {
      create: async (options) => {
        issued++;
        did.push(`private window${options.focused === false ? ' (unfocused)' : ''}`);
        priv = privateSession(issued);
        return { id: issued };
      },
      remove: async () => { priv = []; }
    },

    runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup') }
  };

  return {
    browser,
    listeners,
    did,
    storage: store,
    jarNow: () => normal,
    privateNow: () => priv
  };
}

export const cookie = (name, value, extra = {}) => ({
  name, value, domain: '.google.com', path: '/', secure: true,
  session: false, expirationDate: 2000000000, storeId: '0', ...extra
});

export const savedSession = (cookies, agoMs = 60e3) => ({
  savedAt: Date.now() - agoMs,
  cookies: cookies.map(({ storeId, ...rest }) => rest)
});

// --- running the background -------------------------------------------------

// Borrowing waits real seconds for Google to issue cookies. A test should
// exercise the logic, not the patience.
const impatient = (src) => src
  .replace('waited < 15000', 'waited < 50')
  .replace('await sleep(500)', 'await sleep(5)')
  .replace('await sleep(2000)', 'await sleep(2)');

export function loadBackground(world, { quiet = true } = {}) {
  const src = impatient(BACKGROUND_FILES().map(read).join('\n'));

  const saveLog = console.log;
  const saveWarn = console.warn;
  if (quiet) { console.log = () => {}; console.warn = () => {}; }

  globalThis.browser = world.browser;
  try {
    new Function(src)();
  } finally {
    console.log = saveLog;
    console.warn = saveWarn;
  }

  // The real listener returns immediately — messages are fire-and-forget,
  // and the work happens after it returns. Awaiting the call therefore
  // waits for nothing, which let test steps overlap and report failures
  // that were only races in the test. Settling here makes each step land
  // before the next one starts.
  return async (msg, tabId = 1, settle = 120) => {
    world.listeners.message(msg, { tab: { id: tabId } });
    await wait(settle);
  };
}

// --- running the page scripts -----------------------------------------------

// Replies and requests in the shape captured from Maps (tests/lib/real.mjs),
// with only the counts varied. They were once invented to match the code,
// which is how a wrong slot and a broken viewer check both passed.
export const galleryReply = (photos, total) => frame('hspqX',
  page(Array.from({ length: photos }, (_, i) => photo(`PHOTO${i}`)), total, 'session', 'token', false));

const asking = (...calls) => new URLSearchParams({
  'f.req': JSON.stringify([calls.map(([rpc, a]) => [rpc, JSON.stringify(a), null, 'generic'])])
}).toString();

export const askingFor = (size) => asking(['hspqX', args(null, size)]);

// The same request with nothing in the page-size slot: what Google moving
// the field would leave behind. read.js is expected to say it does not know
// rather than pick the nearest integer that looks the part — and this
// request still carries a 20 and a 195 elsewhere to be tempted by.
export const askingBlind = () => asking(['hspqX', args(null, null)]);

// The photo request batched behind an unrelated call whose arguments happen
// to hold an integer in the same slot. Reading the first envelope finds 99.
export const askingBatched = (size) => asking(['otHeR', args(null, 99)], ['hspqX', args(null, size)]);

// Pass the same one to two loadPage calls to have the second load see what
// the first one stored, as reloads of one origin do.
export const storage = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
};

export function loadPage({
  url = 'https://www.google.com/maps/place/X/@48.86,2.35,15z',
  localStorage = storage()
} = {}) {
  const posted = [];
  const logs = [];
  const messageListeners = [];
  const scripts = new Map();

  const win = {
    addEventListener: (type, fn) => { if (type === 'message') messageListeners.push(fn); },
    postMessage: (data) => {
      posted.push(data);
      for (const fn of messageListeners) fn({ source: win, data });
    },
    location: { href: url, origin: 'https://www.google.com' },
    fetch: async () => ({ clone: () => ({ text: async () => '' }) }),
    XMLHttpRequest: function () {},
    sessionStorage: { getItem: () => null, setItem: () => {} }
  };
  win.XMLHttpRequest.prototype = { open() {}, send() {}, addEventListener() {} };

  // gallery-ui.js and page-hook.js touch the document, so there has to be
  // enough of one for them to start without throwing. None of these tests
  // assert on the DOM; they assert on what is reported.
  const element = () => ({
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild() {}, remove() {}, addEventListener() {}, closest: () => null,
    contains: () => false, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    children: [], textContent: '', innerHTML: ''
  });

  const doc = {
    readyState: 'complete',
    querySelectorAll: (sel) => (sel.includes('script') ? [...scripts.values()] : []),
    querySelector: () => null,
    createElement: element,
    images: [],
    addEventListener: () => {},
    head: element(),
    body: element()
  };

  const sandbox = {
    window: win, document: doc, location: win.location,
    console: {
      log: (...a) => logs.push(a.join(' ')), debug: () => {}, warn: (...a) => logs.push(a.join(' '))
    },
    setTimeout, clearTimeout, URLSearchParams, JSON, Set, Map, Array, Number, String,
    Object, RegExp, Math, Date, Promise,
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    getComputedStyle: () => ({ getPropertyValue: () => '', display: 'block' }),
    sessionStorage: win.sessionStorage, localStorage, XMLHttpRequest: win.XMLHttpRequest, fetch: win.fetch
  };
  sandbox.globalThis = sandbox;

  const keys = Object.keys(sandbox);
  new Function(...keys, PAGE_FILES().map(read).join('\n'))(...keys.map((k) => sandbox[k]));

  return {
    win, doc, scripts, posted, logs,
    api: () => win.GMGallery,
    switchOn: () => win.postMessage({
      source: 'gm-native-maps', type: 'gm-settings', features: { photos: true, hours: true }
    }),
    // Delivers a reply the way Maps does, over XHR.
    reply: (text, body) => {
      const xhr = new win.XMLHttpRequest();
      let loadend = null;

      xhr.__gm = 'https://www.google.com/batchexecute?rpcids=hspqX';
      xhr.addEventListener = (type, fn) => { if (type === 'loadend') loadend = fn; };
      xhr.status = 200;
      xhr.responseText = text;

      win.XMLHttpRequest.prototype.send.call(xhr, body);
      loadend?.();
    },
    sent: (type) => posted.filter((m) => m?.type === type)
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the smallest test framework that will do -------------------------------

export function suite(name) {
  const results = [];

  return {
    check(label, ok) {
      results.push({ label, ok: !!ok });
      console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`);
      return !!ok;
    },
    done() {
      const failed = results.filter((r) => !r.ok);
      console.log(`${name}: ${results.length - failed.length}/${results.length} passed\n`);
      return failed.length;
    }
  };
}
