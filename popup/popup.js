// One switch per entry in common/features.js. Nothing here names a feature.
const panel = document.getElementById('features');
const note = document.getElementById('note');
const reload = document.getElementById('reload');
const PENDING_KEY = 'reloadPending';
const boxes = new Map();
let features;
let tab;
let waiting = false;

// Serialize changes in this popup, capturing each click before any await.
// Storage's map updates are still not atomic across extension contexts.
function enqueue(task) {
  queue = queue.then(task).catch(() => {
    note.textContent = 'Could not save settings. Try again.';
  });
  return queue;
}

for (const feature of FEATURES) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = feature.id;
  box.disabled = true;

  const name = document.createElement('span');
  name.textContent = feature.label;
  const detail = document.createElement('small');
  detail.textContent = feature.note;

  label.append(box, name, detail);
  panel.append(label);
  boxes.set(feature.id, box);

  box.addEventListener('change', () => {
    const checked = box.checked;
    return enqueue(async () => {
      const next = { ...features, [feature.id]: checked };
      await browser.storage.local.set({ [FEATURES_KEY]: next });
      features = next;

      if (isGoogleMapsUrl(tab?.url || '') && tab?.id != null) {
        const all = await pendingTabs();
        all[tab.id] = true;
        await browser.storage.local.set({ [PENDING_KEY]: all });
        waiting = true;
      }
      show();
    });
  });
}

const pendingTabs = async () => (await browser.storage.local.get(PENDING_KEY))[PENDING_KEY] || {};

// Pending reloads take precedence even when the last switch was turned off.
function show() {
  const on = FEATURES.some((feature) => features[feature.id]);
  note.textContent = waiting
    ? `${on ? '' : 'All features off. '}Reload the Maps tab to apply.`
    : (on ? 'Ready.' : 'All features off.');
  reload.hidden = !waiting;
}

reload.onclick = () => {
  if (reload.disabled || !waiting) return;
  reload.disabled = true;
  for (const box of boxes.values()) box.disabled = true;
  return enqueue(async () => {
    try {
      await browser.tabs.reload(tab.id);
      // Failed reloads must leave the stored prompt available for retry.
      const all = await pendingTabs();
      if (tab.id in all) {
        delete all[tab.id];
        await browser.storage.local.set({ [PENDING_KEY]: all });
      }
      waiting = false;
      show();
      window.close();
    } catch (_) {
      note.textContent = 'Could not reload the Maps tab. Try again.';
    } finally {
      reload.disabled = false;
      for (const box of boxes.values()) box.disabled = false;
    }
  });
};

async function initialize() {
  const [stored, tabs] = await Promise.all([
    browser.storage.local.get([FEATURES_KEY, PENDING_KEY]),
    browser.tabs.query({ active: true, currentWindow: true })
  ]);
  features = { ...FEATURES_OFF, ...stored[FEATURES_KEY] };
  [tab] = tabs;
  waiting = isGoogleMapsUrl(tab?.url || '') && tab?.id != null
    && tab.id in (stored[PENDING_KEY] || {});
  for (const [id, box] of boxes) {
    box.checked = !!features[id];
    box.disabled = false;
  }
  show();
}

let queue = initialize().catch(() => {
  note.textContent = 'Could not load settings. Reopen this popup.';
});
document.getElementById('version').textContent = `v${browser.runtime.getManifest().version}`;
