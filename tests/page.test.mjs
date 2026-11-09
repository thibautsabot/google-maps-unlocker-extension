// What the scripts running inside the page report, and when they keep quiet.

import { loadPage, galleryReply, askingFor, askingBlind, askingBatched, storage, suite, wait, serverReply, longToken }
  from './lib/harness.mjs';
import { REQUEST_1, REQUEST_2, REPLY_1, REPLY_2, TOKEN_1, REQUEST_CAPPED, REPLY_CAPPED, frame, shifted }
  from './lib/real.mjs';

const t = suite('page');

// --- the same gallery call sent as fetch(new Request(...)) -------------------
// Maps moved the gallery call from XHR to fetch with the body inside the
// Request and no second argument. The body was never read, so every reply
// was ignored: no cap was seen, no roll happened, and the grid stayed short.
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByRequest(galleryReply(10, 45), askingFor(20));

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('fetch(Request): a capped reply is reported', !!outcome);
  t.check('fetch(Request):   served 10 of 45', outcome?.firstPage === 10 && outcome?.serverTotal === 45);
  t.check('fetch(Request):   having asked for 20', outcome?.asked === 20);
  t.check('fetch(Request): the request is announced', page.sent('gm-gallery-asking').length === 1);
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByRequest(galleryReply(20, 45), askingFor(20));

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('fetch(Request): an uncapped reply is reported as served 20', outcome?.firstPage === 20);
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByFetch(galleryReply(10, 45), askingFor(20));

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('fetch(url, init): a capped reply is still reported', outcome?.firstPage === 10);
}
{
  const page = loadPage();
  await page.replyByRequest(galleryReply(10, 45), askingFor(20));
  t.check('fetch(Request) with the feature off: nothing is reported', page.sent('gm-roll-outcome').length === 0);
}

// --- GMGallery.capture() ----------------------------------------------------
// The shape of each exchange, for reading why a session was given what it
// was. It must not carry a photo URL: the output gets pasted into issues.
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
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

// --- GMGallery.probeNextPage() ----------------------------------------------
// Asks for the page after the one last seen, with the token that page handed
// back. It resends Maps' own request, so the body has to be the same request
// with only the token changed, and nothing secret may come back out.
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  const first = await page.api().probeNextPage();
  t.check('probe: nothing seen yet is said plainly', typeof first === 'string' && first.includes('open the Photos grid'));

  await page.replyByRequest(galleryReply(10, 45, 'TOKEN-FROM-REPLY'), askingFor(20));
  page.win.fetchCalls.length = 0;
  page.win.fetchReplyText = galleryReply(2, 45);

  const result = await page.api().probeNextPage();
  const [sent] = page.win.fetchCalls;

  t.check('probe: one request is sent', page.win.fetchCalls.length === 1);
  t.check('probe: it is a POST with credentials', sent?.init?.method === 'POST' && sent?.init?.credentials === 'include');
  t.check('probe: the token from the reply is in the new request',
    decodeURIComponent(sent?.init?.body || '').includes('TOKEN-FROM-REPLY'));
  const paging = (() => {
    try {
      const freq = JSON.parse(new URLSearchParams(sent.init.body).get('f.req'));
      return JSON.parse(freq[0][0][1])[4][2];
    } catch (_) { return null; }
  })();
  t.check('probe: the page size asked for is unchanged', paging?.[1] === 20);
  t.check('probe: only the token slot differs from the original request',
    paging?.[2] === longToken('TOKEN-FROM-REPLY') && paging?.[0] === null && paging?.[4] === 1);
  t.check('probe: the answer describes the shape', result?.status === 200 && result?.gotGalleryFrame === true);
  t.check('probe: the answer gives lengths, not photos', result?.list === 2 && result?.total === 45);
  t.check('probe: no token or URL is handed back',
    !JSON.stringify(result).includes('TOKEN-FROM-REPLY') && !JSON.stringify(result).includes('googleusercontent'));
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByRequest(galleryReply(10, 45, null), askingFor(20));
  const result = await page.api().probeNextPage();
  t.check('probe: a reply with no token is reported, not retried',
    typeof result === 'string' && result.includes('no continuation token'));
}

// --- GMGallery.probeAllPages() ----------------------------------------------
// Walks the continuation tokens and counts the photos each page adds that the
// earlier pages did not have.
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByRequest(galleryReply(10, 40, 'T1', 0), askingFor(20));
  page.win.fetchCalls.length = 0;
  page.win.fetchReplies = [
    galleryReply(10, 40, 'T2', 10),
    galleryReply(10, 40, 'T3', 20),
    galleryReply(10, 40, null, 30)
  ];

  const result = await page.api().probeAllPages();
  t.check('walk: one request per page after the first', page.win.fetchCalls.length === 3);
  const read = result.pages.filter((p) => p.got !== undefined);
  t.check('walk: every page read adds ten new photos', read.map((p) => p.added).join() === '10,10,10,10');
  t.check('walk: forty distinct photos are counted', result.distinctPhotos === 40);
  t.check('walk: it stops when a page carries no token',
    result.pages.at(-1).stoppedBecause === 'no token to follow' && read.length === 4);
  t.check('walk: nothing secret comes back',
    !JSON.stringify(result).includes('googleusercontent') && !/T[123]/.test(JSON.stringify(result)));
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByRequest(galleryReply(10, 40, 'T1', 0), askingFor(20));
  page.win.fetchReplies = [galleryReply(10, 40, 'T2', 0)];

  const result = await page.api().probeAllPages();
  t.check('walk: a page that repeats the last one ends the walk',
    result.pages.at(-1).stoppedBecause === 'a page added nothing new');
  t.check('walk: the repeat is not counted as new photos', result.distinctPhotos === 10);
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByRequest(galleryReply(10, 40, 'T1', 0), askingFor(20));
  page.win.fetchReplies = [galleryReply(10, 1000, 'T2', 10)];

  // The fill runs on the first reply by default; only the walk's own requests count.
  const before = page.win.fetchCalls.length;
  const result = await page.api().probeAllPages({ maxPages: 2 });
  t.check('walk: maxPages bounds the number of requests', page.win.fetchCalls.length - before <= 2);
  t.check('walk: the pages it did read are reported', result.pages.length === 2);
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  const result = await page.api().probeAllPages();
  t.check('walk: nothing seen yet is said plainly', typeof result === 'string');
}

// --- which exchange the probes start from -------------------------------------
// Maps also makes a small gallery call for the overview strip, and it can
// arrive after the grid's. The probes must keep walking from the grid.
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByRequest(galleryReply(10, 116, 'GRID-TOKEN', 0), askingFor(20));
  await page.replyByRequest(galleryReply(2, 2, 'STRIP-TOKEN', 100), askingFor(4));
  page.win.fetchCalls.length = 0;
  page.win.fetchReplies = [galleryReply(10, 116, null, 10)];

  const result = await page.api().probeAllPages();
  t.check('the grid exchange is kept when a smaller call arrives after it', result.pages[0].total === 116);
  t.check('the walk continues from the grid, not the strip', result.distinctPhotos === 20);
}

// --- capture shows flags and counts with their value ---------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.replyByRequest(galleryReply(10, 45), askingFor(20));

  const slots = page.api().capture()[0]?.calls[0]?.slots || [];
  const shown = Object.fromEntries(slots);
  t.check('capture: the announced total shows its number', shown[1] === 'number:45');
  t.check('capture: the more-pages flag shows its value', /^boolean:(true|false)$/.test(shown[10] || ''));
  t.check('capture: a token still shows only its first characters',
    typeof shown[5] === 'string' && shown[5].startsWith('string(') && shown[5].length < 30);
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
  // Private sessions come first: the fill stays off until the background says
  // they are used up.
  const page = loadPage();
  page.switchOn();
  t.check('fill: off by default, private sessions are tried first',
    page.api().fillGrid().startsWith('off'));
  const waiting = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0)], askingFor(20));
  t.check('fill: while it waits the reply is the server\'s own', await photosIn(waiting) === 10);
  t.check('fill: and no extra request is made', page.win.fetchCalls.length === 1);

  page.allowFill();
  t.check('fill: on once the background allows it', page.api().fillGrid() === 'on for this session');
  const allowed = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)], askingFor(20));
  t.check('fill: and then it lengthens the list', await photosIn(allowed) === 20);

  page.api().fillGrid(false);
  t.check('fill: fillGrid(false) turns it off again', page.api().fillGrid().startsWith('off'));
  page.api().fillGrid('auto');
  t.check('fill: fillGrid(\'auto\') goes back to waiting for the background',
    page.api().fillGrid().startsWith('off'));

  const off = loadPage();
  off.allowFill();
  t.check('fill: allowed, but with the photos switch off it stays off', off.api().fillGrid().startsWith('off'));
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(true);
  t.check('fill: turned on for the session', page.api().fillGrid() === 'on for this session');

  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'T1', 0),
    galleryReply(10, 116, 'T2', 10),
    galleryReply(10, 116, 'T3', 20),
    galleryReply(8, 116, null, 30)
  ], askingFor(20));

  t.check('fill: the page gets one full page of photos, as an uncapped session would', await photosIn(response) === 20);
  t.check('fill: only the page that was needed is fetched', page.win.fetchCalls.length === 2);
  t.check('fill: the follow-ups ask for the same page size',
    page.win.fetchCalls.slice(1).every((c) => {
      try {
        const freq = JSON.parse(new URLSearchParams(c.init.body).get('f.req'));
        return JSON.parse(freq[0][0][1])[4][2][1] === 20;
      } catch (_) { return false; }
    }));
  t.check('fill: the response keeps its status', response.status === 200);
  t.check('fill: it was announced in the log', page.logs.some((l) => l.includes('grid was filled from 1 more pages')));
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(20, 116, 'T1', 0)], askingFor(20));
  t.check('fill: a page that is not capped is left alone', await photosIn(response) === 20 && page.win.fetchCalls.length === 1);
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(10, 116, null, 0)], askingFor(20));
  t.check('fill: a capped page with no token is left alone', await photosIn(response) === 10 && page.win.fetchCalls.length === 1);
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 0)], askingFor(20));
  t.check('fill: a follow-up that repeats the page changes nothing', await photosIn(response) === 10);
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), 'garbage'], askingFor(20));
  t.check('fill: an unreadable follow-up leaves the original reply', await photosIn(response) === 10);
}
{
  const page = loadPage();
  page.api().fillGrid(true);

  const response = await page.receiveByRequest([galleryReply(10, 116, 'T1', 0)], askingFor(20));
  t.check('fill: asked for by fillGrid(true), it runs without the photos switch',
    page.logs.some((l) => l.includes('fill: a gallery reply arrived')));
  t.check('fill: and it says why when it leaves the reply alone',
    page.logs.some((l) => l.includes('fill: left the reply as it is')) && await photosIn(response) === 10);
}

// --- keeping the framing of the server's own reply ---------------------------
// A real batchexecute reply is the gallery chunk followed by trailer chunks.
// Maps reads those, so the replacement must carry them. Each length line is
// the json's UTF-8 length plus two, measured on real replies.
{
  const { mergePages, frameReply, googleJson } = loadPage().win.__GMX;
  const bytes = (text) => new TextEncoder().encode(text).length;
  const trailer1 = '[["di",37],["af.httprm",37,"8086949976010301048",18]]';
  const trailer2 = '[["e",4,null,null,140]]';

  const chunk = googleJson([['wrb.fr', 'hspqX', googleJson(REPLY_1), null, null, null, 'generic']]);
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
  page.allowFill();
  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10), galleryReply(8, 116, null, 20)
  ], askingFor(20));
  t.check('fill: one page more, up to the page size asked for', await photosIn(response) === 20);

  // A batchexecute call that is not the gallery goes through untouched.
  const other = loadPage();
  other.switchOn();
  other.allowFill();
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
  page.allowFill();
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
  t.check('trace: the gallery is still reported through it', page.sent('gm-roll-outcome').length >= 1);
}
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(true);
  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10), galleryReply(8, 116, null, 20)
  ], askingFor(20));
  t.check('trace: the fill still works behind it', await photosIn(response) === 20);
  t.check('trace: the fill records how many pages and how long',
    page.api().trace().some((e) => e.kind === 'fill' && e.pages === 1 && typeof e.ms === 'number'));
  t.check('fill: the log says how long Maps waited',
    page.logs.some((l) => /and Maps waited \d+ ms for it/.test(l)));
}

// --- the replacement Response looks like a fetched one -------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(true);
  const response = await page.receiveByRequest([
    galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10), galleryReply(8, 116, null, 20)
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
  page.allowFill();
    return read(await page.receiveByRequest([
      galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10), galleryReply(10, 116, 'T3', 20)
    ], askingFor(20)));
  };

  const filled = await make();
  t.check('token: the filled reply carries the last page\'s token', filled[5] === longToken('T2'));
  t.check('token: the list is exactly the page size asked for', filled[0].length === 20);
}

// --- escapes: a rebuilt reply must be written the way the server writes it ------
// The server writes < > & = / and the line separators as \uXXXX. Plain
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
  const inner = googleJson(payload);
  const chunk = googleJson([['wrb.fr', 'hspqX', inner, null, null, null, 'generic']]);
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
  const { googleJson, frameReply } = page.win.__GMX;
  const bytes = (text) => new TextEncoder().encode(text).length;

  const entry = (id, name) => [id, 10, 12, null, null, null,
    [`https://lh3.googleusercontent.com/gps-cs-s/${id}=w203`, name, [3000, 4000], [203, 100]]];
  const payload = [[entry('CIAB1', 'Caf\u00e9'), entry('CIAB2', 'Na\u00efve')], 45, null, 'S', null, 'TOK'];
  const body = googleJson([['wrb.fr', 'hspqX', googleJson(payload), null, null, null, 'generic']]);
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
  page.allowFill();
    const response = await page.receiveByRequest(replies, askingFor(20));
    const text = await response.text();
    return { page, payload: [...text.matchAll(/"wrb\.fr","hspqX","((?:[^"\\]|\\.)*)"/g)]
      .map((m) => JSON.parse(JSON.parse(`"${m[1]}"`)))[0] };
  };

  t.check('flag: the capped reply really carries one', REPLY_CAPPED[15] === true);

  const at15 = await read([frame('hspqX', Object.assign(JSON.parse(JSON.stringify(REPLY_CAPPED)), { 5: longToken('T1') })),
    galleryReply(10, 45, 'T2', 10)]);
  t.check('flag: emptied where it is today', !at15.payload[15]);
  t.check('flag: and the log says where', at15.page.logs.some((l) => l.includes('cleared the limited flag at [15]')));

  const moved = await read([withFlagAt(17, 'T1'), galleryReply(10, 45, 'T2', 10)]);
  t.check('flag: emptied when Google moves it', !moved.payload[17] && !moved.payload[15]);
  t.check('flag: nothing else changes', moved.payload[0].length === 20 && moved.payload[1] === 45);

  // A true that an uncapped reply carries too is ordinary and stays.
  const page = loadPage();
  page.switchOn();
  page.allowFill();
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
  t.check('token: a hint that still holds a string wins', tokenSlot(payload, 3) === 3);
  t.check('token: nothing long means no token', tokenSlot([[], 45, null, 'x'.repeat(23)]) === null);
  t.check('token: two similar long strings are not guessed between',
    tokenSlot([longToken('A'), longToken('B')]) === null);
  t.check('token: the slot is taught by the token Maps sent back',
    learnTokenSlot(payload, longToken('A')) === 16 && learnTokenSlot(payload, 'other') === null);

  // The fill works when the token has moved.
  const moved = (token, first) => {
    const p = JSON.parse(JSON.stringify(REPLY_CAPPED));
    p[5] = null;
    p[16] = longToken(token);
    return frame('hspqX', p);
  };
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  const response = await page.receiveByRequest([moved('T1'), moved('T2')], askingFor(20));
  t.check('token: a fill follows a token that moved', page.win.fetchCalls.length >= 2 && response !== undefined);
}

// --- follow-up pages Maps asks for itself are not filled again ----------------
// With the token in its request, Maps is paging on its own. Filling those too
// asked the server for another page each time and doubled the requests.
{
  const followUp = REQUEST_2;

  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(true);
  const response = await page.receiveByRequest([galleryReply(10, 116, 'T3', 20)], followUp);

  t.check('follow-up: the request really carries a token',
    JSON.stringify(JSON.parse(new URLSearchParams(followUp).get('f.req'))).includes(TOKEN_1.slice(0, 20)));
  t.check('follow-up: no extra page is fetched', page.win.fetchCalls.length === 1);
  t.check('follow-up: the reply is the server\'s own', await photosIn(response) === 10);
  t.check('follow-up: the log says why',
    page.logs.some((l) => l.includes('follow-up page Maps asked for itself')));

  // The first request, with no token, is still filled.
  const first = loadPage();
  first.switchOn();
  first.allowFill();
  first.api().fillGrid(true);
  const filled = await first.receiveByRequest([
    galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)
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
  page.allowFill();
  await page.receiveByRequest([cappedPage('T1', 0), cappedPage('T2', 10)], askingFor(20));
  page.win.fetchCalls.length = 0;

  const followUp = await page.receiveByRequest([cappedPage('T3', 20, 20)], REQUEST_2);
  t.check('flag: a follow-up page has the flag cleared too', !(await flagged(followUp)));
  t.check('flag: a reply that is already the size asked for needs nothing extra', page.win.fetchCalls.length === 1);
  t.check('flag: the log says so', page.logs.some((l) => l.includes('follow-up page, cleared the limited flag')));
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
  page.allowFill();
  await page.receiveByRequest([capped(10, 112, 'T1', 0), capped(10, 112, 'T2', 10)], askingFor(20));

  const joined = await page.receiveByRequest([capped(10, 112, 'T3', 20), capped(10, 112, 'T4', 30)], REQUEST_2);
  const out = await sizeOf(joined);
  t.check('follow-up: a short page is joined with the next to the size asked for', out.size === 20);
  t.check('follow-up: one extra page is fetched for it', page.win.fetchCalls.length === 2);
  t.check('follow-up: the flag is cleared on it', !out.flag);
  t.check('follow-up: the log says it joined', page.logs.some((l) => l.includes('joined the next page')));

  // The last page has nothing to join.
  const last = await page.receiveByRequest([capped(8, 112, null, 50)], REQUEST_2);
  t.check('follow-up: the last page is left as it is', (await sizeOf(last)).size === 8 && page.win.fetchCalls.length === 1);
}

// --- a jump of the scroll position is recorded in the trace ----------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  const { scrollListeners } = page;
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
  page.allowFill();
  await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)], askingFor(20));
  const el = pane(940, 2070);
  reset(page, el);
  t.check('restore: the position Maps reset is put back', el.scrollTop === 940);
  t.check('restore: and it is traced', page.api().trace().some((e) => e.kind === 'scroll-restored'));
  t.check('restore: and not recorded as a jump', !page.api().trace().some((e) => e.kind === 'scroll-jump'));

  // No reply was handed over: nothing of ours moved it.
  const other = loadPage();
  other.switchOn();
  other.allowFill();
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
// Maps asks for a few photos for the place card first: two of two. Taken as
// the first reply, it hid the real gallery, which then counted as a second
// page, so a capped session was never seen.
{
  const page = loadPage();
  page.switchOn();
  await page.replyByRequest(galleryReply(2, 2, null, 0), askingFor(4));
  await page.replyByRequest(galleryReply(10, 112, 'T1', 0), askingFor(20));
  await wait(50);
  const outcomes = page.sent('gm-roll-outcome');
  t.check('preview: the gallery after it is the first reply reported', outcomes.length === 1 && outcomes[0].firstPage === 10);
  t.check('preview: with its total and what it asked for', outcomes[0]?.serverTotal === 112 && outcomes[0]?.asked === 20);
  t.check('preview: and it is not called a second page', page.sent('gm-gallery-paged').length === 0);
}
{
  // A place that really has two photos is reported once nothing bigger came.
  const page = loadPage();
  page.switchOn();
  await page.replyByRequest(galleryReply(2, 2, null, 0), askingFor(4));
  await wait(2700);
  const outcomes = page.sent('gm-roll-outcome');
  t.check('preview: a place with two photos is still reported', outcomes.length === 1 && outcomes[0].firstPage === 2);
}

// --- the outcome says when the list was lengthened here --------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)], askingFor(20));
  t.check('outcome: a lengthened list is marked as filled', page.sent('gm-roll-outcome')[0]?.filled === true);

  const plain = loadPage();
  plain.switchOn();
  plain.allowFill();
  await plain.receiveByRequest([galleryReply(20, 116, 'T1', 0)], askingFor(20));
  t.check('outcome: the server\'s own list is not', plain.sent('gm-roll-outcome')[0]?.filled === false);
}

// --- a strip of neighbouring photos is not the end of the gallery ---------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  await page.receiveByRequest([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)], askingFor(20));
  // The open photo's neighbours: two photos, a total of two, no token.
  await page.receiveRpc('hspqX', [galleryReply(2, 2, null, 0)]);
  await wait(50);
  t.check('strip: two photos of two do not end the watch as a cut list',
    page.sent('gm-fill-stalled').length === 0);
}

// --- what the background is told, and the private-window fallback ---------------
// A filled list that reaches the page size is reported as served in full, so
// no private window opens. A capped reply that could not be filled is reported
// as it came, so the roll still starts.
{
  const outcome = async (replies, request = askingFor(20)) => {
    const page = loadPage();
    page.switchOn();
  page.allowFill();
    await page.receiveByRequest(replies, request);
    return page.sent('gm-roll-outcome');
  };

  const filled = await outcome([galleryReply(10, 116, 'T1', 0), galleryReply(10, 116, 'T2', 10)]);
  t.check('report: a filled list is reported once', filled.length === 1);
  t.check('report: and as served in full, so nothing is rolled', filled[0]?.firstPage === 20);

  const noMore = await outcome([galleryReply(10, 116, 'T1', 0), 'garbage']);
  t.check('report: when the fill fails, the capped reply is reported as it came', noMore[0]?.firstPage === 10);
  t.check('report: and as capped, so the private-window roll starts',
    noMore[0]?.firstPage < noMore[0]?.asked && noMore[0]?.serverTotal > noMore[0]?.firstPage);

  const noToken = await outcome([galleryReply(10, 116, null, 0)]);
  t.check('report: a capped reply with no token still reaches the roll', noToken[0]?.firstPage === 10);

  const uncapped = await outcome([galleryReply(20, 116, 'T1', 0)]);
  t.check('report: an uncapped reply is reported as it is', uncapped[0]?.firstPage === 20);

  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.api().fillGrid(false);
  await page.receiveByRequest([galleryReply(10, 116, 'T1', 0)], askingFor(20));
  t.check('report: with the fill off the capped reply reaches the roll',
    page.sent('gm-roll-outcome')[0]?.firstPage === 10);
}

// --- switched off -----------------------------------------------------------
{
  const page = loadPage();
  page.reply(galleryReply(10, 45), askingFor(20));
  await wait(50);

  t.check('off: a capped reply is not reported', page.sent('gm-roll-outcome').length === 0);
  t.check('off: nothing is logged either', page.logs.length === 0);
}

// --- a capped gallery -------------------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(10, 45), askingFor(20));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('a capped reply is reported', !!outcome);
  t.check('  served 10', outcome?.firstPage === 10);
  t.check('  of 45', outcome?.serverTotal === 45);
  t.check('  having asked for 20', outcome?.asked === 20);
  t.check('the request is announced before its reply, so silence can be told'
    + ' from a slow answer', page.sent('gm-gallery-asking').length === 1);
}

// --- a place with a great many photos ---------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(10, 250000), askingFor(20));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('a total in the hundreds of thousands is still read, so the cap is still seen',
    outcome?.serverTotal === 250000);
}

// --- an uncapped gallery ----------------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(20, 45), askingFor(20));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('an uncapped reply is reported as served 20', outcome?.firstPage === 20);
}

// --- captured traffic -------------------------------------------------------
//
// Two real pages, replayed as Maps sent them. Everything above this uses the
// same shapes with the counts varied; this checks the shapes themselves.
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(frame('hspqX', REPLY_1), REQUEST_1);
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('real page 1: the gallery is reported', !!outcome);
  t.check('  not mistaken for the single-photo viewer because of the category tabs',
    page.sent('gm-gallery-idle').length === 0);
  t.check('  served 20 of 45', outcome?.firstPage === 20 && outcome?.serverTotal === 45);
  t.check('  having asked for 20, read from the paging message', outcome?.asked === 20);

  page.reply(frame('hspqX', REPLY_2), REQUEST_2);
  await wait(50);

  const [paged] = page.sent('gm-gallery-paged');
  t.check('real page 2: reported as the session paging, 19 photos', paged?.photos === 19);
}

{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(frame('hspqX', REPLY_CAPPED), REQUEST_CAPPED);
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
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
    before.sent('gm-roll-outcome')[0]?.asked === null);

  const generous = loadPage({ localStorage: shared });
  generous.switchOn();
  generous.reply(frame('hspqX', REPLY_1), shifted(REQUEST_1));
  generous.reply(frame('hspqX', REPLY_2), shifted(REQUEST_2));
  await wait(50);
  t.check('moved: a session that pages learns where the page size went, and says so',
    generous.logs.some((l) => l.includes('has moved from [4,2,1] to [4,3,1]')));

  const capped = loadPage({ localStorage: shared });
  capped.switchOn();
  capped.reply(frame('hspqX', REPLY_CAPPED), shifted(REQUEST_CAPPED));
  await wait(50);
  const [outcome] = capped.sent('gm-roll-outcome');
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
  page.allowFill();
  page.reply(frame('hspqX', REPLY_1), REQUEST_1);
  page.reply(frame('hspqX', REPLY_2), REQUEST_2);
  await wait(50);

  t.check('unmoved: paging relearns the default and stays quiet about it',
    !page.logs.some((l) => l.includes('has moved')) && shared.getItem('gmnx.pagingLayout') === null);
}

// --- when the page size cannot be read --------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(10, 45), askingBlind());
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('a page size that is not where it belongs is reported unknown, not guessed',
    outcome?.asked === null);
}

// --- a batch of several calls -----------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(10, 45), askingBatched(20));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('in a batch, the page size is read from the call that served the gallery',
    outcome?.asked === 20);
}

{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(10, 45), 'f.req=' + encodeURIComponent('[[["hspqX",42,null]]]'));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('arguments that are not a JSON string are skipped, not coerced',
    outcome && outcome.asked === null);
}

// --- the second page, which is what a cap actually looks like ---------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(0, 45), askingBlind());
  await wait(50);

  // Not observed: on the captured capped session Maps never asked for a
  // second page at all. Kept so that an empty follow-up, should one ever
  // arrive, is reported as nothing rather than dropped.
  const [paged] = page.sent('gm-gallery-paged');
  t.check('an empty follow-up page is reported', !!paged);
  t.check('  as nothing served', paged?.photos === 0);
}

{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(20, 45), askingBlind());
  await wait(50);

  const [paged] = page.sent('gm-gallery-paged');
  t.check('a second page that arrives says the session can page', paged?.photos === 20);
}

{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(20, 45), askingBlind());
  page.reply(galleryReply(0, 45), askingBlind());
  await wait(50);

  t.check('only the first follow-up counts, so the end of a long scroll is not a cap',
    page.sent('gm-gallery-paged').length === 1);
}

// --- the single photo viewer ------------------------------------------------
{
  const page = loadPage({ url: 'https://www.google.com/maps/@48.86,2.35,3a,75y,90t/data=!3m7' });
  page.switchOn();
  page.allowFill();
  page.reply(galleryReply(1, 45), askingFor(20));
  await wait(50);

  t.check('one photo of many is the viewer, not a capped gallery',
    page.sent('gm-roll-outcome').length === 0);
  t.check('  and it says so, to release the verdict', page.sent('gm-gallery-idle').length === 1);
}

// --- counting what the page itself carries ----------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.scripts.set('state', {
    textContent: 'APP_INITIALIZATION_STATE=' + JSON.stringify(
      Array.from({ length: 27 }, (_, i) => `https://lh3.googleusercontent.com/p/P${i}\\u003dw100`))
  });
  await wait(4500);

  const counts = page.sent('gm-page-photos');
  t.check('the page reports how many photos it has', counts.length > 0);
  t.check('  reading escaped URLs correctly (27, not 0)', counts.some((c) => c.photos === 27));
  t.check('  and marks the last one final', counts.some((c) => c.final));
  t.check('  carrying the address, so a photo view is recognisable',
    counts.every((c) => typeof c.url === 'string'));
}

// --- the same photo at several sizes is one photo ---------------------------
{
  const page = loadPage();
  page.switchOn();
  page.allowFill();
  page.scripts.set('state', {
    textContent: 'APP_INITIALIZATION_STATE=' + JSON.stringify([
      'https://lh3.googleusercontent.com/p/SAME=w203-h152',
      'https://lh3.googleusercontent.com/p/SAME=w86-h86',
      'https://lh3.googleusercontent.com/p/OTHER=w203'
    ])
  });
  await wait(4500);

  const counts = page.sent('gm-page-photos');
  t.check('sizes of one photo are not counted twice',
    counts.length > 0 && Math.max(...counts.map((c) => c.photos)) === 2);
}

// --- the console API --------------------------------------------------------
{
  const page = loadPage();
  t.check('GMGallery.borrowPrivate exists', typeof page.api()?.borrowPrivate === 'function');
  t.check('GMGallery.forget exists', typeof page.api()?.forget === 'function');
  t.check('the state gallery-ui reads is exposed', !!page.win.__GM_GALLERY__);
}

process.exit(t.done());
