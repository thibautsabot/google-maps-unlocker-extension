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

// Just enough of the extension APIs for the background, which keeps the list
// of tabs waiting for a reload and clears one when its page says hello.
export function fakeBrowser({ features = { hours: false, photos: true }, pending = {} } = {}) {
  const store = { features, reloadPending: pending };
  const listeners = {};
  const did = [];
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });

  const browser = {
    storage: {
      local: {
        get: async (keys) => {
          const wanted = typeof keys === 'string' ? [keys] : keys;
          return Object.fromEntries(wanted.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
        },
        set: async (values) => { Object.assign(store, structuredClone(values)); did.push(`set ${Object.keys(values)}`); },
        remove: async (keys) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete store[key]; }
      },
      onChanged: on('storage-changed')
    },
    runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup') },
    tabs: { onRemoved: on('tab-removed') }
  };

  return { browser, listeners, did, store, pendingNow: () => structuredClone(store.reloadPending) };
}

// --- running the background -------------------------------------------------

export function loadBackground(world, { quiet = true } = {}) {
  const src = BACKGROUND_FILES().map(read).join('\n');

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
  // and the work happens after it returns. Settling here makes each step land
  // before the next one starts.
  return async (msg, tabId = 1, settle = 60) => {
    world.listeners.message(msg, { tab: { id: tabId } });
    await wait(settle);
  };
}

// --- running the page scripts -----------------------------------------------

// Replies and requests in the shape captured from Maps (tests/lib/real.mjs),
// with only the counts varied. They were once invented to match the code,
// which is how a wrong slot and a broken viewer check both passed.
// Real tokens are hundreds of characters; the reader finds one by that, so a
// short test name is padded out to look like one.
export const longToken = (name) => (name == null ? null : `${name}-${'A'.repeat(300)}`);

export const galleryReply = (photos, total, token = 'token', first = 0) => frame('hspqX',
  page(Array.from({ length: photos }, (_, i) => photo(`PHOTO${first + i}`)), total, 'session', longToken(token), false));

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

class FakeResponse {
  constructor(body, init = {}) {
    this._body = body;
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? '';
    this.headers = init.headers ?? {};
    // A fetched response has these; a constructed one does not.
    this.url = init.url ?? '';
    this.type = init.type ?? 'default';
    this.redirected = init.redirected ?? false;
  }
  async text() { return this._body; }
  clone() { return new FakeResponse(this._body, this); }
}

// A reply framed the way the server frames it, measured on real replies: each
// chunk is "<n>\n<json>\n" where n is the json's UTF-8 length plus two, and
// the last chunk has no newline after it. Tests build their "server" text with
// this so they cannot agree with a parser that has the rule wrong.
export const serverReply = (chunks, { finalNewline = false } = {}) => {
  const bytes = (text) => new TextEncoder().encode(text).length;
  return `)]}'\n\n${chunks.map((json) => `${bytes(json) + 2}\n${json}`).join('\n')}${finalNewline ? '\n' : ''}`;
};

// A Request that behaves like the real one where it matters here: sending it
// uses up the body, and cloning a used body throws.
class FakeRequest {
  constructor(url, init = {}) {
    this.url = url;
    this.method = init.method || 'GET';
    this.body = init.body ?? null;
    this.bodyUsed = false;
  }

  clone() {
    if (this.bodyUsed) throw new TypeError('Request.clone: Body has already been consumed.');
    return new FakeRequest(this.url, { method: this.method, body: this.body });
  }

  async text() {
    this.bodyUsed = true;
    return this.body ?? '';
  }
}

export function loadPage({
  url = 'https://www.google.com/maps/place/X/@48.86,2.35,15z',
  localStorage = storage(),
  sessionStorage = storage()
} = {}) {
  const logs = [];
  const messageListeners = [];
  const scrollListeners = [];

  const win = {
    addEventListener: (type, fn) => { if (type === 'message') messageListeners.push(fn); },
    postMessage: (data) => {
      for (const fn of messageListeners) fn({ source: win, data });
    },
    location: { href: url, origin: 'https://www.google.com' },
    fetch: async (input, init) => {
      // Sending a Request uses its body up, as a real fetch does.
      if (input instanceof FakeRequest) input.bodyUsed = true;
      (win.fetchCalls ||= []).push({ url: typeof input === 'string' ? input : input?.url, init });
      // A queue of replies, one per call, for a test that walks several pages.
      // A test can answer by what was asked instead of by order.
      const answered = win.fetchAnswer && init ? win.fetchAnswer(init) : undefined;
      const text = answered !== undefined ? answered
        : win.fetchReplies?.length ? win.fetchReplies.shift() : (win.fetchReplyText ?? '');
      return new FakeResponse(text, {
        status: 200, url: typeof input === 'string' ? input : input?.url, type: 'basic', redirected: false
      });
    },
    XMLHttpRequest: function () {},
    sessionStorage
  };
  win.nativeSends = [];
  win.XMLHttpRequest.prototype = { open() {}, send() { win.nativeSends.push(this); }, addEventListener() {} };

  // Page scripts need enough DOM to start. Keep mutation observers and
  // attribute/element stubs for the hours preload tests.
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
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: element,
    images: [],
    addEventListener: (type, fn) => { if (type === 'scroll') scrollListeners.push(fn); },
    scrollingElement: null,
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
    MutationObserver: class {
      constructor(fn) { this.fn = fn; (sandbox.observers ||= []).push(this); }
      observe() {}
      disconnect() {}
    },
    getComputedStyle: () => ({ getPropertyValue: () => '', display: 'block' }),
    sessionStorage: win.sessionStorage, localStorage, XMLHttpRequest: win.XMLHttpRequest, fetch: win.fetch,
    Request: FakeRequest, Response: FakeResponse
  };
  sandbox.globalThis = sandbox;

  const keys = Object.keys(sandbox);
  new Function(...keys, PAGE_FILES().map(read).join('\n'))(...keys.map((k) => sandbox[k]));

  return {
    win, logs,
    observers: () => sandbox.observers || [],
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
    // Delivers a reply the way Maps now does, as fetch(new Request(...)) with
    // the body inside the Request and no second argument.
    replyByRequest: async (text, body) => {
      win.fetchReplyText = text;
      const request = new FakeRequest(
        'https://www.google.com/maps/_/MapsWizUi/data/batchexecute?rpcids=hspqX', { method: 'POST', body });
      await win.fetch(request);
      await wait(20);
    },
    // The reply the page's own code gets back for a gallery call sent as
    // fetch(new Request(...)), after any hook has had its say. replies are
    // the server's answers in order: the first goes to Maps' own call and the
    // rest to whatever follow-up requests the hook makes.
    receiveByRequest: async (replies, body) => {
      win.fetchReplies = [...replies];
      win.fetchCalls = [];
      const request = new FakeRequest(
        'https://www.google.com/maps/_/MapsWizUi/data/batchexecute?rpcids=hspqX', { method: 'POST', body });
      const response = await win.fetch(request);
      await wait(20);
      return response;
    },
    // Any batchexecute call sent as fetch(new Request(...)), by rpc name, for
    // calls that are not the gallery. Returns the response the page receives.
    receiveRpc: async (rpc, replies, body = 'f.req=%5B%5D') => {
      win.fetchReplies = [...replies];
      win.fetchCalls = [];
      const request = new FakeRequest(
        `https://www.google.com/maps/_/MapsWizUi/data/batchexecute?rpcids=${rpc}`, { method: 'POST', body });
      const response = await win.fetch(request);
      await wait(20);
      return response;
    },
    // The same call with the body in the second argument, as older Maps did.
    replyByFetch: async (text, body) => {
      win.fetchReplyText = text;
      await win.fetch('https://www.google.com/maps/_/MapsWizUi/data/batchexecute?rpcids=hspqX', { method: 'POST', body });
      await wait(20);
    },
    // The grid scrolled to its end (or not), as a scroll event on a pane.
    scrollEvent: (pane) => { for (const fn of scrollListeners) fn({ target: pane }); },
    // What the page read from the first gallery reply, and from the page after
    // it. Empty until a gallery has replied.
    outcomes: () => (win.__GM_GALLERY__?.seen
      ? [{ firstPage: win.__GM_GALLERY__.firstPage, serverTotal: win.__GM_GALLERY__.serverTotal,
        asked: win.__GM_GALLERY__.asked }]
      : []),
    paged: () => (win.__GM_GALLERY__?.paged === null || win.__GM_GALLERY__?.paged === undefined
      ? [] : [{ photos: win.__GM_GALLERY__.paged }])
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
