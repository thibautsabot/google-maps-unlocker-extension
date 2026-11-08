(() => {
  'use strict';

  // Reports what this page load was given. No cookies, no reload, no hiding:
  // the background script decides what to do with it.
  //
  //   photos already in the page or the place payload   gm-page-photos
  //   a gallery request leaving                          gm-gallery-asking
  //   the first gallery reply                            gm-roll-outcome
  //   a later page of that same gallery                  gm-gallery-paged
  //   a reply that is one open photo, not the grid       gm-gallery-idle
  //   a filled grid that Maps then does not page on      gm-fill-stalled
  //
  // It does change one thing: a capped first reply is replaced by a longer
  // one (see filledReply), and only the background touches cookies.
  //
  // The first reply is reported once. Later replies of the same gallery are
  // follow-up pages, and only the first of those is reported — the end of a
  // long scroll is not another cap.

  const { describe, askedFor, single, photoUrls, envelopes, learnLayout, DEFAULT_LAYOUT,
    mergePages, frameReply, at, tokenSlot, learnTokenSlot, capFlags, trueSlots } = window.__GMX;

  const state = {
    firstPage: null, serverTotal: null, asked: null, rpc: null, seen: 0, viewerOnly: false,
    bootstrapPhotos: null
  };

  const nativeFetch = window.fetch;
  const LOG = '[GM-GALLERY]';

  let photosOn = false;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== 'gm-native-maps' || data.type !== 'gm-settings') return;
    photosOn = !!data.features?.photos;
  });

  // Hands a report to bridge.js, which is the only script here that can
  // reach the background. Nothing is sent while the feature is off.
  const tell = (message) => {
    if (!photosOn) return;
    try { window.postMessage({ source: 'gm-native-maps', ...message }, location.origin); } catch (_) {}
  };

  const note = (...parts) => {
    if (photosOn) console.log(LOG, ...parts);
  };

  const LAYOUT_KEY = 'gmnx.pagingLayout';

  const learned = (() => {
    try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch (_) { return {}; }
  })();

  // Where this RPC keeps its page size: the place a paging session taught,
  // or the place captured from real traffic until one does.
  const layoutFor = (rpc) => learned[rpc] || DEFAULT_LAYOUT;

  // Where each RPC's reply keeps the token for the next page. Taught by a
  // follow-up request that sent back a token from the previous reply, and
  // otherwise found by shape (read.js tokenSlot): the one long string.
  const TOKEN_KEY = 'gmnx.tokenSlot';
  const tokenSlots = (() => {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}') || {}; } catch (_) { return {}; }
  })();

  // { index, value } of the token in a reply, or null when none stands out.
  function tokenOf(rpc, payload) {
    const index = tokenSlot(payload, tokenSlots[rpc]);
    return index === null ? null : { index, value: payload[index] };
  }

  function rememberTokenSlot(rpc, index) {
    if (tokenSlots[rpc] === index) return;
    tokenSlots[rpc] = index;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokenSlots)); } catch (_) {}
    console.warn(LOG, `the next-page token in ${rpc} replies sits at [${index}] — learned from a session that paged`);
  }

  // Top-level slots that are true in replies that were not capped, so the
  // fill never clears one of them. Kept across loads.
  const NORMAL_KEY = 'gmnx.normalFlags';
  const normalFlags = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(NORMAL_KEY) || '[]')); } catch (_) { return new Set(); }
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
    console.warn(LOG, `the page size in ${rpc} requests has moved from`
      + ` [${was.size}] to [${layout.size}] — learned from a session that paged`);
  }

  // The address to reload after a borrow. Once a photo is open the tab's URL
  // names that photo, and reloading it lands in the viewer with no grid, so
  // Escape drops to the bare map. Kept in sessionStorage because the useful
  // address belongs to the previous page load.
  const GALLERY_URL_KEY = 'gmnx.galleryUrl';

  // Called when a real gallery arrives, so a later borrow reloads the grid
  // rather than whatever photo happens to be open.
  const rememberGalleryUrl = () => {
    try { sessionStorage.setItem(GALLERY_URL_KEY, location.href); } catch (_) {}
  };

  // The grid address from the previous load. Null when this tab has not
  // shown a gallery yet; the borrow then uses the address it is on.
  const rememberedGalleryUrl = () => {
    try { return sessionStorage.getItem(GALLERY_URL_KEY); } catch (_) { return null; }
  };

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
  let viewerLogged = false;
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
    if (reportedFollowUp || !state.rpc) return;
    learnFromFollowUp(requestBody);

    eachGalleryCall(text, (rpc, payload) => {
      if (rpc !== state.rpc || single(payload)) return false;

      reportedFollowUp = true;
      const more = describe(payload);
      const photos = more ? more.size : 0;

      note(photos
        ? `a second page of ${photos} photos arrived, so this session can page`
        : 'a second page came back empty, so this session is capped where it stands');

      tell({ type: 'gm-gallery-paged', photos });
      return true;
    });
  }

  // The first real gallery in this load. Once that has been reported, every
  // later reply is a follow-up page instead.
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
        if (!viewerLogged) {
          viewerLogged = true;
          note('this load opened a single photo, not the gallery.'
            + ' Press Escape or use the back arrow to reach the grid, then scroll');

          tell({ type: 'gm-gallery-idle' });
        }
        return true;
      }

      const found = describe(payload);
      if (!found) return false;

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
      rememberGalleryUrl();

      reportedFirst = true;
      note(`this session was served ${found.size} photos`
        + (found.total ? ` of ${found.total}` : '')
        + (asked ? `, having asked for ${asked}` : ', and what it asked for is unknown'));

      tell({ type: 'gm-roll-outcome', firstPage: found.size, serverTotal: found.total, asked });
      return true;
    });
  }

  // --- photos the page already has, before any gallery request ---------------
  //
  // An uncapped session often makes no gallery request at all: the photos
  // arrived with the page. Counting only replies would report nothing exactly
  // when everything is working.

  // The request that carries the place's photos when Maps fetches them
  // instead of embedding them in the HTML.
  const isPlaceBootstrap = (url) => String(url).includes('/maps/preview/place');

  let bootstrapReported = false;

  // How many distinct photo URLs, and whether the page has finished adding
  // them. final is what lets the background stop waiting for more.
  function tellCount(photos, final) {
    tell({ type: 'gm-page-photos', photos, final, url: location.href });
  }

  // fromNetwork is the place payload Maps fetches when the gallery opens.
  // The copy embedded in the HTML at load time carries two preview images
  // and is not worth announcing on its own, so a smaller embedded count
  // never replaces a larger one.
  function notePagePhotos(distinct, fromNetwork) {
    if (!fromNetwork && distinct.size <= (state.bootstrapPhotos ?? -1)) return;

    if (fromNetwork) bootstrapReported = true;
    state.bootstrapPhotos = distinct.size;
    tellCount(distinct.size, false);
    note(fromNetwork
      ? `the place payload carried ${distinct.size} distinct photo URLs`
      : `${distinct.size} distinct photo URLs on the page so far`);
  }

  // One network copy of the place data. A later copy is the same photos
  // again, so it is not announced a second time.
  function onPlacePayload(text) {
    if (bootstrapReported) return;
    notePagePhotos(photoUrls(text), true);
  }

  // On a hard load the place data is in the HTML, so there is no request to
  // read and the hooks below never run. Navigating inside Maps fetches it
  // instead, which is why this only matters on a fresh page load.
  function readEmbeddedPlace() {
    if (reportedFirst) return;

    // Maps spreads the photos over several inline scripts and keeps adding
    // them. Images already on screen count too: by then some exist only in
    // the DOM.
    const urls = new Set();

    for (const script of document.querySelectorAll('script:not([src])')) {
      for (const url of photoUrls(script.textContent || '')) urls.add(url);
    }
    for (const img of document.images) {
      for (const url of photoUrls(img.src || '')) urls.add(url);
    }

    if (urls.size) notePagePhotos(urls, false);
  }

  // --- a fill that Maps does not page on --------------------------------------
  //
  // After the fill, Maps should ask for the next page once the grid is
  // scrolled to its end. If the grid sits at its end and nothing is asked for,
  // the list was accepted but the way to more was not, which the fill cannot
  // fix by itself. That is reported once, and the background then falls back
  // to a private-window session. A gallery request leaving, or a reply to one,
  // proves Maps does page and ends the watch for good.
  // When the last reply was handed to Maps in place of the server's. Maps
  // resets the grid's scroll position when such a reply grows the list, which
  // the scroll watch below puts back.
  let handedOverAt = -Infinity;
  const RESTORE_WINDOW_MS = 1500;

  const STALL_MS = 3500;
  // A finished list holding less than this share of the announced total is cut.
  const SHORT_OF_TOTAL = 0.9;
  const AT_END_PX = 80;
  const stall = {
    rpc: null, report: null, timer: null, watching: false, done: false,

    // loaded and total let the end of the list be judged: the server's last
    // page arriving with far fewer photos than it announced means the session
    // is cut, and the fill alone cannot lift that.
    loaded: 0, total: null,

    arm(rpc, report, loaded = 0, total = null) {
      if (this.done) return;
      this.rpc = rpc;
      this.report = report;
      // Only the first fill sets the count. A filled follow-up arms again, and
      // its own page is already counted by observe.
      if (this.watching) return;
      this.loaded = loaded;
      this.total = total;
      this.watching = true;
      try { document.addEventListener('scroll', (event) => this.scrolled(event.target), true); } catch (_) {}
    },

    // A reply that came after the fill. The list having ended is not a stall:
    // Maps rightly asks for nothing more after an empty page, one without a
    // token, or a page shorter than the ones before it, which is how the
    // server marks its last. Only a list that could go on and does not is.
    biggest: 0,
    observe(rpc, payload) {
      if (this.done || !this.rpc || rpc !== this.rpc) return;
      const found = describe(payload);
      const size = found ? found.size : 0;
      const ended = size === 0 || !tokenOf(rpc, payload) || (this.biggest > 0 && size < this.biggest);
      this.biggest = Math.max(this.biggest, size);
      this.loaded += size;
      if (!ended) return;

      const short = typeof this.total === 'number' && this.loaded < this.total * SHORT_OF_TOTAL;
      this.finish();
      if (!short) return;

      console.warn(LOG, `fill: the list ended at ${this.loaded} of ${this.total}, so this session is cut`);
      this.report?.();
    },

    // Maps asked for another page: it does page, so reaching the end of the
    // grid is no longer a sign of trouble. The count goes on, though, because
    // the list can still end short of its total.
    paged: false,
    proven() {
      this.paged = true;
      clearTimeout(this.timer);
    },

    // The watch is over: the list ended, whatever came of it.
    finish() {
      this.done = true;
      clearTimeout(this.timer);
    },

    atEnd(node) {
      const el = node && node.nodeType === 1 ? node : document.scrollingElement;
      if (!el || !(el.scrollHeight > el.clientHeight)) return false;
      return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_PX;
    },

    scrolled(target) {
      if (this.done || this.paged || !this.rpc || !this.atEnd(target)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.done) return;
        this.done = true;
        console.warn(LOG, 'fill: the grid reached its end and Maps asked for no further page');
        this.report?.();
      }, STALL_MS);
    }
  };

  // --- fetch and XHR ----------------------------------------------------------
  //
  // Maps sends the gallery call by XHR. fetch is hooked the same way in case
  // that changes. The request is left to the browser; only the reply is read.
  //
  // The request is reported as it leaves, before any reply. Silence is how
  // the background script recognises an uncapped session, so it has to know
  // when a request is on its way — otherwise the gap before a slow reply
  // looks like silence and the cap is called lifted while the answer is
  // still coming.

  // A batchexecute POST is where the gallery call travels.
  const isBatch = (url, body) =>
    typeof body === 'string' && String(url).includes('batchexecute');

  let askedAnnounced = false;

  const noteAsked = (batch, body) => {
    if (batch && stall.rpc && envelopes(body).some((entry) => entry.rpc === stall.rpc)) stall.proven();
    if (!batch || askedAnnounced || askedFor(body, { layoutFor }) === null) return;
    askedAnnounced = true;

    tell({ type: 'gm-gallery-asking' });
  };

  function readReply(batch, text, requestBody, url = null) {
    if (batch) eachGalleryCall(text, (rpc, payload) => {
      if (single(payload)) return false;
      stall.observe(rpc, payload);
      return true;
    });
    if (batch) record(text, requestBody, url);
    if (batch) onFirstGallery(text, requestBody);
    else onPlacePayload(text);
  }

  // What each gallery exchange looked like, for working out why a session is
  // capped when the reply is not the one expected. The shape only: lengths,
  // types, the page size asked for and the first characters of any token.
  // No photo URL is kept. Read it with GMGallery.capture().
  const recorded = [];
  // The last gallery request and reply, kept whole in this variable and
  // nowhere else. It holds the session and tokens of the request, so it is
  // never logged and never leaves the page; probeNextPage() resends from it.
  let lastExchange = null;
  const peek = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return `string(${value.length}) ${value.slice(0, 10)}`;
    if (Array.isArray(value)) return `array(${value.length})`;
    // Flags and counts are shown with their value: whether a reply says
    // "more pages exist" is exactly what a capture is read for.
    if (typeof value === 'boolean' || typeof value === 'number') return `${typeof value}:${value}`;
    return typeof value;
  };

  function record(text, requestBody, url = null) {
    try {
      // Keep the exchange that announces the most photos. Maps also makes a
      // small gallery call for the overview strip (asked for 4, total 2), and
      // that one arrives after the grid and would otherwise replace it.
      let announced = 0;
      eachGalleryCall(text, (rpc, payload) => {
        if (!single(payload) && Number.isSafeInteger(payload[1])) announced = Math.max(announced, payload[1]);
        return false;
      });
      if (!lastExchange || announced >= lastExchange.announced) {
        lastExchange = { body: requestBody || null, text, url, announced };
      }
      const calls = [];
      eachGalleryCall(text, (rpc, payload) => {
        calls.push({
          rpc,
          length: payload.length,
          listLength: Array.isArray(payload[0]) ? payload[0].length : null,
          total: payload[1],
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
  // which leaves the private-window roll as the only remedy.
  const FILL_KEY = 'gmnx.fillGrid';
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

  // Requests being filled, so a page fetched here is never filled again.
  const fillBusy = new Set();

  // The pages after the first, fetched with the same request Maps made and
  // the token each reply hands back. Returns the parsed payloads, in order.
  async function laterPages(url, body, first, wantExtra = Infinity) {
    const outer = JSON.parse(new URLSearchParams(body).get('f.req'));
    const call = outer?.[0]?.find((c) => Array.isArray(c) && typeof c[1] === 'string');
    const args = JSON.parse(call[1]);
    const layout = layoutFor(call[0]);
    const slot = layout.token.slice(0, -1).reduce((n, i) => n?.[i], args);
    if (!Array.isArray(slot)) return [];
    const last = layout.token[layout.token.length - 1];

    const pages = [];
    let payload = first;
    let got = 0;
    for (let n = 0; n < MAX_FILL_PAGES; n++) {
      const token = tokenOf(call[0], payload)?.value;
      if (typeof token !== 'string') break;

      slot[last] = token;
      call[1] = JSON.stringify(args);
      const params = new URLSearchParams(body);
      params.set('f.req', JSON.stringify(outer));

      const response = await nativeFetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: params.toString()
      });
      let next = null;
      eachGalleryCall(await response.text(), (rpc, found) => {
        if (rpc !== call[0] || single(found)) return false;
        next = found;
        return true;
      });
      const more = next ? describe(next) : null;
      if (!more || !more.size) break;

      pages.push(next);
      payload = next;
      got += more.size;
      if (got >= wantExtra) break;
    }
    return pages;
  }

  // The reply Maps should read: the first page with the later pages' photos
  // appended. Null whenever there is nothing to improve or anything fails, in
  // which case the original reply goes through untouched.
  async function filledReply(url, body, text) {
    try {
      let first = null;
      let rpc = null;
      eachGalleryCall(text, (name, payload) => {
        if (single(payload) || !describe(payload)) return false;
        first = payload;
        rpc = name;
        return true;
      });
      // Each refusal says why. fillGrid(true) was asked for, so staying
      // silent would look the same as not having run at all.
      const decline = (why) => { console.log(LOG, `fill: left the reply as it is, ${why}`); return null; };

      if (!first) return decline('no gallery list in it');

      // A request that already carries a token is Maps asking for a later
      // page by itself, which it only does once the first reply let it. Those
      // replies are left alone: filling them as well asked the server for a
      // second page each time and doubled the traffic.
      const asking = envelopes(body).find((entry) => entry.rpc === rpc);
      const sentToken = asking ? at(asking.args, layoutFor(rpc).token) : null;
      if (typeof sentToken === 'string' && sentToken) {
        // The server sets the limited flag on every page it serves, so a page
        // left as it came would stop Maps after one more. The same slots the
        // first fill emptied are emptied here, and nothing is fetched. Only
        // those: the last page has an end marker that must stay.
        const stuck = clearedFlags.filter((index) => first[index] === true);
        if (!stuck.length) return decline('this is a follow-up page Maps asked for itself');

        // A capped session serves 10 where Maps asked for 20. The first fill
        // handed over exactly 20; a follow-up left short makes Maps redraw
        // the grid, which showed as the scroll jumping to the top. So the
        // next server page is merged in until the page is the size asked for.
        const own = describe(first);
        const wanted = askedFor(body, { rpc, served: own.size, layoutFor });
        let merged = { payload: first.slice(), added: 0 };
        if (typeof wanted === 'number' && own.size < wanted && tokenOf(rpc, first)) {
          const more = await laterPages(url, body, first, wanted - own.size);
          const joined = more.length ? mergePages([first, ...more]) : null;
          if (joined && joined.added) {
            merged = joined;
            merged.payload[tokenOf(rpc, first).index] = tokenOf(rpc, more[more.length - 1])?.value ?? null;
          }
        }
        for (const index of stuck) merged.payload[index] = null;
        trace('follow-up', { own: own.size, joined: merged.added, handedOver: own.size + merged.added });
        console.log(LOG, `fill: follow-up page, cleared the limited flag at [${stuck.join(', ')}]`
          + (merged.added ? `, and joined the next page: ${own.size} photos became ${own.size + merged.added}` : ''));
        return frameReply(rpc, merged.payload, text);
      }
      const firstToken = tokenOf(rpc, first);
      if (!firstToken) return decline('it carries no continuation token');

      const found = describe(first);
      const asked = askedFor(body, { rpc, served: found.size, layoutFor });

      // Capped means the server sent fewer photos than were asked for while
      // announcing more. Without the page size nothing is claimed.
      if (typeof asked !== 'number') return decline('the page size asked for could not be read');
      if (!(typeof found.total === 'number' && found.total > found.size && found.size < asked)) {
        // A reply that is not capped shows which true slots are ordinary.
        rememberNormalFlags(first);
        return decline(`not capped (${found.size} served of ${found.total}, asked for ${asked})`);
      }

      const started = performance.now();
      const more = await laterPages(url, body, first, asked - found.size);
      const took = Math.round(performance.now() - started);
      trace('fill', { pages: more.length, ms: took });
      if (!more.length) return decline('the server gave no further page');

      const merged = mergePages([first, ...more]);
      if (!merged || !merged.added) return decline('the further pages added no new photo');

      // An uncapped session answers with exactly the page size asked for and
      // the token for the page after it, and Maps pages on from there. The
      // same is done here: the list stops where the pages used stop, and the
      // token is the last page's, not the first's. 'all' keeps the old
      // behaviour, the whole list at once, for comparison.
      merged.payload[firstToken.index] = tokenOf(rpc, more[more.length - 1])?.value ?? null;

      // The capped reply carries true in slot 15, which the uncapped first
      // page does not have at all. While it is set Maps does not ask for the
      // next page: with it emptied, scrolling went on to load the rest of
      // the list. It is emptied whenever a capped reply is filled.
      const cleared = capFlags(first, [...normalFlags]);
      for (const index of cleared) merged.payload[index] = null;
      for (const index of cleared) if (!clearedFlags.includes(index)) clearedFlags.push(index);
      if (cleared.length) console.log(LOG, `fill: cleared the limited flag at [${cleared.join(', ')}]`);

      // Said whether or not the photos switch is on: this runs only when
      // fillGrid(true) asked for it, so the log is the answer to that ask.
      console.log(LOG, `the grid was filled from ${more.length} more pages: ${found.size} photos became`
        + ` ${found.size + merged.added}, and Maps waited ${took} ms for it`);

      return frameReply(rpc, merged.payload, text);
    } catch (error) {
      console.warn(LOG, 'could not fill the grid, leaving the reply as it is', error?.message || error);
      return null;
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

    const bootstrap = isPlaceBootstrap(url);
    const response = nativeFetch.apply(this, arguments);
    if (!wantsBody && !bootstrap) return response;

    bodyPromise.then((body) => {
      noteAsked(isBatch(url, body), body);
    }).catch(() => {});

    return response.then(async (res) => {
      try {
        const body = await bodyPromise;
        const batch = isBatch(url, body);
        const text = await res.clone().text();

        // What the background is told about this reply. It is the server's
        // own unless the fill replaced it: a filled list that reaches the page
        // size is reported as served in full, so no private window is opened,
        // and a reply the fill could not improve is reported as it came, so
        // the private-window roll still starts as the fallback.
        let reported = false;
        const report = (reply) => { if (!reported) { reported = true; readReply(batch, reply, body, url); } };

        // The capped first page is replaced by a fuller one when asked for.
        // Anything that goes wrong leaves the original response in place.
        if (batch && fillOn() && !fillBusy.has(url)) {
          console.log(LOG, 'fill: a gallery reply arrived, checking whether it is capped');
          fillBusy.add(url);
          try {
            const filled = await filledReply(url, body, text);
            if (filled) {
              console.log(LOG, `fill: handing Maps a longer list (${filled.length} chars)`);
              report(filled);
              const filledRpc = state.rpc;
              let filledCount = 0;
              let filledTotal = null;
              eachGalleryCall(filled, (name, payload) => {
                const d = single(payload) ? null : describe(payload);
                if (!d) return false;
                filledCount = d.size;
                filledTotal = d.total;
                return true;
              });
              stall.arm(filledRpc, () => tell({ type: 'gm-fill-stalled',
                firstPage: state.firstPage, serverTotal: state.serverTotal, asked: state.asked,
                galleryUrl: rememberedGalleryUrl() || location.href }), filledCount, filledTotal);
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
    const bootstrap = url && !batch && isPlaceBootstrap(url);

    noteAsked(batch, body);

    if (batch || bootstrap) {
      const xhr = this;
      xhr.addEventListener('loadend', () => {
        try {
          if (xhr.status !== 200 || (xhr.responseType && xhr.responseType !== 'text')) return;
          readReply(batch, xhr.responseText, body, url);
        } catch (_) {}
      });
    }
    return nativeSend.apply(this, arguments);
  };

  // --- console API ------------------------------------------------------------

  // A console command. The string comes back to the console; the message
  // goes to the background, which does the work.
  const ask = (type, message, extra = {}) => {
    try {
      window.postMessage({ source: 'gm-native-maps', type, ...extra }, location.origin);
      return message;
    } catch (error) {
      return `could not reach the extension: ${error}`;
    }
  };

  // ui.js reads this and must not hide anything while a single photo is
  // open. The two scripts run in the same world but load separately.
  window.__GM_GALLERY__ = state;

  window.GMGallery = {
    // The extension does this itself when a page comes back capped. This is
    // for another go.
    borrowPrivate: () => ask('gm-borrow-private', 'rolling a fresh session — the page will reload',
      { galleryUrl: rememberedGalleryUrl() || location.href }),

    forget: () => ask('gm-forget', 'asked — see the message'),

    // fillGrid() reports, fillGrid(true) forces the fill on for this tab even
    // with the photos switch off, fillGrid(false) turns it off.
    fillGrid: (on) => {
      if (on === undefined) return fillOn() ? 'on for this session' : 'off';
      try { sessionStorage.setItem(FILL_KEY, on === true ? '1' : '0'); } catch (_) { return 'could not be saved'; }
      return on === true ? 'on for this session: reload the place, then open the Photos grid' : 'off';
    },

    // The shape of each gallery request and reply seen on this page, with no
    // photo URLs in it. For reading what a session was actually given.
    capture: () => JSON.parse(JSON.stringify(recorded)),

    // What happened since the page began: errors, rejections, clicks and
    // batchexecute calls, each with a time in milliseconds. Messages are cut
    // short and no URL, token or photo is kept.
    trace: () => JSON.parse(JSON.stringify(traced)),

    // Follows the continuation tokens page after page, the way scrolling the
    // grid does, and reports how many photos each page added that earlier
    // pages did not have. For finding out whether a session that is cut to
    // ten per page can still be walked to the end. Photo ids are compared and
    // counted here; none of them, and no token or URL, is returned.
    probeAllPages: async ({ maxPages = 15 } = {}) => {
      if (!lastExchange?.body) return 'no gallery request seen yet: open the Photos grid first';

      let params;
      let outer;
      try {
        params = new URLSearchParams(lastExchange.body);
        outer = JSON.parse(params.get('f.req'));
      } catch (_) { return 'the last request could not be read'; }

      const call = outer?.[0]?.find((c) => Array.isArray(c) && typeof c[1] === 'string');
      if (!call) return 'the last request had no gallery call';

      let args;
      try { args = JSON.parse(call[1]); } catch (_) { return 'the last request arguments could not be read'; }

      const layout = layoutFor(call[0]);
      const slot = layout.token.slice(0, -1).reduce((n, i) => n?.[i], args);
      if (!Array.isArray(slot)) return 'the token slot is not where the layout says';
      const last = layout.token[layout.token.length - 1];

      const url = lastExchange.url
        || `${location.origin}/maps/_/MapsWizUi/data/batchexecute?rpcids=${call[0]}&hl=en&rt=c`;

      const idOf = (entry) => (Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : null);
      const galleryOf = (text) => {
        let found = null;
        eachGalleryCall(text, (rpc, payload) => {
          if (rpc !== call[0] || single(payload)) return false;
          found = payload;
          return true;
        });
        return found;
      };
      // The photo list is the slot with the most entries that carry a URL:
      // the same rule describe() uses. Only the ids of those entries are kept.
      const hasUrl = (entry) => Array.isArray(entry) && JSON.stringify(entry).includes('googleusercontent');
      const idsOf = (payload) => {
        if (!payload) return [];
        let best = [];
        for (const value of payload) {
          if (!Array.isArray(value) || !value.length) continue;
          const withUrl = value.filter(hasUrl);
          if (withUrl.length > best.length) best = withUrl;
        }
        return best.map(idOf).filter(Boolean);
      };

      // Page one is what Maps already fetched.
      let payload = galleryOf(lastExchange.text);
      const seen = new Set(idsOf(payload));
      const pages = [{ page: 1, got: seen.size, added: seen.size, status: 200, total: payload?.[1] ?? null }];

      for (let page = 2; page <= maxPages; page++) {
        const token = tokenOf(call[0], payload)?.value;
        if (typeof token !== 'string') { pages.push({ page, stoppedBecause: 'no token to follow' }); break; }

        slot[last] = token;
        call[1] = JSON.stringify(args);
        params.set('f.req', JSON.stringify(outer));

        let response;
        let text;
        try {
          response = await nativeFetch(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: params.toString()
          });
          text = await response.text();
        } catch (error) {
          pages.push({ page, stoppedBecause: `request failed: ${error?.message || error}` });
          break;
        }

        payload = galleryOf(text);
        if (!payload) { pages.push({ page, status: response.status, stoppedBecause: 'no gallery frame in the reply' }); break; }

        const ids = idsOf(payload);
        const fresh = ids.filter((id) => !seen.has(id));
        ids.forEach((id) => seen.add(id));
        pages.push({ page, got: ids.length, added: fresh.length, status: response.status, total: payload[1] ?? null });

        if (!fresh.length) { pages[pages.length - 1].stoppedBecause = 'a page added nothing new'; break; }
      }

      return {
        pages,
        distinctPhotos: seen.size,
        announcedTotal: payload?.[1] ?? pages[0].total
      };
    },

    // Asks the server for the page after the one last seen, using the token
    // that page handed back, the way Maps does when the grid is scrolled. For
    // finding out whether a capped session will serve a second page at all.
    // Resends one request of Maps' own, adds nothing else, and reports only
    // the shape of what comes back.
    probeNextPage: async () => {
      if (!lastExchange?.body) return 'no gallery request seen yet: open the Photos grid first';

      const params = new URLSearchParams(lastExchange.body);
      let outer;
      try { outer = JSON.parse(params.get('f.req')); } catch (_) { return 'the last request could not be read'; }

      const call = outer?.[0]?.find((c) => Array.isArray(c) && typeof c[1] === 'string');
      if (!call) return 'the last request had no gallery call';

      let args;
      let reply = null;
      try { args = JSON.parse(call[1]); } catch (_) { return 'the last request arguments could not be read'; }
      eachGalleryCall(lastExchange.text, (rpc, payload) => {
        if (rpc === call[0] && !single(payload)) { reply = payload; return true; }
        return false;
      });

      const layout = layoutFor(call[0]);
      const token = tokenOf(call[0], reply || [])?.value;
      if (typeof token !== 'string') return 'the last reply carried no continuation token';

      // Same request, token put where Maps puts it for the next page.
      let node = args;
      for (const index of layout.token.slice(0, -1)) node = node?.[index];
      if (!Array.isArray(node)) return 'the token slot is not where the layout says';
      node[layout.token[layout.token.length - 1]] = token;

      call[1] = JSON.stringify(args);
      params.set('f.req', JSON.stringify(outer));

      const url = lastExchange.url || `${location.origin}/maps/_/MapsWizUi/data/batchexecute?rpcids=${call[0]}&hl=en&rt=c`;
      const response = await nativeFetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: params.toString()
      });
      const text = await response.text();

      let next = null;
      eachGalleryCall(text, (rpc, payload) => {
        if (rpc !== call[0]) return false;
        next = payload;
        return true;
      });

      return {
        status: response.status,
        bytes: text.length,
        gotGalleryFrame: !!next,
        list: Array.isArray(next?.[0]) ? next[0].length : null,
        total: next?.[1] ?? null,
        nextToken: peek(next ? tokenOf(call[0], next)?.value : null),
        head: next ? null : text.slice(0, 120)
      };
    }
  };

  // The state grows as Maps writes it. One early read reports a fraction.
  // Several passes: Maps writes the embedded state while the document is
  // still parsing, and one early read catches a fraction of the photos.
  const readWhenReady = () => {
    for (const delay of [0, 400, 1200, 2500, 5000]) {
      setTimeout(() => { try { readEmbeddedPlace(); } catch (_) {} }, delay);
    }
  };

  // Long enough for the page to have finished filling in. If no gallery
  // request has happened by now, none is coming, and the count is the whole
  // story.
  setTimeout(() => {
    if (!reportedFirst) tellCount(state.bootstrapPhotos ?? 0, true);
  }, 4000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', readWhenReady, { once: true });
  } else {
    readWhenReady();
  }

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
    if (grew && soon) {
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

  console.debug(LOG, 'watching the gallery RPC');
})();
