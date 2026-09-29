// One switch per entry in common/features.js. Nothing here names a feature.
//
//   build the checkbox
//   on change, save it and describe what that means for the open tab
//   offer a reload only when the open tab is Maps and will not pick the
//   change up on its own

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
  detail.textContent = feature.appliesAtOnce
    ? `${feature.note} Applies straight away.`
    : `${feature.note} Needs the page to load again.`;

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

// Shows the reload button when the change will not apply to the open tab by
// itself, and that tab is a Maps page. Anywhere else the button would reload
// a page the extension does not run on.
async function offerReload(changed) {
  const tab = await currentTab();
  const onMaps = /^https:\/\/(www|maps)\.google\.com\/maps/.test(tab?.url || '');

  if (!changed || changed.appliesAtOnce || !onMaps) {
    reload.hidden = true;
    return;
  }

  reload.hidden = false;
  reload.onclick = async () => {
    await browser.tabs.reload(tab.id);
    window.close();
  };
}

// The status line under the switches. changed is the feature just toggled,
// or nothing when the panel is merely opening.
function describe(features, changed) {
  const on = FEATURES.filter((f) => features[f.id]);

  if (!on.length) {
    note.textContent = 'All off — the extension does nothing at all.';
    return;
  }

  note.textContent = changed && !changed.appliesAtOnce
    ? 'This applies to Maps tabs from their next load.'
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

openPrivateSettings.addEventListener('click', async () => {
  const url = settingsUrl();
  if (!url) {
    privateAccess.querySelector('p').textContent = 'Open your browser’s extension settings and enable this extension in private/incognito windows.';
    return;
  }
  try {
    await browser.tabs.create({ url });
  } catch (_) {
    privateAccess.querySelector('p').textContent = 'Open your browser’s extension settings and enable this extension in private/incognito windows.';
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

  describe(features, changed);
  await offerReload(changed);
}

document.getElementById('version').textContent = `v${browser.runtime.getManifest().version}`;

show();
