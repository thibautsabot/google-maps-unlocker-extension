// A short place reply (today only) is asked for again. These use the shapes
// captured from Maps on 6 October: one date for a short reply, seven for a
// full one, in English and in French.

import { loadPage, read, suite, wait } from './lib/harness.mjs';

const t = suite('hours-reply');

const row = (name, n, d) => `["${name}",${n},[2026,10,${d}],[["10\\u202fam–8\\u202fpm",[[10],[20]]]],0,1]`;
const short = `[[${row('Tuesday', 2, 6)}],[${row('Tuesday', 2, 6)},0,1,null,["Open"]]]`;
const full = `[[${['Tuesday,2,6', 'Wednesday,3,7', 'Thursday,4,8', 'Friday,5,9', 'Saturday,6,10', 'Sunday,7,11', 'Monday,1,12']
  .map((s) => { const [a, b, c] = s.split(','); return row(a, Number(b), Number(c)); }).join(',')}]]`;
const french = `[[${row('mardi', 2, 6)},${row('mercredi', 3, 7)}]]`;

const page = loadPage();
const hours = page.win.__GM_HOURS_REPLY__;

t.check('the hook is exposed', !!hours);
t.check('short reply: one date, counted once although it appears twice', hours.days(short) === 1);
t.check('short reply is recognised as short', hours.isShort(short));
t.check('full reply: seven dates', hours.days(full) === 7);
t.check('full reply is not short', !hours.isShort(full));
t.check('French names count the same way', hours.days(french) === 2);
t.check('a place with no hours is not called short', !hours.isShort('[null,[]]'));
t.check('only the place endpoint is matched',
  hours.isPlace('https://www.google.com/maps/preview/place?pb=1')
  && !hours.isPlace('https://www.google.com/maps/preview/log204?pb=1'));

// Asks again until whole: short, short, full -> the full one, three asks at most.
{
  let asked = 0;
  const replies = [short, short, full];
  const got = await hours.fuller('u', short, async () => replies[asked++]);
  t.check('asks again until the reply is whole', got === full && asked === 3);
}
{
  let asked = 0;
  const got = await hours.fuller('u', short, async () => { asked++; return short; });
  t.check('gives up after three tries and keeps what it has', got === short && asked === 3);
}
{
  const got = await hours.fuller('u', short, async () => { throw new Error('offline'); });
  t.check('a failed refetch keeps the original reply', got === short);
}

// The first place request leaves before the switch state reaches the page.
// It is held until the state arrives, and let go after 400 ms regardless.
const PLACE = 'https://www.google.com/maps/preview/place?pb=1';
const place = (p) => {
  const xhr = new p.win.XMLHttpRequest();
  p.win.XMLHttpRequest.prototype.open.call(xhr, 'GET', PLACE);
  p.win.XMLHttpRequest.prototype.send.call(xhr);
  return xhr;
};
const state = (p, hours) => p.win.postMessage({ source: 'gm-native-maps', type: 'gm-settings', features: { hours } });

{
  const p = loadPage();
  place(p);
  t.check('state unknown: the place request is held, not sent', p.win.nativeSends.length === 0);
  state(p, false);
  t.check('switch off arrives: the held request is sent untouched', p.win.nativeSends.length === 1);
}
{
  const p = loadPage();
  place(p);
  await wait(500);
  t.check('state never arrives: the request is sent after the hold', p.win.nativeSends.length === 1);
}
{
  const p = loadPage();
  state(p, false);
  place(p);
  t.check('state known and off: sent at once', p.win.nativeSends.length === 1);
}
{
  const p = loadPage();
  state(p, false);
  const other = new p.win.XMLHttpRequest();
  p.win.XMLHttpRequest.prototype.open.call(other, 'GET', 'https://www.google.com/maps/preview/log204?pb=1');
  p.win.XMLHttpRequest.prototype.send.call(other);
  t.check('other requests are never touched', p.win.nativeSends.length === 1);
}

// Exercise complete place actions without other feature hooks or browser APIs.
async function replyAction(replies, { beforeState, afterSend, method = 'GET', async = true, enabled = true } = {}) {
  const logs = [];
  const sent = [];
  const listeners = [];
  const win = { XMLHttpRequest: function () {}, addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); } };
  win.XMLHttpRequest.prototype = { open(method, url) { this.url = url; }, send() { sent.push(this); }, abort() { this.aborted = true; } };
  let asks = 0;
  const sandbox = {
    window: win, XMLHttpRequest: win.XMLHttpRequest,
    document: { querySelectorAll: () => [], addEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    console: { log: (...args) => logs.push(args.join(' ')), warn: (...args) => logs.push(args.join(' ')) },
    fetch: async () => {
      const text = replies[asks++];
      if (text instanceof Error) throw text;
      return typeof text === 'object' && text !== null ? text : { status: 200, text: async () => text };
    },
    URL: { createObjectURL: (blob) => { win.delivered = blob.text; return 'blob:reply'; }, revokeObjectURL() {} },
    Blob: class { constructor(parts) { this.text = parts.join(''); } },
    setTimeout() {}, Date, AbortController
  };
  const keys = Object.keys(sandbox);
  new Function(...keys, read('hours/reply.js'))(...keys.map((key) => sandbox[key]));
  const settings = (hours) => {
    for (const fn of listeners) fn({ source: win, data: { source: 'gm-native-maps', type: 'gm-settings', features: { hours } } });
  };
  const xhr = new win.XMLHttpRequest();
  if (!beforeState) settings(enabled);
  xhr.open(method, PLACE, async);
  xhr.send();
  if (beforeState) { beforeState(xhr); settings(enabled); }
  afterSend?.(xhr, settings);
  await wait(0);
  return { logs, sent, asks, text: win.delivered, xhr };
}

for (const [label, replies, status, delivered, asks, detail] of [
  ['refetched week', [short, short, full], 'ok', full, 3, 'days=1->7 tries=2'],
  ['full week', [full], 'unchanged', full, 1, 'days=7->7 tries=0'],
  ['no hours', ['[null,[]]'], 'unchanged', '[null,[]]', 1, 'reason=no-hours'],
  ['still today', [short, short, short, short], 'failed', short, 4, 'reason=today-only'],
  ['partial week', [short, french, french, french], 'failed', french, 4, 'reason=incomplete-week'],
  ['partial to full', [french, full], 'ok', full, 2, 'days=2->7 tries=1'],
  ['initial HTTP failure', [{ status: 503, text: async () => full }], 'failed', undefined, 1, 'reason=HTTP 503'],
  ['retry HTTP failure', [short, { status: 503, text: async () => full }], 'failed', short, 2, 'reason=HTTP 503'],
  ['refetch failure', [short, new Error('offline')], 'failed', short, 2, 'reason=offline'],
  ['initial failure', [new Error('offline')], 'failed', undefined, 1, 'reason=offline']
]) {
  const got = await replyAction(replies);
  t.check(`${label}: preserves reply and request count`, got.text === delivered && got.asks === asks && got.sent.length === 1);
  t.check(`${label}: emits one result only`, got.logs.length === 1 && got.logs[0].startsWith(`[GM-HOURS] reply ${status} `) && got.logs[0].includes(detail));
  if (label === 'initial failure') t.check('initial failure falls back to original URL', got.xhr.url === PLACE);
}
t.check('refetch helper emits no progress logs', page.logs.length === 0);
t.check('two-day week is incomplete', hours.isShort(french));
for (const [label, options, sends, asks] of [
  ['abort held request', { beforeState: (xhr) => xhr.abort() }, 0, 0],
  ['reopen held request', { beforeState: (xhr) => xhr.open('POST', '/other') }, 0, 0],
  ['abort fetching request', { afterSend: (xhr) => xhr.abort() }, 0, 1],
  ['reopen fetching request', { afterSend: (xhr) => xhr.open('POST', '/other') }, 0, 1],
  ['disable fetching request', { afterSend: (xhr, settings) => settings(false) }, 1, 1],
  ['synchronous GET bypass', { async: false }, 1, 0],
  ['POST bypass', { method: 'POST' }, 1, 0],
  ['disabled GET bypass', { enabled: false }, 1, 0]
]) {
  const got = await replyAction([short, full], options);
  t.check(`${label}: retains native lifecycle`, got.sent.length === sends && got.asks === asks && got.text === undefined && got.logs.length === 0);
}

// --- the preload tag ------------------------------------------------------------
// Maps' first place request is a <link rel=preload> in the page's own head,
// sent before any script runs. It is set aside so Maps asks for the place
// itself, and put back if the switch turns out to be off.
const preloadTag = (href = '/maps/preview/place?pb=1', rel = 'preload') => {
  const attrs = { rel, href };
  const parent = { inserted: [], insertBefore(node) { this.inserted.push(node); node.parentNode = this; } };
  return {
    nodeType: 1, localName: 'link', parentNode: parent, nextSibling: null, attrs,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
    remove() { this.parentNode = null; }
  };
};
const seen = (p, node) => p.observers().forEach((o) => o.fn([{ addedNodes: [node] }]));

{
  const p = loadPage();
  const tag = preloadTag();
  seen(p, tag);
  t.check('place preload: taken out of the page', tag.parentNode === null);
  t.check('place preload: rel set aside so the browser ignores it', tag.attrs.rel === 'gm-held');
  state(p, true);
  t.check('switch on: the tag stays aside', tag.parentNode === null);
  t.check('switch on: setup stays quiet', p.logs.length === 0);
}
{
  const p = loadPage();
  const tag = preloadTag();
  const parent = tag.parentNode;
  seen(p, tag);
  state(p, false);
  t.check('switch off: the tag is put back', parent.inserted.includes(tag));
  t.check('switch off: with its original rel', tag.attrs.rel === 'preload' && !('data-gm-rel' in tag.attrs));
  t.check('switch off: nothing is logged', p.logs.length === 0);
}
{
  const p = loadPage();
  const other = preloadTag('/maps/_/js/k=maps.js');
  const stylesheet = preloadTag('/maps/preview/place?pb=1', 'stylesheet');
  seen(p, other);
  seen(p, stylesheet);
  t.check('other links are left alone', other.parentNode !== null && stylesheet.parentNode !== null);
}
{
  const p = loadPage();
  const first = preloadTag();
  const second = preloadTag();
  seen(p, first);
  seen(p, second);
  t.check('only one tag is set aside', first.parentNode === null && second.parentNode !== null);
}

{
  const p = loadPage();
  state(p, false);
  const tag = preloadTag();
  seen(p, tag);
  t.check('disabled observer leaves future preload untouched', tag.parentNode !== null && tag.attrs.rel === 'preload');
}
{
  const p = loadPage();
  const tag = preloadTag();
  const parent = tag.parentNode;
  seen(p, tag);
  place(p);
  await wait(500);
  t.check('settings timeout restores held preload', parent.inserted.includes(tag) && tag.attrs.rel === 'preload');
}

process.exit(t.done());
