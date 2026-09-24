(() => {
  'use strict';

  // Reports what this page load was given. It changes nothing: no cookies,
  // no reload, no hiding. The background script decides what to do with it.
  //
  //   photos already in the page or the place payload   gm-page-photos
  //   a gallery request leaving                          gm-gallery-asking
  //   the first gallery reply                            gm-roll-outcome
  //   a later page of that same gallery                  gm-gallery-paged
  //   a reply that is one open photo, not the grid       gm-gallery-idle
  //
  // The first reply is reported once. Later replies of the same gallery are
  // follow-up pages, and only the first of those is reported — the end of a
  // long scroll is not another cap.

  const { describe, askedFor, single, photoUrls, envelopes, learnLayout, DEFAULT_LAYOUT } = window.__GMX;

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
    if (!batch || askedAnnounced || askedFor(body, { layoutFor }) === null) return;
    askedAnnounced = true;

    tell({ type: 'gm-gallery-asking' });
  };

  function readReply(batch, text, requestBody) {
    if (batch) onFirstGallery(text, requestBody);
    else onPlacePayload(text);
  }

  // fetch is hooked in case Maps stops using XHR. The request itself is
  // left alone; only a copy of the reply is read.
  window.fetch = function galleryFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const body = typeof init?.body === 'string' ? init.body : null;
    const batch = isBatch(url, body);
    const bootstrap = !batch && isPlaceBootstrap(url);

    noteAsked(batch, body);
    const response = nativeFetch.apply(this, arguments);
    if (!batch && !bootstrap) return response;

    return response.then(async (res) => {
      try { readReply(batch, await res.clone().text(), body); } catch (_) {}
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
          readReply(batch, xhr.responseText, body);
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

    forget: () => ask('gm-forget', 'asked — see the message')
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

  console.debug(LOG, 'watching the gallery RPC');
})();
