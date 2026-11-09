// What the scripts running inside the page report, and when they keep quiet.

import { loadPage, galleryReply, askingFor, askingBlind, askingBatched, storage, suite, wait, serverReply, longToken }
  from './lib/harness.mjs';
import { read } from './lib/harness.mjs';
import { REQUEST_1, REQUEST_2, REPLY_1, REPLY_2, TOKEN_1, REQUEST_CAPPED, REPLY_CAPPED, frame, shifted, serverJson }
  from './lib/real.mjs';

const t = suite('page');

// Captured short gallery: 10 + 7 photos, then a null terminal list. Do not
// discard accumulated pages merely because Google's announced total is 20.
{
  const page = loadPage();
  page.switchOn();
  const capped = (count, token, first) => {
    const text = galleryReply(count, 20, token, first);
    const match = [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)][0];
    const payload = JSON.parse(JSON.parse(`"${match[1]}"`));
    payload[15] = true;
    return frame('hspqX', payload);
  };
  const terminal = [null, 20, null, 'session', null, longToken('T17'), null, null, null, null, true, null, null, ['category'], null, true];
  const response = await page.receiveByRequest([
    capped(10, 'OLD20', 0), capped(10, 'T10', 0), capped(7, 'T17', 10), frame('hspqX', terminal)
  ], askingFor(20));
  const text = await response.text();
  const match = [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)][0];
  const payload = JSON.parse(JSON.parse(`"${match[1]}"`));
  t.check('null terminal: retains all seventeen unique photos', payload[0].length === 17 && new Set(payload[0].map((p) => p[0])).size === 17);
  t.check('null terminal: removes exhausted continuation token', payload[5] === null);
  t.check('null terminal: preserves end marker, clears limited flag', payload[10] === true && payload[15] === null);
  t.check('null terminal: reports delivered count instead of original ten', page.logs.some((l) => l.includes('deliveredBatch=17 uniqueSupplied=17 announcedTotal=20 nextToken=none')));
  const requests = page.win.fetchCalls.slice(1).map((c) => JSON.parse(JSON.parse(new URLSearchParams(c.init.body).get('f.req'))[0][0][1]));
  t.check('null terminal: requests remaining three after ten plus seven', requests.map((args) => args[4][2][1]).join(',') === '10,10,3');
}

// Fixture framing is independent of production helpers, including both JSON
// layers and non-ASCII byte counts.
{
  t.check('fixture: Google escapes special characters but leaves slashes and Unicode',
    serverJson('<>&=/Café\u2028\u2029') === '"\\u003c\\u003e\\u0026\\u003d/Café\\u2028\\u2029"');
  const payload = ['Café=<x>&/\u2028'];
  const reply = frame('hspqX', payload);
  const [, , length, envelope] = reply.split('\n');
  t.check('fixture: frame length measures envelope UTF-8 bytes plus two',
    Number(length) === new TextEncoder().encode(envelope).length + 2
    && Number(length) > envelope.length + 2 && !reply.endsWith('\n'));
  t.check('fixture: nested escapes preserve the payload',
    envelope.includes('\\\\u003d') && JSON.stringify(JSON.parse(JSON.parse(envelope)[0][2])) === JSON.stringify(payload));
}

// --- obsolete session data is removed without clearing production state ------
{
  const session = storage();
  const local = storage();
  const obsolete = ['gmnx.tokenSamples', 'gmnx.researchSnapshots', 'gmnx.galleryUrl'];
  for (const key of obsolete) session.setItem(key, 'obsolete');
  session.setItem('gmnx.fillGrid', '0');
  session.setItem('unrelated', 'keep');
  const metadata = {
    'gmnx.pagingLayout': JSON.stringify({ hspqX: { size: [4, 3, 1], token: [4, 3, 2] } }),
    'gmnx.tokenSlot': JSON.stringify({ hspqX: 16 }),
    'gmnx.normalFlags': '[11]'
  };
  for (const [key, value] of Object.entries(metadata)) local.setItem(key, value);

  const page = loadPage({ sessionStorage: session, localStorage: local });
  page.switchOn();
  t.check('migration: obsolete session research data is removed on load',
    obsolete.every((key) => session.getItem(key) === null));
  t.check('migration: fill override and unrelated session data remain',
    session.getItem('gmnx.fillGrid') === '0' && page.api().fillGrid() === 'off' && session.getItem('unrelated') === 'keep');
  t.check('migration: learned paging metadata remains',
    Object.entries(metadata).every(([key, value]) => local.getItem(key) === value));
}

{
  const page = loadPage();
  page.switchOn();
  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'SKIPS20', 90), // discarded size-20 reply
    galleryReply(10, 116, 'CURSOR10', 0),
    galleryReply(10, 116, 'CURSOR20', 10)
  ], askingBatched(20));
  const text = await response.text();
  const payload = JSON.parse(JSON.parse(`"${[...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)][0][1]}"`));
  t.check('replay: discarded size-20 photos do not enter the list', payload[0][0][0] === 'PHOTO0' && payload[0].at(-1)[0] === 'PHOTO19');
  t.check('replay: merged list carries cursor20 from size-10 requests', payload[5] === longToken('CURSOR20'));
  const calls = page.win.fetchCalls.slice(1).map((c) => JSON.parse(new URLSearchParams(c.init.body).get('f.req')));
  t.check('replay: unrelated batched calls are not resent', calls.every((c) => c[0].length === 1 && c[0][0][0] === 'hspqX'));
  t.check('replay: first request restarts at null instead of SKIPS20', JSON.parse(calls[0][0][0][1])[4][2][2] === null);
}
// --- the same gallery call sent as fetch(new Request(...)) -------------------
// Maps moved the gallery call from XHR to fetch with the body inside the
// Request and no second argument. The body was never read, so every reply
// was ignored: no cap was seen and the grid stayed short.
{
  const page = loadPage();
  page.switchOn();
  await page.replyByRequest(galleryReply(10, 45), askingFor(20));

  const [outcome] = page.outcomes();
  t.check('fetch(Request): a capped reply is reported', !!outcome);
  t.check('fetch(Request):   served 10 of 45', outcome?.firstPage === 10 && outcome?.serverTotal === 45);
  t.check('fetch(Request):   having asked for 20', outcome?.asked === 20);
}
{
  const page = loadPage();
  page.switchOn();
  await page.replyByRequest(galleryReply(20, 45), askingFor(20));

  const [outcome] = page.outcomes();
  t.check('fetch(Request): an uncapped reply is reported as served 20', outcome?.firstPage === 20);
}
{
  const page = loadPage();
  page.switchOn();
  await page.replyByFetch(galleryReply(10, 45), askingFor(20));

  const [outcome] = page.outcomes();
  t.check('fetch(url, init): a capped reply is still reported', outcome?.firstPage === 10);
}
{
  const page = loadPage();
  await page.replyByRequest(galleryReply(10, 45), askingFor(20));
  t.check('fetch(Request) with the feature off: no extra request is made', (page.win.fetchCalls || []).length <= 1);
}

// --- GMGallery.capture() ----------------------------------------------------
// The shape of each exchange, for reading why a session was given what it
// was. It must not carry a photo URL: the output gets pasted into issues.
{
  const page = loadPage();
  page.switchOn();
  await page.replyByRequest(galleryReply(10, 45), askingFor(20));

  const shots = page.api().capture();
  t.check('capture: one exchange recorded', shots.length === 1);
  t.check('capture: the reply length and total are there',
    shots[0]?.calls[0]?.listLength === 10 && shots[0]?.calls[0]?.total === 45);
  t.check('capture: the request is described by its shape',
    shots[0]?.requests[0]?.rpc === 'hspqX' && shots[0]?.requests[0]?.argsLength > 0);
  t.check('capture: the paging slot is described as an array of fields',
    shots[0]?.requests[0]?.paging === 'array(5)');
  t.check('capture: no photo URL is kept', !JSON.stringify(shots).includes('googleusercontent'));
  t.check('capture: the caller gets a copy, not the live record',
    page.api().capture() !== page.api().capture());
}

// --- capture shows flags and counts with their value ---------------------------
{
  const page = loadPage();
  page.switchOn();
  await page.replyByRequest(galleryReply(10, 45), askingFor(20));

  const slots = page.api().capture()[0]?.calls[0]?.slots || [];
  const shown = Object.fromEntries(slots);
  t.check('capture: the announced total shows its number', shown[1] === 'number:45');
  t.check('capture: the more-pages flag shows its value', /^boolean:(true|false)$/.test(shown[10] || ''));
  t.check('capture: a token shows only its length',
    shown[5] === `string(${longToken('token').length})`);
}

// --- merging gallery pages into one reply -------------------------------------
{
  const { mergePages, frameReply, describe } = loadPage().win.__GMX;

  const merged = mergePages([REPLY_1, REPLY_2]);
  t.check('merge: two real pages make one list', merged && describe(merged.payload).size === describe(REPLY_1).size + merged.added);
  t.check('merge: the later page adds its photos', merged.added > 0);
  t.check('merge: the first page keeps its order at the front',
    merged.payload[0].slice(0, 20).every((entry, i) => entry[0] === REPLY_1[0][i][0]));
  t.check('merge: everything outside the list is the first page\'s own',
    JSON.stringify(merged.payload.filter((_, i) => i !== 0)) === JSON.stringify(REPLY_1.filter((_, i) => i !== 0)));
  t.check('merge: the first reply is not changed', REPLY_1[0].length === 20);

  const again = mergePages([REPLY_1, REPLY_1]);
  t.check('merge: a page that repeats the first adds nothing', again.added === 0 && again.payload[0].length === 20);

  t.check('merge: no first list means nothing to merge', mergePages([[], REPLY_1]) === null);
  t.check('merge: no pages at all is nothing', mergePages([]) === null);
  t.check('merge: an unreadable later page is skipped', mergePages([REPLY_1, null, []]).added === 0);

  const framed = frameReply('hspqX', merged.payload);
  const back = [...framed.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)]
    .map((m) => JSON.parse(JSON.parse(`"${m[1]}"`)));
  t.check('merge: the framed reply reads back to the same payload',
    back.length === 1 && JSON.stringify(back[0]) === JSON.stringify(merged.payload));
}

// --- GMGallery.fillGrid() ---------------------------------------------------
// A session cut to ten photos a page still serves the later pages. With the
// switch on, the capped first reply is replaced by one that holds them all.
const photosIn = async (response) => {
  const text = await response.text();
  const found = [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)]
    .map((m) => JSON.parse(JSON.parse(`"${m[1]}"`)));
  return found[0]?.[0]?.length ?? 0;
};

{
  // Automatic fill follows the photos switch.
  const page = loadPage();
  page.switchOn();
  t.check('fill: on by default when the photos switch is on', page.api().fillGrid() === 'on');
  const allowed = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)], askingFor(20));
  t.check('fill: and it lengthens the list', await photosIn(allowed) === 20);

  page.api().fillGrid(false);
  t.check('fill: fillGrid(false) turns it off', page.api().fillGrid() === 'off');
  const waiting = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0)], askingFor(20));
  t.check('fill: off, the reply is the server\'s own', await photosIn(waiting) === 10);
  t.check('fill: and no extra request is made', page.win.fetchCalls.length === 1);

  page.api().fillGrid('auto');
  t.check('fill: fillGrid(\'auto\') goes back to following the photos switch', page.api().fillGrid() === 'on');

  const off = loadPage();
  t.check('fill: with the photos switch off it is off', off.api().fillGrid() === 'off');
  const untouched = await off.receiveByRequest([galleryReply(10, 116, 'T1', 0)], askingFor(20));
  t.check('fill: and the reply is left alone', await photosIn(untouched) === 10 && off.win.fetchCalls.length === 1);
}
{
  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(true);
  t.check('fill: turned on for the session', page.api().fillGrid() === 'on');

  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'T1', 0),
    galleryReply(10, 116, 'T1', 0),
    galleryReply(10, 116, 'T2', 10),
    galleryReply(10, 116, 'T3', 20),
    galleryReply(8, 116, null, 30)
  ], askingFor(20));

  t.check('fill: the page gets one full page of photos, as an uncapped session would', await photosIn(response) === 20);
  t.check('fill: the original is replaced by two size-10 requests', page.win.fetchCalls.length === 3);
  t.check('fill: the follow-ups ask for the same page size',
    page.win.fetchCalls.slice(1).every((c) => {
      try {
        const freq = JSON.parse(new URLSearchParams(c.init.body).get('f.req'));
        return JSON.parse(freq[0][0][1])[4][2][1] === 10;
      } catch (_) { return false; }
    }));
  t.check('fill: the response keeps its status', response.status === 200);
  t.check('fill: one concise result records counts, pages, flags and duration',
    page.logs.length === 1 && /^\[GM-GALLERY\] fill ok: serverBatch=10 deliveredBatch=20 uniqueSupplied=20 announcedTotal=116 nextToken=present serverPages=2 flagsCleared=0 ms=\d+$/.test(page.logs[0]));
}
{
  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(20, 116, 'T1', 0)], askingFor(20));
  t.check('fill: a page that is not capped is left alone', await photosIn(response) === 20 && page.win.fetchCalls.length === 1);
}
{
  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(10, 116, null, 0)], askingFor(20));
  t.check('fill: a capped page with no token is left alone', await photosIn(response) === 10 && page.win.fetchCalls.length === 1);
}
{
  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 0)], askingFor(20));
  t.check('fill: a follow-up that repeats the page changes nothing', await photosIn(response) === 10);
}
{
  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), 'garbage'], askingFor(20));
  t.check('fill: an unreadable follow-up leaves the original reply', await photosIn(response) === 10);
}
{
  const page = loadPage();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0)], askingFor(20));
  t.check('fill: fillGrid(true) attempts replay without the photos switch',
    page.win.fetchCalls.length === 2);
  t.check('fill: one concise failure explains why the original reply remains',
    page.logs.length === 1 && /^\[GM-GALLERY\] fill failed: size-10 replay failed; ms=\d+$/.test(page.logs[0])
    && await photosIn(response) === 10);
}

// --- keeping the framing of the server's own reply ---------------------------
// A real batchexecute reply is the gallery chunk followed by trailer chunks.
// Maps reads those, so the replacement must carry them. Each length line is
// the json's UTF-8 length plus two, measured on real replies.
{
  const { mergePages, frameReply } = loadPage().win.__GMX;
  const bytes = (text) => new TextEncoder().encode(text).length;
  const trailer1 = '[["di",37],["af.httprm",37,"8086949976010301048",18]]';
  const trailer2 = '[["e",4,null,null,140]]';

  const chunk = serverJson([['wrb.fr', 'hspqX', serverJson(REPLY_1), null, null, null, 'generic']]);
  const original = serverReply([chunk, trailer1, trailer2]);

  const merged = mergePages([REPLY_1, REPLY_2]);
  const out = frameReply('hspqX', merged.payload, original);

  // A reader that follows the rule: digits, then that many bytes, json inside.
  const parse = (text) => {
    const all = new TextEncoder().encode(text.replace(/^\)\]\}'\n+/, ''));
    const decoder = new TextDecoder();
    const chunks = [];
    let at = 0;
    while (at < all.length) {
      let digits = at;
      while (digits < all.length && all[digits] >= 48 && all[digits] <= 57) digits++;
      if (digits === at) break;
      const declared = Number(decoder.decode(all.slice(at, digits)));
      const segment = decoder.decode(all.slice(digits, digits + declared));
      chunks.push({ declared, json: segment.replace(/^\n/, '').replace(/\n$/, '') });
      at = digits + declared;
    }
    return chunks;
  };

  const chunks = parse(out);
  t.check('frame: three chunks come out as three went in', chunks.length === 3);
  t.check('frame: every length line is its json\'s bytes plus two',
    chunks.every((c) => c.declared === bytes(c.json) + 2));
  t.check('frame: the trailers are carried over unchanged', chunks[1].json === trailer1 && chunks[2].json === trailer2);
  t.check('frame: the XSSI prefix is kept', out.startsWith(")]}'\n\n"));
  t.check('frame: the gallery chunk holds the longer list', chunks[0].json.length > chunk.length);
  t.check('frame: unchanged, the rebuild is the server\'s text', frameReply('hspqX', REPLY_1, original) === original);

  const plain = frameReply('hspqX', merged.payload);
  t.check('frame: without an original it still produces one valid chunk', parse(plain).length === 1);
  t.check('frame: an original that is not framed falls back to the plain form',
    parse(frameReply('hspqX', merged.payload, 'not a reply')).length === 1);
}

// --- the page size asked for bounds the fill -----------------------------------
{
  const page = loadPage();
  page.switchOn();
  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10), galleryReply(8, 116, null, 20)
  ], askingFor(20));
  t.check('fill: one page more, up to the page size asked for', await photosIn(response) === 20);

  // A batchexecute call that is not the gallery goes through untouched.
  const other = loadPage();
  other.switchOn();
  const otherText = ")]}'\n\n20\n[[\"wrb.fr\",\"T4jwAf\",\"[1]\"]]\n";
  const otherResponse = await other.receiveRpc('T4jwAf', [otherText]);
  t.check('fill: a call that is not the gallery is left as it is',
    other.win.fetchCalls.length === 1 && await otherResponse.text() === otherText);

  const unknown = loadPage();
  unknown.api().fillGrid('nonsense');
  t.check('fill: an unknown value turns the fill off', unknown.api().fillGrid().startsWith('off'));
}

// --- GMGallery.trace() -------------------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  await page.replyByRequest(galleryReply(10, 45), askingFor(20));

  const events = page.api().trace();
  t.check('trace: a batchexecute call is recorded by rpc name',
    events.some((e) => e.kind === 'call' && e.rpc === 'hspqX'));
  t.check('trace: nothing but shapes is kept',
    !JSON.stringify(events).includes('googleusercontent') && !JSON.stringify(events).includes('f.req'));
  t.check('trace: the caller gets a copy', page.api().trace() !== page.api().trace());

  // The tracer wraps fetch last. Everything the hooks do must still work.
  const response = await page.receiveByRequest([galleryReply(10, 45)], askingFor(20));
  t.check('trace: the reply still reaches the page', await photosIn(response) === 10);
  t.check('trace: the gallery is still reported through it', page.outcomes().length >= 1);
}
{
  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(true);
  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10), galleryReply(8, 116, null, 20)
  ], askingFor(20));
  t.check('trace: the fill still works behind it', await photosIn(response) === 20);
  t.check('trace: the fill records how many pages and how long',
    page.api().trace().some((e) => e.kind === 'fill' && e.pages === 2 && typeof e.durationMs === 'number'));
  t.check('fill: the concise result includes Maps wait duration',
    page.logs.length === 1 && /^\[GM-GALLERY\] fill ok: serverBatch=10 deliveredBatch=20 uniqueSupplied=20 announcedTotal=116 nextToken=present serverPages=2 flagsCleared=0 ms=\d+$/.test(page.logs[0]));
}

// --- the replacement Response looks like a fetched one -------------------------
{
  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(true);
  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10), galleryReply(8, 116, null, 20)
  ], askingFor(20));

  t.check('response: the replacement holds the longer list', await photosIn(response) === 20);
  t.check('response: it keeps the request url', response.url.includes('batchexecute?rpcids=hspqX'));
  t.check('response: it is typed basic, as a fetched one is', response.type === 'basic');
  t.check('response: it keeps the redirected flag', response.redirected === false);
  t.check('response: and the status', response.status === 200);
}

// --- the token Maps is left holding ---------------------------------------------
// An uncapped session answers with the page size asked for and the token of
// the page after it. The filled reply must do the same, so that Maps pages on
// by itself instead of finding a list that does not match its own bookkeeping.
{
  const read = async (response) => {
    const text = await response.text();
    return [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)]
      .map((m) => JSON.parse(JSON.parse(`"${m[1]}"`)))[0];
  };
  const make = async () => {
    const page = loadPage();
    page.switchOn();
    return read(await page.receiveByRequest([
      galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10), galleryReply(10, 116, 'T3', 20)
    ], askingFor(20)));
  };

  const filled = await make();
  t.check('token: the filled reply carries the last page\'s token', filled[5] === longToken('T2'));
  t.check('token: the list is exactly the page size asked for', filled[0].length === 20);
}

// --- escapes: a rebuilt reply must be written the way the server writes it ------
// The server writes < > & = and the line separators as \uXXXX, not /. Plain
// JSON.stringify does not, so a rebuilt reply came back shorter than the
// original and its length lines no longer matched. The first echo run on a
// real page showed it: 10566 characters became 10495.
{
  const { googleJson, frameReply } = loadPage().win.__GMX;

  t.check('escapes: = is written as \\u003d', googleJson('a=b') === '"a\\u003db"');
  t.check('escapes: & is written as \\u0026', googleJson('a&b') === '"a\\u0026b"');
  t.check('escapes: < and > are written as \\u003c and \\u003e', googleJson('<a>') === '"\\u003ca\\u003e"');
  t.check('escapes: / is left alone', googleJson('a/b') === '"a/b"');
  t.check('escapes: the line separators are escaped', googleJson('\u2028\u2029') === '"\\u2028\\u2029"');
  t.check('escapes: plain text is untouched', googleJson('abc 123') === '"abc 123"');
  t.check('escapes: an escaped value reads back to the same value',
    JSON.parse(googleJson({ u: 'https://x.com/a?b=1&c=<2>' })).u === 'https://x.com/a?b=1&c=<2>');

  // A reply the way the server writes it, with a photo URL in it.
  const url = 'https://lh3.googleusercontent.com/gps-cs-s/ABC=w203-h270-k-no?x=1&y=2';
  const entry = (id) => [id, 10, 12, null, null, null, [`${url}&id=${id}`, '', [3000, 4000], [203, 100]]];
  const payload = [[entry('CIAB1'), entry('CIAB2'), entry('CIAB3')], 45, null, 'S', null, 'TOK'];
  const inner = serverJson(payload);
  const chunk = serverJson([['wrb.fr', 'hspqX', inner, null, null, null, 'generic']]);
  const trailer = '[["e",4,null,null,140]]';
  const server = serverReply([chunk, trailer]);

  t.check('escapes: the test reply carries escaped characters', chunk.includes('\\\\u003d') || chunk.includes('\\u003d'));
  t.check('escapes: rebuilding it unchanged gives the server\'s text exactly',
    frameReply('hspqX', payload, server) === server);
}

// --- escapes measured against a real gallery reply ----------------------------
// The real reply was 10566 characters, JSON.stringify gave 10495, and 12 "="
// signs at six extra characters each is 72. So "=" is escaped and "/" is not.
{
  const { googleJson } = loadPage().win.__GMX;
  const plain = JSON.stringify(REPLY_CAPPED).length;
  const mine = googleJson(REPLY_CAPPED).length;
  const equals = JSON.stringify(REPLY_CAPPED).split('=').length - 1;
  t.check('real reply: written alone, each "=" becomes \\u003d, five characters longer', mine - plain === equals * 5);
  t.check('real reply: slashes are left plain', !googleJson(REPLY_CAPPED).includes('\\u002f'));
}

// --- chunk lengths are bytes, and the last chunk has no newline after it -------
// Measured on a real reply: the header said 10468 where counting characters
// gave 10466, and the rebuild was one character longer than the server's.
{
  const page = loadPage();
  const { frameReply } = page.win.__GMX;
  const bytes = (text) => new TextEncoder().encode(text).length;

  const entry = (id, name) => [id, 10, 12, null, null, null,
    [`https://lh3.googleusercontent.com/gps-cs-s/${id}=w203`, name, [3000, 4000], [203, 100]]];
  const payload = [[entry('CIAB1', 'Caf\u00e9'), entry('CIAB2', 'Na\u00efve')], 45, null, 'S', null, 'TOK'];
  const body = serverJson([['wrb.fr', 'hspqX', serverJson(payload), null, null, null, 'generic']]);
  const trailer1 = '[["di",21],["af.httprm",21,"-250655609989403101",100]]';
  const trailer2 = '[["e",4,null,null,140]]';

  const server = serverReply([body, trailer1, trailer2]);
  const rebuilt = frameReply('hspqX', payload, server);

  t.check('bytes: the test reply has non-ASCII characters, so bytes and characters differ',
    bytes(body) > body.length);
  t.check('bytes: rebuilding it unchanged is identical to the server\'s', rebuilt === server);
  t.check('bytes: the header is the json\'s byte length plus two', rebuilt.split('\n')[2] === String(bytes(body) + 2));
  t.check('bytes: no newline is added after the last chunk', !rebuilt.endsWith('\n'));
  t.check('bytes: the trailers survive', rebuilt.includes(trailer1) && rebuilt.endsWith(trailer2));

  const sent = serverReply([body, trailer1, trailer2], { finalNewline: true });
  t.check('bytes: a final newline the server did send is kept', frameReply('hspqX', payload, sent) === sent);

  const longer = [...payload];
  longer[0] = [...payload[0], entry('CIAB3', '\u00c9t\u00e9')];
  const grown = frameReply('hspqX', longer, server);
  const declared = Number(grown.split('\n')[2]);
  const gallery = grown.split('\n')[3];
  t.check('bytes: a longer list declares its own chunk\'s byte length plus two', declared === bytes(gallery) + 2);
}

// --- the limited flag and the token are found, not assumed --------------------
// A capped reply carries a true that an uncapped first page does not have, and
// while it is set Maps does not ask for the next page. The fill empties it
// wherever it sits, and leaves alone a true that uncapped replies also carry.
{
  const withFlagAt = (index, token) => {
    const payload = JSON.parse(JSON.stringify(REPLY_CAPPED));
    payload[15] = null;
    payload[index] = true;
    payload[5] = longToken(token);
    return frame('hspqX', payload);
  };
  const read = async (replies, page = loadPage()) => {
    page.switchOn();
    const response = await page.receiveByRequest([replies[0], ...replies], askingFor(20));
    const text = await response.text();
    return { page, payload: [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)]
      .map((m) => JSON.parse(JSON.parse(`"${m[1]}"`)))[0] };
  };

  t.check('flag: the capped reply really carries one', REPLY_CAPPED[15] === true);

  const at15 = await read([frame('hspqX', Object.assign(JSON.parse(JSON.stringify(REPLY_CAPPED)), { 5: longToken('T1') })),
    galleryReply(10, 45, 'T2', 10)]);
  t.check('flag: emptied where it is today', !at15.payload[15]);
  t.check('flag: the concise fill result records one cleared flag',
    at15.page.logs.length === 1 && /^\[GM-GALLERY\] fill ok: serverBatch=10 deliveredBatch=20 uniqueSupplied=20 announcedTotal=45 nextToken=present serverPages=2 flagsCleared=1 ms=\d+$/.test(at15.page.logs[0]));

  const moved = await read([withFlagAt(17, 'T1'), galleryReply(10, 45, 'T2', 10)]);
  t.check('flag: emptied when Google moves it', !moved.payload[17] && !moved.payload[15]);
  t.check('flag: nothing else changes', moved.payload[0].length === 20 && moved.payload[1] === 45);

  // A true that an uncapped reply carries too is ordinary and stays.
  const page = loadPage();
  page.switchOn();
  const uncapped = JSON.parse(JSON.stringify(REPLY_CAPPED));
  uncapped[15] = null;
  uncapped[11] = true;
  uncapped[0] = [...uncapped[0], ...uncapped[0]]; // as many as were asked for
  await page.receiveByRequest([frame('hspqX', uncapped)], askingFor(20));
  const capped = JSON.parse(JSON.stringify(REPLY_CAPPED));
  capped[11] = true;
  capped[5] = longToken('T1');
  const kept = await read([frame('hspqX', capped), galleryReply(10, 45, 'T2', 10)], page);
  t.check('flag: a true that uncapped replies carry is left alone', kept.payload[11] === true && !kept.payload[15]);
}
{
  // The token is found by shape: the long string, wherever it sits.
  const { tokenSlot, learnTokenSlot } = loadPage().win.__GMX;
  const payload = [[], 45, null, 'x'.repeat(23), null, null, null, null, null, null, false, null, null, null, null, null, longToken('A')];
  t.check('token: the long string is found where it sits', tokenSlot(payload) === 16);
  t.check('token: a stale hint holding a session id falls back to shape', tokenSlot(payload, 3) === 16);
  t.check('token: a taught null slot means end, not another long field', tokenSlot(payload, 5) === null);
  t.check('token: nothing long means no token', tokenSlot([[], 45, null, 'x'.repeat(23)]) === null);
  t.check('token: two similar long strings are not guessed between',
    tokenSlot([longToken('A'), longToken('B')]) === null);
  t.check('token: the slot is taught by the token Maps sent back',
    learnTokenSlot(payload, longToken('A')) === 16 && learnTokenSlot(payload, 'other') === null);

  // Discard the size-20 cursor, replay distinct size-10 pages, and return
  // the last replay cursor in the moved reply slot.
  const moved = (token, first) => {
    const p = JSON.parse(JSON.stringify(REPLY_CAPPED));
    p[0] = p[0].map((entry, i) => [`MOVED${first + i}`, ...entry.slice(1)]);
    p[5] = null;
    p[16] = longToken(token);
    return frame('hspqX', p);
  };
  const page = loadPage();
  page.switchOn();
  const response = await page.receiveByRequest([
    moved('SKIPPED', 90), moved('T1', 0), moved('T2', 10)
  ], askingFor(20));
  const text = await response.text();
  const filled = [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)]
    .map((m) => JSON.parse(JSON.parse(`"${m[1]}"`)))[0];
  t.check('token: a fill merges distinct pages when the token moved',
    filled?.[0]?.length === 20 && filled[0].every((entry, i) => entry[0] === `MOVED${i}`));
  t.check('token: the last replay cursor is returned at the moved slot',
    filled?.[16] === longToken('T2') && filled[5] === null);
  const requests = page.win.fetchCalls.slice(1).map((call) =>
    JSON.parse(JSON.parse(new URLSearchParams(call.init.body).get('f.req'))[0][0][1]));
  t.check('token: size-10 replay follows the moved cursor, not the discarded one',
    requests.length === 2 && requests[0][4][2][2] === null
    && requests[1][4][2][2] === longToken('T1') && requests.every((request) => request[4][2][1] === 10));
}

// --- unflagged follow-ups stay untouched; flagged short pages replay below ----
// A token alone does not trigger filling: without a learned limited flag,
// Maps' follow-up passes through. Flagged short pages replay at size 10.
{
  const followUp = REQUEST_2;

  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(true);
  const response = await page.receiveByRequest([galleryReply(10, 116, 'T3', 20)], followUp);

  t.check('follow-up: the request really carries a token',
    JSON.stringify(JSON.parse(new URLSearchParams(followUp).get('f.req'))).includes(TOKEN_1.slice(0, 20)));
  t.check('follow-up: no extra page is fetched', page.win.fetchCalls.length === 1);
  t.check('follow-up: the reply is the server\'s own', await photosIn(response) === 10);
  t.check('follow-up: an unchanged page produces no console noise', page.logs.length === 0);

  // The first request, with no token, is still filled.
  const first = loadPage();
  first.switchOn();
  first.api().fillGrid(true);
  const filled = await first.receiveByRequest([
    galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)
  ], askingFor(20));
  t.check('follow-up: a first request is still filled', await photosIn(filled) === 20);
}

// --- every page served after the fill keeps the limited flag cleared -----------
// The server sets the flag on each page it sends. Left on a follow-up page,
// Maps stops after one more, which is how a place with 112 photos ended at 30.
{
  const cappedPage = (token, first, size = 10) => {
    const payload = JSON.parse(JSON.stringify(REPLY_CAPPED));
    payload[0] = galleryPayload(size, first);
    payload[5] = longToken(token);
    return frame('hspqX', payload);
  };
  const galleryPayload = (n, first) => JSON.parse(JSON.stringify(
    [...Array(n)].map((_, i) => REPLY_CAPPED[0][i % REPLY_CAPPED[0].length].map((v, j) => (j === 0 ? `ID${first + i}` : v)))));
  const flagged = (response) => response.text().then((text) => {
    const found = [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)]
      .map((m) => JSON.parse(JSON.parse(`"${m[1]}"`)))[0];
    return found?.[15];
  });

  const page = loadPage();
  page.switchOn();
  await page.receiveByRequest([cappedPage('T1', 0), cappedPage('T1', 0), cappedPage('T2', 10)], askingFor(20));
  page.win.fetchCalls.length = 0;
  page.logs.length = 0;

  const followUp = await page.receiveByRequest([cappedPage('T3', 20, 20)], REQUEST_2);
  t.check('flag: a follow-up page has the flag cleared too', !(await flagged(followUp)));
  t.check('flag: a reply that is already the size asked for needs nothing extra', page.win.fetchCalls.length === 1);
  t.check('flag: one concise page result records the cleared flag',
    page.logs.length === 1 && /^\[GM-GALLERY\] page ok: serverBatch=20 deliveredBatch=20 uniqueSupplied=40 announcedTotal=45 nextToken=present serverPages=0 flagsCleared=1 ms=\d+$/.test(page.logs[0]));
}

// --- follow-up pages are the size Maps asked for ---------------------------------
// A capped session serves 10 where 20 were asked for. Left short, the grid
// redraws and the scroll jumps to the top, so the next page is joined in.
{
  const sizeOf = async (response) => {
    const text = await response.text();
    const found = [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)]
      .map((m) => JSON.parse(JSON.parse(`"${m[1]}"`)))[0];
    return { size: found?.[0]?.length ?? 0, flag: found?.[15] };
  };
  const capped = (n, total, token, first) => {
    const payload = JSON.parse(JSON.stringify(REPLY_CAPPED));
    payload[0] = galleryReply(n, total, token, first) && JSON.parse(
      JSON.stringify([...Array(n)].map((_, i) => REPLY_CAPPED[0][i % REPLY_CAPPED[0].length].map((v, j) => (j === 0 ? `ID${first + i}` : v)))));
    payload[1] = total;
    payload[5] = longToken(token);
    return frame('hspqX', payload);
  };

  const page = loadPage();
  page.switchOn();
  await page.receiveByRequest([capped(10, 112, 'T1', 0), capped(10, 112, 'T1', 0), capped(10, 112, 'T2', 10)], askingFor(20));

  page.logs.length = 0;
  const joined = await page.receiveByRequest([capped(10, 112, 'SKIPPED', 20), capped(10, 112, 'T3', 20), capped(10, 112, 'T4', 30)], REQUEST_2);
  const out = await sizeOf(joined);
  t.check('follow-up: a short page is joined with the next to the size asked for', out.size === 20);
  t.check('follow-up: two size-10 pages replay the incoming cursor', page.win.fetchCalls.length === 3);
  const requests = page.win.fetchCalls.slice(1).map((c) => JSON.parse(JSON.parse(new URLSearchParams(c.init.body).get('f.req'))[0][0][1]));
  t.check('follow-up: replay uses the incoming token, not the skipped token', requests[0][4][2][2] === TOKEN_1);
  t.check('follow-up: continuation follows the replay token at size ten', requests[1][4][2][2] === longToken('T3') && requests.every((r) => r[4][2][1] === 10));
  t.check('follow-up: the flag is cleared on it', !out.flag);
  t.check('follow-up: one concise page result records the joined count',
    page.logs.length === 1 && /^\[GM-GALLERY\] page ok: serverBatch=10 deliveredBatch=20 uniqueSupplied=40 announcedTotal=112 nextToken=present serverPages=2 flagsCleared=1 ms=\d+$/.test(page.logs[0]));

  // The last page has nothing to join.
  const last = await page.receiveByRequest([capped(8, 112, null, 50), capped(8, 112, null, 50)], REQUEST_2);
  t.check('follow-up: the last page is left as it is', (await sizeOf(last)).size === 8 && page.win.fetchCalls.length === 2);
}

// --- a jump of the scroll position is recorded in the trace ----------------------
{
  const page = loadPage();
  page.switchOn();
  const pane = { nodeType: 1, scrollTop: 2400, scrollHeight: 5000, clientHeight: 600,
    querySelectorAll: () => [1, 2, 3] };
  page.scrollEvent(pane);
  pane.scrollTop = 0;
  pane.scrollHeight = 1800;
  page.scrollEvent(pane);
  const jump = page.api().trace().find((e) => e.kind === 'scroll-jump');
  t.check('trace: a fall from 2400 to 0 is recorded', jump?.from === 2400 && jump?.to === 0);
  t.check('trace: with the height before and after', jump?.heightBefore === 5000 && jump?.heightAfter === 1800);
  t.check('trace: and whether the list was rebuilt', jump?.rebuilt === true);

  const small = { nodeType: 1, scrollTop: 300, scrollHeight: 5000, clientHeight: 600, querySelectorAll: () => [] };
  page.scrollEvent(small);
  small.scrollTop = 100;
  page.scrollEvent(small);
  t.check('trace: an ordinary scroll back up is not a jump',
    page.api().trace().filter((e) => e.kind === 'scroll-jump').length === 1);
}

// --- the scroll position Maps resets after a handed-over reply is put back ------
{
  const pane = (top, height) => ({ nodeType: 1, scrollTop: top, scrollHeight: height, clientHeight: 600,
    querySelectorAll: () => [] });
  const reset = (page, el) => { page.scrollEvent(el); el.scrollTop = 58; el.scrollHeight = 3989; page.scrollEvent(el); };

  const page = loadPage();
  page.switchOn();
  await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)], askingFor(20));
  const el = pane(940, 2070);
  reset(page, el);
  t.check('restore: the position Maps reset is put back', el.scrollTop === 940);
  t.check('restore: and it is traced', page.api().trace().some((e) => e.kind === 'scroll-restored'));
  t.check('restore: and not recorded as a jump', !page.api().trace().some((e) => e.kind === 'scroll-jump'));

  // No reply was handed over: nothing of ours moved it.
  const other = loadPage();
  other.switchOn();
  const el2 = pane(940, 2070);
  reset(other, el2);
  t.check('restore: without a handed-over reply the position is left alone', el2.scrollTop === 58);

  // A height that did not grow is not Maps appending.
  const el3 = pane(940, 2070);
  page.scrollEvent(el3);
  el3.scrollTop = 58;
  page.scrollEvent(el3);
  t.check('restore: a fall with no growth is left alone', el3.scrollTop === 58);
}

// --- the small preview before the gallery is not the gallery --------------------
// Maps asks for a few photos for the place card first: two of two, whatever the
// session. Taken as the first reply it hid the real gallery, which then counted
// as a second page.
{
  const page = loadPage();
  page.switchOn();
  await page.replyByRequest(galleryReply(2, 2, null, 0), askingFor(4));
  t.check('preview: it is not taken as the gallery', page.outcomes().length === 0);

  // However long the gallery takes to be opened.
  await wait(3000);
  await page.replyByRequest(galleryReply(10, 112, 'T1', 0), askingFor(20));
  await wait(50);
  const outcomes = page.outcomes();
  t.check('preview: the gallery, when it comes, is the first reply',
    outcomes.length === 1 && outcomes[0].firstPage === 10);
  t.check('preview: with its total and what it asked for', outcomes[0]?.serverTotal === 112 && outcomes[0]?.asked === 20);
  t.check('preview: and it is not called a second page', page.paged().length === 0);
}

// --- a strip of neighbouring photos is not the end of the gallery ---------------
{
  const page = loadPage();
  page.switchOn();
  await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)], askingFor(20));
  // The open photo's neighbours: two photos, a total of two, no token.
  await page.receiveRpc('hspqX', [galleryReply(2, 2, null, 0)]);
  await wait(50);
  t.check('strip: two photos of two do not replace the gallery it follows',
    page.outcomes().length === 1 && page.outcomes()[0].firstPage === 20 && page.outcomes()[0].serverTotal === 116);
}

// --- gallery state reflects the reply handed to Maps ---------------------------
// A filled list that reaches the requested page size is recorded as served
// in full. A capped reply that could not be filled keeps its original counts.
{
  const outcome = async (replies, request = askingFor(20)) => {
    const page = loadPage();
    page.switchOn();
    await page.receiveByRequest(replies, request);
    return page.outcomes();
  };

  const filled = await outcome([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)]);
  t.check('state: a filled list has one gallery record', filled.length === 1);
  t.check('state: a filled list records the requested page size', filled[0]?.firstPage === 20);

  const noMore = await outcome([galleryReply(10, 116, 'T1', 0), 'garbage']);
  t.check('state: a failed fill keeps the original served count', noMore[0]?.firstPage === 10);
  t.check('state: a failed fill retains the capped counts',
    noMore[0]?.firstPage < noMore[0]?.asked && noMore[0]?.serverTotal > noMore[0]?.firstPage);

  const noToken = await outcome([galleryReply(10, 116, null, 0)]);
  t.check('state: a capped reply with no token keeps its served count', noToken[0]?.firstPage === 10);

  const uncapped = await outcome([galleryReply(20, 116, 'T1', 0)]);
  t.check('state: an uncapped reply keeps its served count', uncapped[0]?.firstPage === 20);

  const page = loadPage();
  page.switchOn();
  page.api().fillGrid(false);
  await page.receiveByRequest([galleryReply(10, 116, 'T1', 0)], askingFor(20));
  t.check('state: with fill off the original served count remains',
    page.outcomes()[0]?.firstPage === 10);
}

// --- switched off -----------------------------------------------------------
{
  const page = loadPage();
  page.reply(galleryReply(10, 45), askingFor(20));
  await wait(50);

  t.check('off: a capped reply is passed through whole', page.win.fetchCalls === undefined || page.win.fetchCalls.length === 0);
  t.check('off: nothing is logged either', page.logs.length === 0);
}

// --- a capped gallery -------------------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingFor(20));
  await wait(50);

  const [outcome] = page.outcomes();
  t.check('a capped reply is reported', !!outcome);
  t.check('  served 10', outcome?.firstPage === 10);
  t.check('  of 45', outcome?.serverTotal === 45);
  t.check('  having asked for 20', outcome?.asked === 20);
}

// --- a place with a great many photos ---------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 250000), askingFor(20));
  await wait(50);

  const [outcome] = page.outcomes();
  t.check('a total in the hundreds of thousands is still read, so the cap is still seen',
    outcome?.serverTotal === 250000);
}

// --- an uncapped gallery ----------------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(20, 45), askingFor(20));
  await wait(50);

  const [outcome] = page.outcomes();
  t.check('an uncapped reply is reported as served 20', outcome?.firstPage === 20);
}

// --- captured traffic -------------------------------------------------------
//
// Two real pages, replayed as Maps sent them. Everything above this uses the
// same shapes with the counts varied; this checks the shapes themselves.
{
  const page = loadPage();
  page.switchOn();
  page.reply(frame('hspqX', REPLY_1), REQUEST_1);
  await wait(50);

  const [outcome] = page.outcomes();
  t.check('real page 1: the gallery is reported', !!outcome);
  t.check('  served 20 of 45', outcome?.firstPage === 20 && outcome?.serverTotal === 45);
  t.check('  having asked for 20, read from the paging message', outcome?.asked === 20);

  page.reply(frame('hspqX', REPLY_2), REQUEST_2);
  await wait(50);

  const [paged] = page.paged();
  t.check('real page 2: reported as the session paging, 19 photos', paged?.photos === 19);
}

{
  const page = loadPage();
  page.switchOn();
  page.reply(frame('hspqX', REPLY_CAPPED), REQUEST_CAPPED);
  await wait(50);

  const [outcome] = page.outcomes();
  t.check('real capped page: served 10 of 45 having asked for 20, which is the cap read'
    + ' straight off the first page', outcome?.firstPage === 10 && outcome?.serverTotal === 45
    && outcome?.asked === 20);
}

{
  const sent = JSON.parse(JSON.parse(new URLSearchParams(REQUEST_2).get('f.req'))[0][0][1]);
  t.check('real page 2 carries page 1\'s token beside the page size, which is what'
    + ' identifies the paging message', sent[4][2][2] === TOKEN_1 && REPLY_1[5] === TOKEN_1);
}

// --- when Google moves the page size ----------------------------------------
//
// The real pages again, with a field added ahead of the paging message. The
// default layout must not read the thumbnail size it now points at; a
// session that pages must teach the new place; and the next load — capped,
// so it never pages — must be judged by what was taught.
{
  const shared = storage();

  const before = loadPage({ localStorage: shared });
  before.switchOn();
  before.reply(frame('hspqX', REPLY_CAPPED), shifted(REQUEST_CAPPED));
  await wait(50);
  t.check('moved: the default layout gives up rather than read the wrong field',
    before.outcomes()[0]?.asked === null);

  const generous = loadPage({ localStorage: shared });
  generous.switchOn();
  generous.reply(frame('hspqX', REPLY_1), shifted(REQUEST_1));
  generous.reply(frame('hspqX', REPLY_2), shifted(REQUEST_2));
  await wait(50);
  t.check('moved: a session that pages learns where the page size went, and says so',
    generous.logs.filter((l) => l.startsWith('[GM-GALLERY] layout ok: rpc=hspqX size=')).join('\n')
      === '[GM-GALLERY] layout ok: rpc=hspqX size=[4,2,1]->[4,3,1] token=[4,2,2]->[4,3,2]');

  const capped = loadPage({ localStorage: shared });
  capped.switchOn();
  capped.reply(frame('hspqX', REPLY_CAPPED), shifted(REQUEST_CAPPED));
  await wait(50);
  const [outcome] = capped.outcomes();
  t.check('moved: a later capped load is judged by what was learned — 10 of 20',
    outcome?.firstPage === 10 && outcome?.asked === 20);
}

{
  const { envelopes, learnLayout } = loadPage().win.__GMX;
  const before = envelopes(REQUEST_1)[0].args;
  const after = envelopes(REQUEST_2)[0].args;
  t.check('learning finds the paging message in real traffic on its own',
    JSON.stringify(learnLayout(before, REPLY_1, 20, after)) === '{"size":[4,2,1],"token":[4,2,2]}');

  // One of the reply's own category ids sent back beside a count: a second
  // round trip that passes every other test.
  const b = JSON.parse(JSON.stringify(before));
  const a = JSON.parse(JSON.parse(JSON.stringify(JSON.stringify(after))));
  b[9] = [null, 30];
  a[9] = ['CgIgAQ==', 30];
  t.check('two candidates learn nothing, rather than whichever came first',
    learnLayout(b, REPLY_1, 20, a) === null);
}

{
  const shared = storage();
  const page = loadPage({ localStorage: shared });
  page.switchOn();
  page.reply(frame('hspqX', REPLY_1), REQUEST_1);
  page.reply(frame('hspqX', REPLY_2), REQUEST_2);
  await wait(50);

  t.check('unmoved: paging relearns the default and stays quiet about it',
    !page.logs.some((l) => l.startsWith('[GM-GALLERY] layout ok: rpc=hspqX size='))
    && shared.getItem('gmnx.pagingLayout') === null);
}

// --- when the page size cannot be read --------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBlind());
  await wait(50);

  const [outcome] = page.outcomes();
  t.check('a page size that is not where it belongs is reported unknown, not guessed',
    outcome?.asked === null);
}

// --- a batch of several calls -----------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBatched(20));
  await wait(50);

  const [outcome] = page.outcomes();
  t.check('in a batch, the page size is read from the call that served the gallery',
    outcome?.asked === 20);
}

{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), 'f.req=' + encodeURIComponent('[[["hspqX",42,null]]]'));
  await wait(50);

  const [outcome] = page.outcomes();
  t.check('arguments that are not a JSON string are skipped, not coerced',
    outcome && outcome.asked === null);
}

// --- the second page, which is what a cap actually looks like ---------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(0, 45), askingBlind());
  await wait(50);

  // Not observed: on the captured capped session Maps never asked for a
  // second page at all. Kept so that an empty follow-up, should one ever
  // arrive, is reported as nothing rather than dropped.
  const [paged] = page.paged();
  t.check('an empty follow-up page is reported', !!paged);
  t.check('  as nothing served', paged?.photos === 0);
}

{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(20, 45), askingBlind());
  await wait(50);

  const [paged] = page.paged();
  t.check('a second page that arrives says the session can page', paged?.photos === 20);
}

{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(20, 45), askingBlind());
  page.reply(galleryReply(0, 45), askingBlind());
  await wait(50);

  t.check('only the first follow-up counts, so the end of a long scroll is not a cap',
    page.paged().length === 1);
}

// --- the single photo viewer ------------------------------------------------
{
  const page = loadPage({ url: 'https://www.google.com/maps/@48.86,2.35,3a,75y,90t/data=!3m7' });
  page.switchOn();
  page.reply(galleryReply(1, 45), askingFor(20));
  await wait(50);

  t.check('one photo of many is the viewer, not a capped gallery',
    page.outcomes().length === 0);
}

// --- the console API --------------------------------------------------------
{
  const page = loadPage();
  t.check('GMGallery.fillGrid exists', typeof page.api()?.fillGrid === 'function');
  t.check('there is no command that touches cookies',
    page.api()?.borrowPrivate === undefined && page.api()?.forget === undefined);
  t.check('the state gallery-ui reads is exposed', !!page.win.__GM_GALLERY__);
}

// --- lifecycle and conservative parsing regressions --------------------------
const payloadOf = async (response) => {
  const text = await response.text();
  const match = [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)][0];
  return match ? JSON.parse(JSON.parse(`"${match[1]}"`)) : null;
};
const flaggedReply = (token, first = 0, extra = {}) => {
  const payload = JSON.parse(JSON.stringify(REPLY_CAPPED));
  payload[0] = payload[0].map((entry, i) => [`LIFE${first + i}`, ...entry.slice(1)]);
  payload[5] = longToken(token);
  return frame('hspqX', Object.assign(payload, extra));
};
const requestForPlace = (body, place) => {
  const outer = JSON.parse(new URLSearchParams(body).get('f.req'));
  const args = JSON.parse(outer[0][0][1]);
  args[2] = [place];
  outer[0][0][1] = JSON.stringify(args);
  return new URLSearchParams({ 'f.req': JSON.stringify(outer) }).toString();
};
const off = (page) => page.win.postMessage({
  source: 'gm-native-maps', type: 'gm-settings', features: { photos: false }
});
{
  const page = loadPage();
  page.switchOn();
  await page.receiveByRequest([flaggedReply('skip'), flaggedReply('A'), flaggedReply('B', 10)], askingFor(20));
  await page.receiveByRequest([galleryReply(20, 80, 'C')], requestForPlace(askingFor(20), 'NEW_PLACE'));
  t.check('SPA: new place replaces first-page totals and clears paging state',
    page.outcomes()[0]?.serverTotal === 80 && page.paged().length === 0);
  const next = await page.receiveByRequest([flaggedReply('D', 20)], requestForPlace(REQUEST_2, 'NEW_PLACE'));
  t.check('SPA: previous place limited flag cannot alter new place follow-ups',
    (await payloadOf(next))[15] === true && page.win.fetchCalls.length === 1);
  await page.receiveByRequest([flaggedReply('skip', 100), flaggedReply('E', 100), flaggedReply('F', 110)], askingFor(20));
  t.check('SPA: successful new gallery counts only its own supplied photos',
    page.logs.at(-1).includes('uniqueSupplied=20'));
  page.reply(galleryReply(1, 45), REQUEST_2);
  t.check('viewer: opening one photo after gallery updates viewerOnly', page.win.__GM_GALLERY__.viewerOnly);
  page.reply(galleryReply(10, 45), REQUEST_2);
  t.check('viewer: gallery reply clears viewerOnly', !page.win.__GM_GALLERY__.viewerOnly);
}
{
  for (const disable of [off, (page) => page.api().fillGrid(false)]) {
    const page = loadPage();
    page.switchOn();
    // Promise-valued fixture text pauses the replay response until read.
    const delayed = { then(resolve) { disable(page); resolve(flaggedReply('A')); } };
    const response = await page.receiveByRequest([flaggedReply('skip'), delayed, flaggedReply('B', 10)], askingFor(20));
    t.check('disable: in-flight replay passes original without another request or success log',
      (await payloadOf(response))[0].length === 10 && page.win.fetchCalls.length === 2 && page.logs.length === 0);
  }
}
{
  const page = loadPage();
  page.switchOn();
  const delayed = { then(resolve) {
    page.reply(galleryReply(20, 80), requestForPlace(askingFor(20), 'NEW_PLACE'));
    resolve(flaggedReply('A'));
  } };
  await page.receiveByRequest([flaggedReply('skip'), delayed], askingFor(20));
  t.check('SPA: pending old fill cannot overwrite new gallery or clear its flags',
    page.outcomes()[0]?.serverTotal === 80 && page.logs.length === 0 && page.win.fetchCalls.length === 2);
}
{
  const page = loadPage();
  page.switchOn();
  const result = await page.receiveByRequest([flaggedReply('skip'), flaggedReply('A'), flaggedReply('A', 10)], askingFor(20));
  t.check('cursor: repeated cursor on full batch fails closed instead of handing Maps loop',
    (await payloadOf(result))[0].length === 10 && page.win.fetchCalls.length === 3);
}
{
  const page = loadPage();
  page.switchOn();
  const empty = JSON.parse(JSON.stringify(REPLY_CAPPED));
  empty[0] = [];
  empty[5] = null;
  empty[10] = true;
  const result = await page.receiveByRequest([flaggedReply('skip'), flaggedReply('A'), frame('hspqX', empty)], askingFor(20));
  t.check('empty: first fill with no extra photos retains original reply', (await payloadOf(result))[5] === longToken('skip'));
  await page.receiveByRequest([flaggedReply('skip'), flaggedReply('A'), flaggedReply('B', 10)], askingFor(20));
  const last = await page.receiveByRequest([flaggedReply('skip', 20), flaggedReply('C', 20), frame('hspqX', empty)], REQUEST_2);
  const payload = await payloadOf(last);
  t.check('empty: terminal replay clears cursor and keeps end marker, only limited flag removed',
    payload[0].length === 10 && payload[5] === null && payload[10] === true && payload[15] === null);
}
{
  const page = loadPage();
  page.switchOn();
  const response = await page.receiveByRequest([
    flaggedReply('skip', 0, { 11: true }), flaggedReply('A', 0, { 11: true }), flaggedReply('B', 10)
  ], askingFor(20));
  const payload = await payloadOf(response);
  t.check('flags: ambiguous unknown booleans remain untouched', payload[11] === true && payload[15] === true);
}
{
  for (const malformed of ['null', '[]', '"bad"', '{"hspqX":{"size":[],"token":[-1]}}', '{"hspqX":{"size":[4,2,1],"token":[4,2,1]}}']) {
    const local = storage();
    local.setItem('gmnx.pagingLayout', malformed);
    local.setItem('gmnx.tokenSlot', '{"hspqX":-1}');
    local.setItem('gmnx.normalFlags', '"15"');
    const page = loadPage({ localStorage: local });
    page.switchOn();
    const response = await page.receiveByRequest([flaggedReply('skip'), flaggedReply('A'), flaggedReply('B', 10)], askingFor(20));
    t.check(`storage: invalid metadata ${malformed} falls back safely`, (await payloadOf(response))[0].length === 20);
  }
}
{
  const page = loadPage();
  page.switchOn();
  const noisy = (token, first) => {
    const payload = JSON.parse(JSON.stringify(REPLY_CAPPED));
    payload[0] = payload[0].map((entry, i) => [`NOISE${first + i}`, ...entry.slice(1)]);
    payload[0].push(['NOT_A_PHOTO', 'metadata']);
    payload[5] = longToken(token);
    return frame('hspqX', payload);
  };
  await page.receiveByRequest([noisy('skip', 0), noisy('A', 0), noisy('B', 10)], askingFor(20));
  t.check('counts: non-image metadata IDs excluded from unique supplied photos',
    page.logs.at(-1).includes('uniqueSupplied=20') && page.logs.at(-1).includes('deliveredBatch=21'));
}
{
  const page = loadPage();
  page.switchOn();
  await page.receiveByRequest([flaggedReply('skip'), flaggedReply('A'), flaggedReply('B', 10)], askingFor(20));
  const moved = (token, first) => flaggedReply(token, first, { 15: null, 17: true });
  await page.receiveByRequest([moved('skip', 100), moved('C', 100), moved('D', 110)], askingFor(20));
  const next = await page.receiveByRequest([moved('E', 120), moved('E', 120), moved('F', 130)], REQUEST_2);
  const payload = await payloadOf(next);
  t.check('SPA: same-place gallery reopening relearns only current limited slots',
    payload[17] === null && page.logs.at(-1).includes('uniqueSupplied=40'));
}
{
  const { capFlags } = loadPage().win.__GMX;
  t.check('flags: two unknown true slots cannot identify cap', capFlags([true, true]).length === 0);
  t.check('flags: normal true slot excluded before resolving cap', JSON.stringify(capFlags([true, true], [0])) === '[1]');
}
{
  // UI test uses only photo scripts and a minimal real-grid DOM.
  const listeners = [];
  const values = new Map([['display', ['flex', 'important']]]);
  const attributes = new Map();
  const gate = {
    style: { getPropertyValue: (key) => values.get(key)?.[0] || '', getPropertyPriority: (key) => values.get(key)?.[1] || '',
      setProperty: (key, value, priority) => values.set(key, [value, priority]), removeProperty: (key) => values.delete(key) },
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: (key) => attributes.delete(key),
    hasAttribute: (key) => attributes.has(key), contains: () => false, querySelector: (selector) => selector === 'img' ? null : ({}),
    querySelectorAll: () => [{}], getBoundingClientRect: () => ({ height: 100 }),
    textContent: 'Sign in', innerHTML: '', isConnected: true
  };
  const grid = { children: [gate], parentElement: { children: [] } };
  grid.parentElement.children = [grid];
  const tiles = Array.from({ length: 5 }, () => ({ parentElement: grid,
    style: { left: '1px', top: '1px', width: '1px', height: '1px', backgroundImage: 'url(https://lh3.googleusercontent.com/p)' } }));
  const win = { addEventListener: (_, fn) => listeners.push(fn) };
  const doc = { body: {}, querySelectorAll: () => tiles };
  let disconnected = 0;
  new Function('window', 'document', 'MutationObserver', read('photos/ui.js'))(win, doc,
    class { observe() {} disconnect() { disconnected++; } });
  const settings = (photos) => listeners.forEach((fn) => fn({ source: win,
    data: { source: 'gm-native-maps', type: 'gm-settings', features: { photos } } }));
  settings(true);
  await wait(250);
  t.check('UI: enabled hides qualifying prompt', values.get('display')[0] === 'none');
  settings(false);
  t.check('UI: disable restores original inline display and priority',
    JSON.stringify(values.get('display')) === '["flex","important"]' && attributes.size === 0 && disconnected === 1);
  settings(true);
  settings(false);
  await wait(250);
  t.check('UI: disabling cancels queued cleanup', values.get('display')[0] === 'flex');
}

process.exit(t.done());
