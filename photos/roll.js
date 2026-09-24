const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What to do when a gallery comes back capped: try another session until
// one is not, then stop.
//
// Is this gallery capped? Read off the first reply, which watch.js reports.
//   fewer photos than Maps asked for, and the server says more exist   capped
//   at least as many as asked, or the server has no more               not capped
//   the page size could not be read from the request                   wait for
//                                                                       a second
//                                                                       page
//
// If it is capped, which session next? Cheapest first, each once per tab.
//   1. the cookies saved from a session that worked before
//   2. a fresh private window, up to five times
//
// An uncapped session never asks for the gallery, so a gallery reply at all,
// during a swap, means that swap did not work.

const CAPPED = 'capped';
const CLEAR = 'clear';
const UNKNOWN = 'unknown';

// Capped means the server sent fewer photos than Maps asked for while saying
// more exist. Without the page size, ten of forty-five is also what ordinary
// pagination looks like, so the first page alone is not enough.
const capState = (served, total, asked) => {
  if (typeof served !== 'number' || typeof total !== 'number') return CLEAR;
  if (total <= served) return CLEAR;
  if (!asked) return UNKNOWN;

  return served < asked ? CAPPED : CLEAR;
};

// Maps only asks for the next page when the grid is scrolled, which may be
// never. The wait ends rather than leaving a tab quietly undecided.
const PAGING_MS = 20000;

// First replies still waiting on a second page. The paging report carries
// only what came back, so the reply that prompted it is kept here.
const undecided = new Map();
const pagingTimers = new Map();

// Drops a tab that was waiting to see whether a second page arrives.
function stopWaitingForPage(tabId) {
  clearTimeout(pagingTimers.get(tabId));
  pagingTimers.delete(tabId);
  undecided.delete(tabId);
}

// The first gallery reply. Classifies it, or holds it until a second page
// can settle what the page size being unreadable left open.
async function onOutcome(msg, tabId) {
  const { firstPage, serverTotal, asked } = msg;
  if (typeof firstPage !== 'number') return;

  stopWaitingForPage(tabId);
  const verdict = capState(firstPage, serverTotal, asked);

  if (verdict === UNKNOWN) {
    undecided.set(tabId, msg);
    pagingTimers.set(tabId, setTimeout(() => onPagingTimeout(tabId), PAGING_MS));

    await say(tabId, `served ${firstPage} of ${serverTotal}, and what was asked for could not be`
      + ' read — scroll the grid, and whether a second page arrives will settle it');
    return;
  }

  await say(tabId, verdict === CAPPED
    ? `capped at ${firstPage} of ${serverTotal}`
    : `not capped: ${firstPage} of ${serverTotal}`);

  await act(verdict === CAPPED, msg, tabId, 'the gallery replied');
}

// A second page answers what the first reply could not. One that arrives
// means the session can page. An empty one has never been seen, but would
// mean the server stopped short of the total it announced.
async function onPaged(msg, tabId) {
  const first = undecided.get(tabId);
  if (!first) return;
  stopWaitingForPage(tabId);

  const capped = !msg.photos;
  await say(tabId, capped
    ? `capped at ${first.firstPage} of ${first.serverTotal}: a second page came back empty`
    : `not capped: ${first.firstPage} of ${first.serverTotal},`
      + ` and a second page of ${msg.photos} followed`);

  await act(capped, first, tabId, 'the server was asked for a second page');
}

// Nobody scrolled, so the server was never asked and there is nothing to
// conclude.
function onPagingTimeout(tabId) {
  const first = undecided.get(tabId);
  if (!first) return;
  stopWaitingForPage(tabId);

  say(tabId, `cannot tell whether ${first.firstPage} of ${first.serverTotal} is a cap:`
    + ' the page size was unreadable and no second page was ever requested.'
    + ' GMGallery.borrowPrivate() will roll anyway if the grid looks short');
}

// capped is the gallery's answer. If a swap is in flight, that answer is
// also the verdict on the swap.
async function act(capped, msg, tabId, why) {
  if (pending.has(tabId)) settle(tabId, !capped, why);

  if (!capped) {
    tried.delete(tabId);
    rolls.delete(tabId);
    return;
  }

  await lift(msg, tabId);
}

// --- which session to try next ----------------------------------------------

const MAX_ROLLS = 5;
const rolls = new Map();
const tried = new Map();

// Which kinds of session this tab has already tried. A missing entry is
// "none yet", not a reason to skip the saved cookies.
const attempts = (tabId) => tried.get(tabId) || new Set();

// So lift will not put the same kind back a second time.
function markTried(tabId, kind) {
  const done = attempts(tabId);
  done.add(kind);
  tried.set(tabId, done);
}

// Puts the saved cookies back and reloads. The on-screen note waits until
// verdict.js says the reload actually lifted the cap.
async function applySaved(saved, tabId) {
  const written = await swapTo(saved.cookies);

  pending.set(tabId, { kind: 'saved', cookies: saved.cookies,
    text: 'Reused the session saved earlier to lift Google’s photo cap.' });

  await say(tabId, `put back ${written} cookies from the session saved `
    + `${new Date(saved.savedAt).toLocaleString()} — reloading`);
  await reload(tabId);
}

// The next session for a capped tab. Saved cookies once, then a private
// window, then stop. Called both when a gallery replies capped and when a
// page is too thin to have replied at all.
async function lift(msg, tabId) {
  const done = attempts(tabId);
  const saved = await savedGoodRoll();

  if (saved?.cookies?.length && !done.has('saved')) {
    // The saved cookies still being in the jar, and Google having replaced
    // them before the page loaded, look identical from the gallery. This
    // line is what separates them.
    await say(tabId, await usingSaved()
      ? 'the saved session was still in place, so it has gone stale'
      : 'Google had replaced the saved cookies since they were saved');

    markTried(tabId, 'saved');
    await applySaved(saved, tabId);
    return;
  }

  // Each borrow costs a private window and a reload. Some places may be
  // capped whoever asks, so this stops rather than reloading the tab for ever.
  const spent = rolls.get(tabId) || 0;
  if (spent >= MAX_ROLLS) {
    say(tabId, `gave up after ${spent} fresh sessions, all capped.`
      + ' GMGallery.borrowPrivate() will roll again if you want to keep going');
    return;
  }

  await say(tabId, `borrowing a fresh session from a private window (roll ${spent + 1} of ${MAX_ROLLS})`);

  // Counted only once something was actually swapped in. A borrow that came
  // back empty was never really tried.
  if (await onBorrowPrivate(msg, tabId)) rolls.set(tabId, spent + 1);
}

// --- borrowing a private session --------------------------------------------

// Empties the private jar so the next private page is issued a new identity
// rather than the one that just failed. Firefox does this itself when the
// last private window closes, but that window may be the user's, and the
// cookies can be removed directly.
async function clearPrivateGoogleCookies() {
  for (const cookie of await privateGoogleCookies()) {
    try {
      await browser.cookies.remove({ url: cookieUrl(cookie), name: cookie.name, storeId: cookie.storeId });
    } catch (_) {}
  }
}

// A session already seen capped is the same answer again, not a new try.
async function alreadyTried(cookies) {
  if (!cookies.length) return true;

  const saved = await savedGoodRoll();
  const mark = fingerprint(cookies);
  return burned.has(mark) || (saved && fingerprint(saved.cookies) === mark);
}

// Loads far enough for Google to issue cookies, then it has served its purpose.
async function openPrivateWindow(url) {
  try {
    try {
      return await browser.windows.create({ url, incognito: true, state: 'minimized', focused: false });
    } catch (_) {
      return await browser.windows.create({ url, incognito: true, state: 'minimized' });
    }
  } catch (error) {
    return error;
  }
}

// Polls until Google has issued cookies in the private window, then a
// little longer: the first cookie to appear is not always the whole set.
async function waitForPrivateCookies() {
  let found = [];
  for (let waited = 0; waited < 15000 && !found.length; waited += 500) {
    await sleep(500);
    found = await privateGoogleCookies();
  }
  await sleep(2000);
}

// The private window existed only to be issued an identity.
async function closeWindow(opened) {
  if (!opened?.id) return;
  try { await browser.windows.remove(opened.id); } catch (_) {}
}

// Copies a private session into this tab and reloads. Returns false when
// nothing new was swapped in, so the attempt is not counted against the five.
async function onBorrowPrivate(msg, tabId) {
  const url = msg.galleryUrl || lastUrl.get(tabId) || 'https://www.google.com/maps';
  let opened = null;

  const finish = async (message) => {
    await closeWindow(opened);
    await say(tabId, message);
  };

  let source = await privateGoogleCookies();

  if (await alreadyTried(source)) {
    if (source.length) {
      await say(tabId, 'that private session has already been tried — clearing it for a new one');
      await clearPrivateGoogleCookies();
    }

    opened = await openPrivateWindow(url);
    if (!opened?.id) {
      await say(tabId, `could not open a private window: ${opened}.`
        + ' Check about:addons -> this extension -> Run in Private Windows');
      return false;
    }

    await waitForPrivateCookies();
    source = await privateGoogleCookies();
  }

  if (!source.length) {
    await finish('the private window produced no Google cookies, so there was nothing to borrow');
    return false;
  }

  if (await alreadyTried(source)) {
    await finish('the private session came back the same one that was already capped.'
      + ' Close every private window so Firefox issues a new one, then reload');
    return false;
  }

  // Ours go first, so what remains is the private set rather than a mixture.
  const written = await swapTo(source);
  await keepGoodRoll(source);

  pending.set(tabId, { kind: 'borrowed', cookies: source,
    text: 'Borrowed a session from a private window to lift Google’s photo cap.' });

  await finish(`borrowed ${written} cookies from a private session and saved them — reloading`);
  await reload(tabId);
  return true;
}

// --- commands from the page console -----------------------------------------

// Drops the saved session and the memory of what this tab already tried.
// Cookies already in the jar stay until something replaces them.
async function onForget(msg, tabId) {
  const saved = await savedGoodRoll();
  await forgetGoodRoll();

  if (saved?.cookies?.length) burned.add(fingerprint(saved.cookies));
  tried.delete(tabId);
  rolls.delete(tabId);

  await say(tabId, saved
    ? `forgot the session saved ${new Date(saved.savedAt).toLocaleString()}.`
      + ' Its cookies are still in the jar — clear them, or load a capped place and it will roll a new one'
    : 'there was nothing saved to forget');
}

// By hand means starting over, not inheriting a tab that has already spent
// its five.
async function onManualBorrow(msg, tabId) {
  rolls.delete(tabId);
  tried.delete(tabId);
  return onBorrowPrivate(msg, tabId);
}

handles('photos', 'gm-roll-outcome', onOutcome);
handles('photos', 'gm-gallery-paged', onPaged);
handles('photos', 'gm-forget', onForget);
handles('photos', 'gm-borrow-private', onManualBorrow);

onTabGone((tabId) => {
  tried.delete(tabId);
  rolls.delete(tabId);
  stopWaitingForPage(tabId);
});

onReady(async (features) => {
  if (!features.photos) return;

  const saved = await savedGoodRoll();
  console.log(LOG, saved
    ? `photos — ${saved.cookies.length} cookies saved from ${new Date(saved.savedAt).toLocaleString()}`
    : 'photos — nothing saved yet');
});
