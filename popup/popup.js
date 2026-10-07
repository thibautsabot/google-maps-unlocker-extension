// One switch per entry in common/features.js. Nothing here names a feature.
//
//   build the checkbox
//   on change, save it and describe what that means for the open tab
//   offer a reload after any change, when the open tab is Maps

const panel = document.getElementById('features');
const note = document.getElementById('note');
const reload = document.getElementById('reload');

// The switches as stored, with every missing one treated as off.
const read = async () => {
  const stored = await browser.storage.local.get([FEATURES_KEY, COOKIE_CONSENT_KEY]);
  const features = { ...FEATURES_OFF, ...stored[FEATURES_KEY] };
  features.photos = features.photos && stored[COOKIE_CONSENT_KEY] === true;
  return features;
};

const boxes = new Map();
const consent = document.getElementById('cookie-consent');
const consentAccept = document.getElementById('consent-accept');
const consentCancel = document.getElementById('consent-cancel');
const privateAccess = document.getElementById('private-access');
const openPrivateSettings = document.getElementById('open-private-settings');
let pendingConsent = false;
let pendingPhotos = false;

for (const feature of FEATURES) {
  const label = document.createElement('label');

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = feature.id;

  const name = document.createElement('span');
  name.textContent = feature.label;

  const detail = document.createElement('small');
  detail.textContent = feature.note;

  label.append(box, name, detail);
  panel.append(label);
  boxes.set(feature.id, box);

  box.addEventListener('change', async () => {
    if (feature.id === 'photos' && box.checked) {
      box.checked = false;
      pendingConsent = true;
      pendingPhotos = true;
      consent.showModal();
      consentAccept.focus();
      return;
    }

    if (feature.id === 'photos' && !box.checked) {
      await browser.storage.local.set({ [COOKIE_CONSENT_KEY]: false });
    }

    await browser.storage.local.set({ [FEATURES_KEY]: { ...await read(), [feature.id]: box.checked } });
    await show(feature);
  });
}

consentAccept.addEventListener('click', async () => {
  if (!pendingConsent || !pendingPhotos) return;
  await browser.storage.local.set({ [COOKIE_CONSENT_KEY]: true });
  await browser.storage.local.set({ [FEATURES_KEY]: { ...await read(), photos: true } });
  boxes.get('photos').checked = true;
  pendingConsent = false;
  pendingPhotos = false;
  consent.close();
  await show(FEATURES.find((feature) => feature.id === 'photos'));
});

consentCancel.addEventListener('click', () => {
  pendingConsent = false;
  pendingPhotos = false;
  consent.close();
});

// The tab the panel was opened from. The panel is tied to a window, so
// "current" is that window's active tab.
async function currentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const PENDING_KEY = 'reloadPending';

const pendingTabs = async () => (await browser.storage.local.get(PENDING_KEY))[PENDING_KEY] || {};

async function markPending(tab) {
  if (!tab?.id) return;
  const all = await pendingTabs();
  all[tab.id] = tab.url;
  await browser.storage.local.set({ [PENDING_KEY]: all });
}

async function clearPending(tabId) {
  const all = await pendingTabs();
  if (!(tabId in all)) return;
  delete all[tabId];
  await browser.storage.local.set({ [PENDING_KEY]: all });
}

// Shows the reload button after any switch is changed, when the open tab is
// a Maps page, and keeps showing it until that tab has been reloaded.
// Anywhere else the button would reload a page the extension does not run on.
async function offerReload(changed) {
  const tab = await currentTab();
  const onMaps = /^https:\/\/(www|maps)\.google\.com\/maps/.test(tab?.url || '');

  if (changed && onMaps) await markPending(tab);

  const waiting = onMaps && tab?.id in await pendingTabs();
  if (!waiting) {
    reload.hidden = true;
    return;
  }

  reload.hidden = false;
  reload.onclick = async () => {
    await clearPending(tab.id);
    await browser.tabs.reload(tab.id);
    window.close();
  };
}

// The status line under the switches. changed is the feature just toggled,
// or nothing when the panel is merely opening.
async function describe(features, changed) {
  const on = FEATURES.filter((f) => features[f.id]);

  if (!on.length) {
    note.textContent = 'All off — the extension does nothing at all.';
    return;
  }

  const waiting = (await pendingTabs());
  const current = await currentTab();
  note.textContent = changed || (current?.id in waiting)
    ? 'Reload the Maps tab to apply.'
    : 'Ready.';
}

async function privateAccessAllowed() {
  try {
    return await browser.extension.isAllowedIncognitoAccess();
  } catch (_) {
    return false;
  }
}

function settingsUrl() {
  const ua = navigator.userAgent;
  const id = browser.runtime.id;
  if (ua.includes('Firefox')) return 'about:addons';
  if (ua.includes('Edg/')) return `edge://extensions/?id=${id}`;
  if (ua.includes('OPR/')) return 'opera://extensions';
  if (ua.includes('Chrome/')) return `chrome://extensions/?id=${id}`;
  return null;
}

const SETTINGS_HINT = 'Open your browser’s extension settings and enable this extension in private/incognito windows.';

const showHint = (text) => { privateAccess.querySelector('p').textContent = text; };

openPrivateSettings.addEventListener('click', async () => {
  const url = settingsUrl();
  if (!url) {
    showHint(SETTINGS_HINT);
    return;
  }

  // Firefox refuses to let an extension open about: pages, so this opens the
  // extension's own options page instead, which Firefox shows inside
  // about:addons. The page says which switch to flip.
  if (url.startsWith('about:')) {
    try {
      await browser.runtime.openOptionsPage();
      window.close();
    } catch (_) {
      showHint(`Open a new tab, go to ${url}, choose this extension, Manage, and set "Run in Private Windows" to Allow.`);
    }
    return;
  }

  try {
    await browser.tabs.create({ url });
  } catch (_) {
    showHint(`${SETTINGS_HINT} Address: ${url}`);
  }
});

// Syncs switches, private access status and reload affordance.
async function show(changed) {
  const features = await read();

  for (const [id, box] of boxes) box.checked = !!features[id];
  boxes.get('photos').disabled = false;

  const consentState = await browser.storage.local.get(COOKIE_CONSENT_KEY);
  const consented = consentState[COOKIE_CONSENT_KEY] === true;
  const allowed = await privateAccessAllowed();
  privateAccess.hidden = !(features.photos && consented && !allowed);

  await describe(features, changed);
  await offerReload(changed);
}

document.getElementById('version').textContent = `v${browser.runtime.getManifest().version}`;

show();
