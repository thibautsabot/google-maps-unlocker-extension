const GOOD_ROLL_KEY = 'goodRoll';

// The cookie jar.
//
//   read the Google cookies a private window was issued
//   replace this window's Google cookies with that set
//   keep the consent cookies across the replacement
//   remember the set, so a later cap can be lifted without another window
//   reload the tab, reopening the place when a photo is what is open
//
// The cap travels with the cookies. Copying a private session's cookies
// into the normal jar is what lifts it.

const isGoogleDomain = (domain) => /(^|\.)google\.[a-z.]{2,}$/.test(domain.replace(/^\./, ''));

const cookieUrl = (cookie) =>
  `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path}`;

// Which store is the normal jar and which is the private one.
//
// Firefox names them. Chrome numbers them, and the private store does not
// exist until an incognito window is open, so this is asked again each time
// rather than cached. The ids are worked out from which tabs each store holds.
async function stores() {
  const known = { normal: 'firefox-default', private: 'firefox-private' };

  try {
    const [all, tabs] = await Promise.all([
      browser.cookies.getAllCookieStores(),
      browser.tabs.query({})
    ]);

    const privateTabs = new Set(tabs.filter((t) => t.incognito).map((t) => t.id));
    const normalTabs = new Set(tabs.filter((t) => !t.incognito).map((t) => t.id));
    const holding = (ids) => all.find((s) => s.tabIds?.some((id) => ids.has(id)));

    // Firefox accepts its private store by name even with no private window
    // open. Chrome has no such id until an incognito window exists, and until
    // then there is nothing to borrow from.
    const firefox = all.some((store) => String(store.id).startsWith('firefox-'));

    return {
      normal: holding(normalTabs)?.id ?? known.normal,
      private: holding(privateTabs)?.id ?? (firefox ? known.private : null)
    };
  } catch (_) {
    return known;
  }
}

async function privateGoogleCookies() {
  try {
    const storeId = (await stores()).private;
    if (!storeId) return [];

    return (await browser.cookies.getAll({ storeId })).filter((c) => isGoogleDomain(c.domain));
  } catch (_) {
    return [];
  }
}

async function ourGoogleCookies() {
  const privateStore = (await stores()).private;

  return (await browser.cookies.getAll({}))
    .filter((c) => isGoogleDomain(c.domain) && c.storeId !== privateStore);
}

// Removes this window's Google cookies. The private jar is left alone, so a
// session waiting to be borrowed is not wiped by the wipe that makes room
// for it.
async function clearOurGoogleCookies() {
  try {
    const privateStore = (await stores()).private;
    const ours = (await browser.cookies.getAll({}))
      .filter((c) => isGoogleDomain(c.domain) && c.storeId !== privateStore);

    for (const cookie of ours) {
      try {
        await browser.cookies.remove({ url: cookieUrl(cookie), name: cookie.name, storeId: cookie.storeId });
      } catch (_) {}
    }
  } catch (_) {}
}

// Consent is the visitor's answer, not part of the session being borrowed.
// It is lifted out before the jar is cleared and written back after.
const CONSENT_COOKIES = new Set(['SOCS', 'CONSENT']);

// Replaces this window's Google cookies with the given set, then puts the
// consent cookies back. Returns how many of the new set were written.
async function swapTo(cookies) {
  const consent = (await ourGoogleCookies()).filter((c) => CONSENT_COOKIES.has(c.name));

  await clearOurGoogleCookies();
  const written = await writeCookies(cookies);

  if (consent.length) await writeCookies(consent);
  return written;
}

// Writes each cookie into the normal jar. A cookie that the browser refuses
// is skipped; the count is how many landed. Host-only cookies carry no
// leading dot and must not be given a domain, or they stop matching.
async function writeCookies(list) {
  const { normal } = await stores();
  let written = 0;

  for (const cookie of list) {
    try {
      await browser.cookies.set({
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        ...(cookie.domain.startsWith('.') ? { domain: cookie.domain } : {}),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        ...(cookie.session ? {} : { expirationDate: cookie.expirationDate }),
        storeId: normal
      });
      written++;
    } catch (_) {}
  }
  return written;
}

// Remembers the set that was just swapped in. Only the fields needed to
// write them back are kept; the store id belongs to the jar they came from.
const keepGoodRoll = (cookies) => browser.storage.local.set({
  [GOOD_ROLL_KEY]: {
    savedAt: Date.now(),
    cookies: cookies.map(({ name, value, domain, path, secure, httpOnly, sameSite, session, expirationDate }) =>
      ({ name, value, domain, path, secure, httpOnly, sameSite, session, expirationDate }))
  }
});

// The remembered set, or null when nothing has been saved.
const savedGoodRoll = async () => (await browser.storage.local.get(GOOD_ROLL_KEY))[GOOD_ROLL_KEY] || null;

// Forgets the remembered set. Does not touch the cookies in the jar.
const forgetGoodRoll = () => browser.storage.local.remove(GOOD_ROLL_KEY);

// Identity of a cookie set: same names, domains and values, in a stable
// order, so two reads of one session compare equal.
const fingerprint = (cookies) => (cookies || [])
  .map((c) => `${c.name}|${c.domain}|${c.value}`).sort().join('\n');

// True when every saved cookie is still in this window's jar with the same
// value. That separates "Google replaced them" from "they are still here
// and the session has gone stale".
async function usingSaved() {
  const saved = await savedGoodRoll();
  if (!saved?.cookies?.length) return false;

  try {
    const privateStore = (await stores()).private;
    const current = (await browser.cookies.getAll({}))
      .filter((c) => isGoogleDomain(c.domain) && c.storeId !== privateStore);
    const byName = new Map(current.map((c) => [`${c.name}|${c.domain}`, c.value]));

    return saved.cookies.every((c) => byName.get(`${c.name}|${c.domain}`) === c.value);
  } catch (_) {
    return false;
  }
}

// Reloads the tab. When the tab is sitting on a photo, the place that photo
// was opened from is loaded instead: a photo page cannot be judged, and
// reloading it stays in the viewer.
const reload = async (tabId) => {
  const here = lastUrl.get(tabId);
  const place = lastPlaceUrl.get(tabId);

  if (place && isPhotoView(here) && place !== here) {
    say(tabId, 'this tab is on a single photo, so the place is reopened instead of it');
    try {
      await browser.tabs.update(tabId, { url: place });
      return;
    } catch (error) {
      console.warn(LOG, 'could not reopen the place, reloading instead', error);
    }
  }

  try { await browser.tabs.reload(tabId); } catch (error) { console.warn(LOG, 'reload failed', error); }
};
