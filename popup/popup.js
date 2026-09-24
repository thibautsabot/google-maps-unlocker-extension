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
const read = async () =>
  ({ ...FEATURES_OFF, ...(await browser.storage.local.get(FEATURES_KEY))[FEATURES_KEY] });

const boxes = new Map();

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
    await browser.storage.local.set({ [FEATURES_KEY]: { ...await read(), [feature.id]: box.checked } });
    await show(feature);
  });
}

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

// Syncs the checkboxes with storage, then the status line and the reload
// button. Called once as the panel opens, and again after each change.
async function show(changed) {
  const features = await read();

  for (const [id, box] of boxes) box.checked = !!features[id];

  describe(features, changed);
  await offerReload(changed);
}

show();
