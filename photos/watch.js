(() => {
  'use strict';

  // Lengthens a capped gallery. Google serves a session without a sign-in 10
  // photos for the first page, but still serves the pages after it when the
  // token is followed. The first reply is replaced by one that holds the page
  // size Maps asked for, with the limited flag emptied, and Maps pages on from
  // there. Nothing leaves the page: no cookie is read, no reload, no message.

  const { describe, askedFor, single, envelopes, learnLayout, DEFAULT_LAYOUT,
    mergePages, frameReply, at, tokenSlot, learnTokenSlot, capFlags, trueSlots, isPhotoEntry } = window.__GMX;

  // Remove obsolete per-tab data without affecting learned paging metadata.
  try { sessionStorage.removeItem('gmnx.tokenSamples'); } catch (_) {}
  try { sessionStorage.removeItem('gmnx.researchSnapshots'); } catch (_) {}
  try { sessionStorage.removeItem('gmnx.galleryUrl'); } catch (_) {}

  const state = {
    firstPage: null, serverTotal: null, asked: null, rpc: null, seen: 0, viewerOnly: false, paged: null
  };

  const nativeFetch = window.fetch;
  const LOG = '[GM-GALLERY]';

  let photosOn = false;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps') return;
    if (data.type !== 'gm-settings') return;
    const enabled = !!data.features?.photos;
    if (enabled !== photosOn) settingsEpoch++;
    photosOn = enabled;
  });

  const LAYOUT_KEY = 'gmnx.pagingLayout';

  const isIndex = (value) => Number.isSafeInteger(value) && value >= 0;
  const isPath = (value) => Array.isArray(value) && value.length > 0 && value.length <= 12 && value.every(isIndex);
  const validLayout = (value) => value && isPath(value.size) && isPath(value.token)
    && JSON.stringify(value.size) !== JSON.stringify(value.token);
  function storedMap(key, valid) {
    const result = Object.create(null);
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [rpc, entry] of Object.entries(value)) if (valid(entry)) result[rpc] = entry;
      }
    } catch (_) {}
    return result;
  }
  const learned = storedMap(LAYOUT_KEY, validLayout);

  // Where this RPC keeps its page size: the place a paging session taught,
  // or the place captured from real traffic until one does.
  const layoutFor = (rpc) => learned[rpc] || DEFAULT_LAYOUT;

  // Where each RPC's reply keeps the token for the next page. Taught by a
  // follow-up request that sent back a token from the previous reply, and
  // otherwise found by shape (read.js tokenSlot): the one long string.
  const TOKEN_KEY = 'gmnx.tokenSlot';
  const tokenSlots = storedMap(TOKEN_KEY, isIndex);

  // { index, value } of the token in a reply, or null when none stands out.
  function tokenOf(rpc, payload) {
    const index = tokenSlot(payload, tokenSlots[rpc]);
    return index === null ? null : { index, value: payload[index] };
  }

  function rememberTokenSlot(rpc, index) {
    if (tokenSlots[rpc] === index) return;
    tokenSlots[rpc] = index;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenSlots)); } catch (_) {}
    console.log(LOG, `layout ok: rpc=${rpc} tokenSlot=${index}`);
  }

  // Top-level slots that are true in replies that were not capped, so the
  // fill never clears one of them. Kept across loads.
  const NORMAL_KEY = 'gmnx.normalFlags';
  const normalFlags = (() => {
    try {
      const value = JSON.parse(localStorage.getItem(NORMAL_KEY) || '[]');
      return new Set(Array.isArray(value) ? value.filter(isIndex) : []);
    } catch (_) { return new Set(); }
  })();
  function rememberNormalFlags(payload) {
    const before = normalFlags.size;
    for (const i of trueSlots(payload)) normalFlags.add(i);
    if (normalFlags.size === before) return;
    try { localStorage.setItem(NORMAL_KEY, JSON.stringify([...normalFlags])); } catch (_) {}
  }

  // Said even with the feature off: a layout that moved is Google changing
  // the payload, which is worth knowing whatever else is going on.
  function rememberLayout(rpc, layout) {
    const was = layoutFor(rpc);
    if (JSON.stringify(was) === JSON.stringify(layout)) return;

    learned[rpc] = layout;
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(learned)); } catch (_) {}
    console.log(LOG, `layout ok: rpc=${rpc} size=[${was.size}]->[${layout.size}] token=[${was.token}]->[${layout.token}]`);
  }

  // Maps puts several calls in one reply. Each gallery call looks like
  // "wrb.fr","RpcName","<json array>".
  function eachGalleryCall(text, visit) {
    for (const match of text.matchAll(/"wrb\.fr","([A-Za-z0-9]+)","((?:[^"\\]|\\.)*)"/g)) {
      let payload = null;
      try { payload = JSON.parse(JSON.parse(`"${match[2]}"`)); } catch (_) { continue; }
      if (!Array.isArray(payload)) continue;
      if (visit(match[1], payload)) return;
    }
  }

  // --- the first gallery reply, then any page after it -----------------------

  let reportedFirst = false;
  let reportedFollowUp = false;
  let firstExchange = null;

  // The arguments of one call inside a batch. Other calls in the same POST
  // are unrelated, and the same slot in one of them is a different field.
  const argsOf = (body, rpc) => (body ? envelopes(body).find((entry) => entry.rpc === rpc)?.args : null);

  // A second page is what reveals where the page size moved: the continuation
  // token leaves in the reply and comes back in the next request.
  function learnFromFollowUp(requestBody) {
    if (!firstExchange) return;

    const layout = learnLayout(firstExchange.args, firstExchange.reply, firstExchange.served,
      argsOf(requestBody, state.rpc));
    if (layout) rememberLayout(state.rpc, layout);

    const sent = at(argsOf(requestBody, state.rpc), layoutFor(state.rpc).token);
    const slot = learnTokenSlot(firstExchange.reply, sent);
    if (slot !== null) rememberTokenSlot(state.rpc, slot);
  }

  // A later reply from the same RPC. One photo is someone opening a picture
  // from the grid, not an answer about paging. An empty page is the server
  // declining to continue.
  function onFollowUp(text, requestBody) {
    if (!state.rpc) return;
    learnFromFollowUp(requestBody);

    eachGalleryCall(text, (rpc, payload) => {
      if (rpc !== state.rpc) return false;
      if (single(payload)) { state.viewerOnly = true; return true; }
      const found = describe(payload);
      if (found?.total !== null && found?.total <= found?.size) return true;
      state.viewerOnly = false;
      if (reportedFollowUp) return true;

      reportedFollowUp = true;
      const more = describe(payload);
      const photos = more ? more.size : 0;
      state.paged = photos;

      trace('gallery-page', { photos });

      return true;
    });
  }

  // The first real reply of the current gallery. New place arguments or a
  // recognized first-page request reset this before the reply is processed.
  function onFirstGallery(text, requestBody) {
    if (reportedFirst) {
      onFollowUp(text, requestBody);
      return;
    }

    eachGalleryCall(text, (rpc, payload) => {
      // A URL naming one photo opens that photo rather than the grid. That
      // is not a capped gallery, and one photo must not look like a failure.
      if (single(payload)) {
        state.viewerOnly = true;
        return true;
      }

      const found = describe(payload);
      if (!found) return false;

      // A list that is complete as it stands (no more photos than it holds)
      // is the small preview Maps asks for to draw the place card, not the
      // gallery. It says nothing about the cap: a capped session gets the same
      // two photos. Taken as the first reply it hid the real one, which then
      // counted as a second page. It is skipped, and the gallery reply is read
      // when it comes.
      if (typeof found.total === 'number' && found.total <= found.size) {
        return true;
      }

      acceptFirst(rpc, payload, found, requestBody);
      return true;
    });
  }

  // The first gallery reply of the current gallery, reported once.
  function acceptFirst(rpc, payload, found, requestBody) {
    // Only this call's arguments are the page size. A batch holds other
    // calls, and the same slot in one of those is a different field.
    const asked = requestBody
      ? askedFor(requestBody, { rpc, served: found.size, layoutFor })
      : null;

    firstExchange = { args: argsOf(requestBody, rpc), reply: payload, served: found.size };
    state.rpc = rpc;
    state.firstPage = found.size;
    state.serverTotal = found.total;
    state.asked = asked;
    state.seen++;
    state.viewerOnly = false;

    reportedFirst = true;
    trace('gallery-first', { served: found.size, total: found.total, asked });
  }

  // --- the scroll position Maps resets after a reply was handed over ---------
  //
  // When the last reply was handed to Maps in place of the server's, Maps
  // resets the grid's scroll position as the list grows. The scroll watch near
  // the end of this file puts it back.
  let handedOverAt = -Infinity;
  const RESTORE_WINDOW_MS = 1500;

  // --- fetch and XHR ----------------------------------------------------------
  //
  // Maps sends the gallery call by XHR. fetch is hooked the same way in case
  // that changes. The request is left to the browser; only the reply is read.

  // A batchexecute POST is where the gallery call travels.
  const isBatch = (url, body) =>
    typeof body === 'string' && String(url).includes('batchexecute');

  let galleryKey = null;
  let galleryEpoch = 0;
  let settingsEpoch = 0;
  function prepareGallery(text, body) {
    eachGalleryCall(text, (rpc, payload) => {
      const found = describe(payload);
      if (single(payload) || !found || (found.total !== null && found.total <= found.size)) return false;
      const args = argsOf(body, rpc);
      const key = JSON.stringify([rpc, args?.[2] ?? null]);
      const cursor = at(args, layoutFor(rpc).token);
      const starts = (cursor === null || cursor === '') && askedFor(body, { rpc, layoutFor }) !== null;
      if (galleryKey !== key || starts) {
        galleryKey = key;
        galleryEpoch++;
        reportedFirst = false;
        reportedFollowUp = false;
        firstExchange = null;
        clearedFlags.length = 0;
        deliveredPhotos.clear();
        handedOverAt = -Infinity;
        Object.assign(state, { firstPage: null, serverTotal: null, asked: null, rpc: null,
          seen: 0, viewerOnly: false, paged: null });
      }
      return true;
    });
    return galleryEpoch;
  }

  function readReply(text, requestBody, prepared = false) {
    if (!prepared) prepareGallery(text, requestBody);
    record(text, requestBody);
    onFirstGallery(text, requestBody);
  }

  // Shape-only diagnostics: lengths, types, counts and flags. No token
  // content or photo URL is kept. Read them with GMGallery.capture().
  const recorded = [];
  const peek = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return `string(${value.length})`;
    if (Array.isArray(value)) return `array(${value.length})`;
    // Flags and counts are shown with their value: whether a reply says
    // "more pages exist" is exactly what a capture is read for.
    if (typeof value === 'boolean' || typeof value === 'number') return `${typeof value}:${value}`;
    return typeof value;
  };

  function record(text, requestBody) {
    try {
      const calls = [];
      eachGalleryCall(text, (rpc, payload) => {
        calls.push({
          rpc,
          length: payload.length,
          listLength: Array.isArray(payload[0]) ? payload[0].length : null,
          total: typeof payload[1] === 'number' ? payload[1] : null,
          slots: payload.map((value, index) => [index, peek(value)]).filter(([, p]) => p !== null)
        });
        return false;
      });

      const sent = requestBody ? envelopes(requestBody).map((entry) => ({
        rpc: entry.rpc,
        argsLength: entry.args?.length ?? null,
        paging: peek(entry.args?.[4]?.[2])
      })) : [];

      recorded.push({ at: Date.now(), bytes: text.length, requests: sent, calls });
      if (recorded.length > 20) recorded.shift();
    } catch (_) {}
  }

  // fetch is hooked in case Maps stops using XHR. The request itself is
  // left alone; only a copy of the reply is read. Maps now sends the gallery
  // call as fetch(new Request(...)) with no second argument, so the body is
  // read from a clone of the request when init does not carry one.
  async function fetchBody(input, init) {
    if (typeof init?.body === 'string') return init.body;
    if (init?.body != null) return null;
    if (typeof Request === 'undefined' || !(input instanceof Request)) return null;
    if (input.method === 'GET' || input.method === 'HEAD') return null;

    try { return await input.clone().text(); } catch (_) { return null; }
  }

  // --- the capped first page, filled from the pages after it ------------------
  //
  // A session cut to ten photos a page still serves the later pages when the
  // token is followed. With the photos switch on, the capped reply is
  // replaced by a longer one and Maps pages on from there. Nothing stored
  // means on; GMGallery.fillGrid(false) turns it off for this tab's session,
  // which shows the list exactly as Google sent it.
  const FILL_KEY = 'gmnx.fillGrid';
  // On whenever the photos switch is. GMGallery.fillGrid(false) turns it off
  // for this tab's session, fillGrid(true) forces it on, and fillGrid('auto')
  // goes back to following the switch.
  const fillOn = () => {
    try {
      const value = sessionStorage.getItem(FILL_KEY);
      if (value === '1') return true;
      if (value === '0') return false;
    } catch (_) {}
    return photosOn;
  };
  const MAX_FILL_PAGES = 15;

  // A Response carrying other text that still looks like the one the network
  // gave. A constructed Response has no url, type "default" and redirected
  // false, where a fetched one has the request's url, type "basic" and the
  // real redirected flag. Code that reads any of them can tell the two apart
  // and refuse the copy without throwing, so they are copied across.
  function replaceResponse(original, text) {
    const copy = new Response(text, {
      status: original.status, statusText: original.statusText, headers: original.headers
    });
    for (const key of ['url', 'type', 'redirected']) {
      try { Object.defineProperty(copy, key, { value: original[key], configurable: true }); } catch (_) {}
    }
    return copy;
  }

  // The slots the first fill emptied, so later pages get the same treatment.
  const clearedFlags = [];

  // Unique image-bearing IDs in replies prepared for the current gallery.
  // This measures supplied data, not rendered DOM tiles or Google's total.
  const deliveredPhotos = new Set();
  function logGalleryResult(action, rpc, payload, serverBatch, pages, flags, started) {
    const details = describe(payload);
    const list = details ? payload.find((value) => Array.isArray(value) && value.length === details.size
      && value.some(isPhotoEntry)) : [];
    for (const entry of list || []) {
      if (isPhotoEntry(entry) && typeof entry[0] === 'string') deliveredPhotos.add(entry[0]);
    }
    const more = !!tokenOf(rpc, payload);
    console.log(LOG, `${action} ok: serverBatch=${serverBatch} deliveredBatch=${details?.size ?? 0}`
      + ` uniqueSupplied=${deliveredPhotos.size} announcedTotal=${details?.total ?? 'unknown'}`
      + ` nextToken=${more ? 'present' : 'none'} serverPages=${pages} flagsCleared=${flags}`
      + ` ms=${Math.round(performance.now() - started)}`);
  }

  // Requests being filled, so a page fetched here is never filled again.
  const fillBusy = new Set();

  // Replay the incoming cursor at size 10. The original size-20 response
  // cannot be used: its next token advances past photos it never returned.
  async function sizedPages(url, body, rpc, wanted, active) {
    const params = new URLSearchParams(body);
    const outer = JSON.parse(params.get('f.req'));
    const call = outer?.[0]?.find((entry) => entry?.[0] === rpc);
    if (!call || !Number.isInteger(wanted) || wanted < 1 || wanted > 100) return null;
    const args = JSON.parse(call[1]);
    const layout = layoutFor(rpc);
    const sizeSlot = at(args, layout.size.slice(0, -1));
    const tokenSlot = at(args, layout.token.slice(0, -1));
    if (!Array.isArray(sizeSlot) || !Array.isArray(tokenSlot)) return null;
    const tokenIndex = layout.token.at(-1);
    const pages = [];
    const cursors = new Set();
    let merged = null;
    let lastToken = null;
    let terminal = null;
    for (let i = 0; i < MAX_FILL_PAGES; i++) {
      if (!active()) return null;
      const cursor = tokenSlot[tokenIndex] ?? null;
      if (cursors.has(cursor)) return null;
      cursors.add(cursor);
      sizeSlot[layout.size.at(-1)] = Math.min(10, wanted - (describe(merged?.payload || [])?.size || 0));
      call[1] = JSON.stringify(args);
      params.set('f.req', JSON.stringify([[call]]));
      const response = await nativeFetch(url, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: params.toString()
      });
      if (response.status !== 200) return null;
      const text = await response.text();
      if (!active()) return null;
      let payload = null;
      eachGalleryCall(text, (name, value) => {
        if (name !== rpc) return false;
        payload = value;
        return true;
      });
      if (!payload) return null;
      const found = describe(payload);
      if (!found) {
        // Google represents an exhausted photo list as null or []. Require
        // gallery metadata and earlier photos so malformed replies still fail.
        const empty = payload[0] === null || (Array.isArray(payload[0]) && payload[0].length === 0);
        if (!empty || !merged || !Number.isSafeInteger(payload[1]) || payload[1] < 0) return null;
        lastToken = null;
        terminal = payload;
        break;
      }
      const before = describe(merged?.payload || [])?.size || 0;
      pages.push(payload);
      merged = mergePages(pages);
      const count = describe(merged?.payload || [])?.size || 0;
      if (count <= before) return null;
      lastToken = tokenOf(rpc, payload)?.value ?? null;
      // Even a full merged batch must not hand Maps a cursor already used.
      if (lastToken && cursors.has(lastToken)) return null;
      if (!lastToken) terminal = payload;
      if (count >= wanted || !lastToken) break;
      tokenSlot[tokenIndex] = lastToken;
    }
    if (!merged) return null;
    const firstToken = tokenOf(rpc, pages[0]);
    if (firstToken) merged.payload[firstToken.index] = lastToken;
    // End-of-list booleans belong to the terminal response, not page one.
    if (terminal) for (const index of trueSlots(terminal)) merged.payload[index] = true;
    return { payload: merged.payload, pages: pages.length };
  }

  // The reply Maps should read: the first page with the later pages' photos
  // appended. Null whenever there is nothing to improve or anything fails, in
  // which case the original reply goes through untouched.
  async function filledReply(url, body, text, active) {
    const started = performance.now();
    let attempted = false;
    const fail = (reason) => {
      if (!active()) return null;
      trace('fill-failed', { reason, durationMs: Math.round(performance.now() - started) });
      console.warn(LOG, `fill failed: ${reason}; ms=${Math.round(performance.now() - started)}`);
      return null;
    };
    try {
      let first = null;
      let rpc = null;
      eachGalleryCall(text, (name, payload) => {
        const found = describe(payload);
        if (single(payload) || !found || (found.total !== null && found.total <= found.size)) return false;
        first = payload;
        rpc = name;
        return true;
      });
      if (!first) return null;

      // Follow-up requests keep Maps' incoming cursor, but short responses
      // are replayed at size 10 before their cursor can skip unseen photos.
      const asking = envelopes(body).find((entry) => entry.rpc === rpc);
      const sentToken = asking ? at(asking.args, layoutFor(rpc).token) : null;
      if (typeof sentToken === 'string' && sentToken) {
        // The server sets the limited flag on every page it serves, so a page
        // left as it came would stop Maps after one more. The same slots the
        // first fill emptied are emptied here. Only those: the last page has
        // an end marker that must stay.
        const stuck = clearedFlags.filter((index) => first[index] === true);
        if (!stuck.length) return null;
        attempted = true;

        // A capped session serves 10 where Maps asked for 20. The first fill
        // hands over up to 20. Replay this incoming cursor at size 10, then
        // merge consecutive server pages without reusing the skipped cursor.
        const own = describe(first);
        const wanted = askedFor(body, { rpc, served: own.size, layoutFor });
        let merged = { payload: first.slice(), added: 0 };
        let serverPages = 0;
        if (typeof wanted === 'number' && wanted > 10 && own.size < wanted) {
          const replay = await sizedPages(url, body, rpc, wanted, active);
          if (!replay) return fail('size-10 replay failed');
          merged = { payload: replay.payload, added: describe(replay.payload).size - own.size };
          serverPages = replay.pages;
        }
        for (const index of stuck) merged.payload[index] = null;
        trace('follow-up', { own: own.size, joined: merged.added, handedOver: own.size + merged.added });
        const framed = frameReply(rpc, merged.payload, text);
        logGalleryResult('page', rpc, merged.payload, own.size, serverPages, stuck.length, started);
        return framed;
      }
      const firstToken = tokenOf(rpc, first);
      if (!firstToken) return null;

      const found = describe(first);
      const asked = askedFor(body, { rpc, served: found.size, layoutFor });

      // Capped means the server sent fewer photos than were asked for while
      // announcing more. Without the page size nothing is claimed.
      if (typeof asked !== 'number') return null;
      if (!(typeof found.total === 'number' && found.total > found.size && found.size < asked)) {
        // A reply that is not capped shows which true slots are ordinary.
        rememberNormalFlags(first);
        return null;
      }

      attempted = true;
      const replay = await sizedPages(url, body, rpc, asked, active);
      const took = Math.round(performance.now() - started);
      if (!replay) return fail('size-10 replay failed');
      const merged = { payload: replay.payload, added: describe(replay.payload).size - found.size };
      trace('fill', { pages: replay.pages, durationMs: took, serverPageSize: 10 });
      if (merged.added <= 0) return fail('further pages added no photos');

      // An uncapped session answers with exactly the page size asked for and
      // the token for the page after it, and Maps pages on from there. The
      // same is done here: the list stops where the pages used stop, and the
      // token is the last size-10 page's, not the original size-20 cursor.
      // sizedPages already installed the last size-10 response's cursor.

      // The capped reply carries true in slot 15, which the uncapped first
      // page does not have at all. While it is set Maps does not ask for the
      // next page: with it emptied, scrolling went on to load the rest of
      // the list. It is emptied whenever a capped reply is filled.
      const cleared = capFlags(first, [...normalFlags]);
      for (const index of cleared) merged.payload[index] = null;
      for (const index of cleared) if (!clearedFlags.includes(index)) clearedFlags.push(index);
      const framed = frameReply(rpc, merged.payload, text);
      deliveredPhotos.clear();
      logGalleryResult('fill', rpc, merged.payload, found.size, replay.pages, cleared.length, started);
      return framed;
    } catch (_) {
      return attempted ? fail('paging or framing failed') : null;
    }
  }

  window.fetch = function galleryFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const direct = typeof init?.body === 'string' ? init.body : null;
    // A string body is known now. A Request body has to be read, which is
    // asynchronous, so a clone is taken before the request is sent: the
    // original is consumed by the send, and cloning afterwards throws.
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const wantsBody = String(url).includes('batchexecute');
    const bodyPromise = wantsBody && isRequest && direct === null
      ? fetchBody(input, init)
      : Promise.resolve(direct);

    const response = nativeFetch.apply(this, arguments);
    if (!wantsBody) return response;

    return response.then(async (res) => {
      try {
        const body = await bodyPromise;
        if (!isBatch(url, body)) return res;
        const text = await res.clone().text();
        const epoch = prepareGallery(text, body);
        const settings = settingsEpoch;
        const active = () => fillOn() && galleryEpoch === epoch && settingsEpoch === settings;

        // What the page's own reading sees: the server's reply, or the
        // longer one handed to Maps in its place.
        let reported = false;
        const report = (reply) => {
          if (reported) return;
          reported = true;
          if (galleryEpoch === epoch) readReply(reply, body, true);
        };

        // The capped first page is replaced by a fuller one when asked for.
        // Anything that goes wrong leaves the original response in place.
        if (res.status === 200 && fillOn() && !fillBusy.has(url)) {
          fillBusy.add(url);
          try {
            const filled = await filledReply(url, body, text, active);
            if (filled && active()) {
              report(filled);
              handedOverAt = performance.now();
              return replaceResponse(res, filled);
            }
          } finally {
            fillBusy.delete(url);
          }
        }
        report(text);
      } catch (_) {}
      return res;
    });
  };

  const proto = XMLHttpRequest.prototype;
  const nativeOpen = proto.open;
  const nativeSend = proto.send;

  // XHR does not keep its URL on the object that later receives the reply,
  // so the URL is stored here at open time.
  proto.open = function galleryOpen(method, url) {
    try { this.__gm = String(url); } catch (_) {}
    return nativeOpen.apply(this, arguments);
  };

  // The path Maps actually uses for the gallery call.
  proto.send = function gallerySend(body) {
    const url = this.__gm;
    const batch = url && isBatch(url, body);

    if (batch) {
      const xhr = this;
      xhr.addEventListener('loadend', () => {
        try {
          if (xhr.status !== 200 || (xhr.responseType && xhr.responseType !== 'text')) return;
          readReply(xhr.responseText, body);
        } catch (_) {}
      });
    }
    return nativeSend.apply(this, arguments);
  };

  // --- console API ------------------------------------------------------------

  // ui.js reads this and must not hide anything while a single photo is
  // open. The two scripts run in the same world but load separately.
  window.__GM_GALLERY__ = state;

  window.GMGallery = {
    // fillGrid() reports. true forces the fill on, false turns it off, and
    // 'auto' goes back to following the photos switch.
    fillGrid: (on) => {
      if (on === undefined) return fillOn() ? 'on' : 'off';
      const value = on === true ? '1' : (on === 'auto' ? null : '0');
      settingsEpoch++;
      try {
        if (value === null) sessionStorage.removeItem(FILL_KEY);
        else sessionStorage.setItem(FILL_KEY, value);
      } catch (_) { return 'could not be saved'; }
      return on === true ? 'on: reload the place, then open the Photos grid'
        : (on === 'auto' ? 'following the photos switch' : 'off');
    },

    // The shape of each gallery request and reply seen on this page, with no
    // photo URLs or token content in it.
    capture: () => JSON.parse(JSON.stringify(recorded)),

    // What happened since the page began: errors, rejections, clicks and
    // batchexecute calls, each with a time in milliseconds. Messages are cut
    // short and no URL, token or photo is kept.
    trace: () => JSON.parse(JSON.stringify(traced))
  };

  // --- what happens when the gallery is opened ------------------------------
  //
  // The click that should open the gallery can fail in ways nothing here
  // would otherwise show: an error thrown in the page, a request that never
  // comes back, a reply Maps refuses. This records them, in shape only, from
  // the page's first moment. Read it with GMGallery.trace().
  const traced = [];
  const trace = (kind, detail) => {
    traced.push({ ms: Math.round(performance.now()), kind, ...detail });
    if (traced.length > 200) traced.shift();
  };

  window.addEventListener('error', (event) => {
    trace('error', {
      message: String(event.message || '').slice(0, 160),
      where: `${String(event.filename || '').split('/').pop().slice(0, 40)}:${event.lineno}:${event.colno}`
    });
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    trace('rejection', { message: String(event.reason?.message || event.reason || '').slice(0, 160) });
  }, true);

  // A scroll position that falls a long way in one step, with the pane's
  // height before and after. A height that shrinks means the list was rebuilt;
  // a height that holds means something moved the scroll. Positions only.
  const lastScroll = new WeakMap();
  const JUMP_PX = 600;
  document.addEventListener('scroll', (event) => {
    const el = event.target && event.target.nodeType === 1 ? event.target : null;
    if (!el) return;
    const now = { top: Math.round(el.scrollTop), height: Math.round(el.scrollHeight) };
    const was = lastScroll.get(el);
    lastScroll.set(el, now);
    if (!was || was.top - now.top < JUMP_PX) return;

    // A fall in the same step that the pane grew, soon after a reply handed
    // over: Maps appended the photos and reset the position. The position it
    // had is put back. A user dragging the scrollbar changes no height.
    const grew = now.height > was.height;
    const soon = performance.now() - handedOverAt < RESTORE_WINDOW_MS;
    if (grew && soon && fillOn()) {
      try { el.scrollTop = was.top; } catch (_) {}
      lastScroll.set(el, { top: was.top, height: now.height });
      trace('scroll-restored', { from: now.top, to: was.top, heightBefore: was.height, heightAfter: now.height });
      return;
    }

    trace('scroll-jump', {
      from: was.top, to: now.top, heightBefore: was.height, heightAfter: now.height,
      rebuilt: now.height < was.height,
      tiles: el.querySelectorAll ? el.querySelectorAll('[style*="top"][style*="left"]').length : null
    });
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target;
    const label = (target?.closest?.('[aria-label]')?.getAttribute('aria-label') || target?.textContent || '')
      .trim().slice(0, 40);
    trace('click', { tag: target?.tagName || null, label });
  }, true);

  // Calls to batchexecute, by rpc name, so a call that was made and one that
  // never was can be told apart.
  const seenCall = (url, how) => {
    if (!String(url).includes('batchexecute')) return;
    const rpc = new URL(url, location.href).searchParams.get('rpcids');
    trace('call', { rpc, how });
  };
  const tracedFetch = window.fetch;
  window.fetch = function tracingFetch(input) {
    seenCall(typeof input === 'string' ? input : input?.url, 'fetch');
    return tracedFetch.apply(this, arguments);
  };
})();
