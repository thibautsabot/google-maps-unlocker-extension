// After a cookie swap the tab reloads. This file decides whether that swap
// lifted the photo cap, and says so once.
//
// An uncapped page is given its photos up front and never asks for the
// gallery, so success looks like silence. A session too thin to open the
// gallery is silent too, and so is a slow reply that has not arrived yet.
// The photo count is what separates them.
//
//   the page is up and has asked for nothing     wait 1.5s, then count photos
//   a gallery request is on its way              drop the silence guess and
//                                                wait up to 25s for the reply
//                                                (roll.js reads that reply)
//   that request was only the open photo         back to the 1.5s wait
//   10 or more photos and still no request       the swap worked
//   the address is a single photo                do not judge; two URLs is
//                                                what that view always has
//   still only a handful after one extra wait    the session is too thin;
//                                                try the next one
//
// A page that was not part of a swap is judged the same way when its final
// photo count arrives: few photos and no request means try the next session.

// The swap this tab is waiting to judge. Set by roll.js before the reload,
// read here when the new page reports in. Held back on purpose: saying
// anything at swap time would claim a result that is not in yet.
const pending = new Map();

// Sessions already seen capped. Private windows share one cookie jar, and
// Firefox only mints a new session once the last private window closes, so
// borrowing while one is open hands back the identity that just failed.
const burned = new Set();

const pageCount = new Map();
const lastUrl = new Map();
const lastPlaceUrl = new Map();

// Tabs given one extra wait because the first count was too low to trust.
const gaveExtraTime = new Set();
const decisionTimers = new Map();

const SILENCE_MS = 1500;    // how long "nothing asked" has to last before it counts
const REPLY_MS = 25000;      // how long a request may take before the swap is a failure
const EXTRA_MS = 3000;       // one more wait when the first photo count is too low to trust
const ENOUGH_PHOTOS = 10;    // below this, silence is a thin session, not a lifted cap

// Maps puts the camera in the address when a photo is open — ",3a," beside
// the coordinates. That page carries about two photo URLs however good the
// session is, so the count there measures the viewer, not the cap.
const isPhotoView = (url) => /@[^/]*,\d+(?:\.\d+)?a,/.test(String(url || ''));

// The last address this tab was on. A photo view is remembered, but not as
// the place to come back to: reloading a photo lands in the viewer.
function rememberUrl(tabId, url) {
  if (!url) return;

  lastUrl.set(tabId, url);
  if (!isPhotoView(url)) lastPlaceUrl.set(tabId, url);
}

// Cancels a decision that has not fired yet. A newer report replaces it.
function clearDecision(tabId) {
  clearTimeout(decisionTimers.get(tabId));
  decisionTimers.delete(tabId);
}

// The swap is over. worked is whether the cap lifted. roll.js decides what
// to try next; this only records the result and drops a session now known
// to be capped.
function settle(tabId, worked, why) {
  clearDecision(tabId);
  gaveExtraTime.delete(tabId);

  const attempt = pending.get(tabId);
  pending.delete(tabId);
  if (!attempt) return;

  say(tabId, `verdict: ${worked ? 'lifted' : 'still capped'} — ${why}`);

  if (worked) {
    toast(tabId, attempt.text);
    tried.delete(tabId);
    rolls.delete(tabId);
    return;
  }

  // Saved the moment it is borrowed, because the reload leaves nowhere else
  // to keep it. A session now seen capped is not one to hold, and keeping
  // it would write the same cookies back for ever.
  forgetGoodRoll();
  if (attempt.cookies) burned.add(fingerprint(attempt.cookies));
  tried.delete(tabId);

  say(tabId, attempt.kind === 'saved'
    ? 'the session saved earlier did not lift the cap, so it is no longer kept'
    : 'the borrowed session did not lift the cap either, so it is no longer kept');
}

// Nothing here shows whether the session worked, so it is not blamed.
function stopWithoutBlaming(tabId, why) {
  clearDecision(tabId);
  gaveExtraTime.delete(tabId);
  pending.delete(tabId);

  say(tabId, `cannot tell yet — ${why}`);
}

// The page stayed quiet. Enough photos means the cap lifted. A handful
// means the session never opened the gallery, unless this is a photo view,
// which is quiet either way.
function decideByPhotoCount(tabId, why) {
  const photos = pageCount.get(tabId) || 0;

  if (photos >= ENOUGH_PHOTOS) {
    settle(tabId, true, `${why}, and the page carried ${photos} photos`);
    return;
  }

  if (isPhotoView(lastUrl.get(tabId))) {
    stopWithoutBlaming(tabId, 'this load opened a single photo, so there is nothing to judge the session by.'
      + ' Press Escape to reach the grid, or reload the place');
    return;
  }

  if (!gaveExtraTime.has(tabId)) {
    gaveExtraTime.add(tabId);
    scheduleDecision(tabId, EXTRA_MS, true, `only ${photos} photos so far, giving the page longer`);
    return;
  }

  failAndTryNext(tabId, `the page carried only ${photos} photo URLs,`
    + ' which is a session too thin to open the gallery at all');
}

// The swap failed. Record that, then ask roll.js for the next session.
async function failAndTryNext(tabId, why) {
  settle(tabId, false, why);
  await lift({}, tabId);
}

// worked is the guess this wait will confirm if nothing else arrives first.
// A gallery request cancels a "lifted" guess; the reply then decides.
const scheduleDecision = (tabId, ms, worked, why) => {
  clearDecision(tabId);
  say(tabId, `waiting ${ms / 1000}s before calling it ${worked ? 'lifted' : 'still capped'} (${why})`);

  decisionTimers.set(tabId, setTimeout(() => {
    if (worked) decideByPhotoCount(tabId, why);
    else failAndTryNext(tabId, `${why}, and nothing followed`);
  }, ms));
};

// --- what the reloaded page reports -----------------------------------------

// The reloaded page has announced itself. The previous load's photo count
// is no longer this page's. If a swap is waiting, start the silence clock.
function onHello(msg, tabId) {
  if (tabId == null) return;
  rememberUrl(tabId, msg.url);

  pageCount.delete(tabId);
  gaveExtraTime.delete(tabId);
  if (!pending.has(tabId)) return;

  scheduleDecision(tabId, SILENCE_MS, true, 'the page is up and has asked for nothing');
}

// Silence meant nothing: a request is on its way, and the reply decides.
function onAsking(tabId) {
  if (tabId == null || !pending.has(tabId)) return;
  scheduleDecision(tabId, REPLY_MS, false, 'a photo request is in flight');
}

// That request was the single photo on screen. It says nothing about the
// cap, so go back to judging by silence.
function onIdle(tabId) {
  if (tabId == null || !pending.has(tabId)) return;
  scheduleDecision(tabId, SILENCE_MS, true, 'that request was for a single photo');
}

// A page nobody swapped. If it asked for no gallery and has next to no
// photos, it is the thin-session case — it just had no reply to announce
// itself with.
async function onPagePhotos(msg, tabId) {
  if (tabId == null || typeof msg.photos !== 'number') return;
  pageCount.set(tabId, Math.max(pageCount.get(tabId) || 0, msg.photos));
  rememberUrl(tabId, msg.url);

  if (!msg.final || pending.has(tabId) || msg.photos >= ENOUGH_PHOTOS) return;

  if (isPhotoView(lastUrl.get(tabId))) {
    say(tabId, `this load is a single photo, so its ${msg.photos} photo URLs say nothing`
      + ' about the session — open the place to have it judged');
    return;
  }

  await say(tabId, `the page carried only ${msg.photos} photo URLs and asked for nothing —`
    + ' this session is too thin to show the gallery');

  await lift(msg, tabId);
}

handles(null, 'gm-hello', (msg, tabId) => onHello(msg, tabId));
handles('photos', 'gm-gallery-asking', (msg, tabId) => onAsking(tabId));
handles('photos', 'gm-gallery-idle', (msg, tabId) => onIdle(tabId));
handles('photos', 'gm-page-photos', onPagePhotos);

onTabGone((tabId) => {
  clearDecision(tabId);
  pending.delete(tabId);
  pageCount.delete(tabId);
  gaveExtraTime.delete(tabId);
  lastUrl.delete(tabId);
  lastPlaceUrl.delete(tabId);
});
