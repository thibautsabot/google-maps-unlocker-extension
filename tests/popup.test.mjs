// Runs real popup scripts in an isolated VM with browser/DOM fakes.
// No browser, network, shared harness, or dependencies required.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const place = 'https://www.google.com/maps/place/X';
const source = ['common/features.js', 'common/maps-url.js', 'popup/popup.js'].map(read).join('\n');

function popup({ features = {}, pending = {}, tab = { id: 1, url: place }, failReload = false } = {}) {
  const store = structuredClone({ features, reloadPending: pending });
  const calls = { get: [], query: [], set: [], reload: [], closed: 0 };
  const elements = new Map();
  const element = () => ({
    children: [], checked: false, disabled: false, hidden: true, textContent: '',
    listeners: {},
    append(...children) { this.children.push(...children); },
    addEventListener(type, fn) { this.listeners[type] = fn; }
  });
  for (const id of ['features', 'note', 'reload', 'version']) elements.set(id, element());
  const browser = {
    storage: { local: {
      async get(keys) {
        calls.get.push(keys);
        const result = Object.fromEntries((Array.isArray(keys) ? keys : [keys])
          .filter((key) => key in store).map((key) => [key, structuredClone(store[key])]));
        // Snapshot before yielding: concurrent reads reproduce lost-update bugs.
        await Promise.resolve();
        return result;
      },
      async set(values) {
        await Promise.resolve();
        calls.set.push(structuredClone(values));
        Object.assign(store, structuredClone(values));
      }
    } },
    tabs: {
      async query(query) { calls.query.push(structuredClone(query)); return tab ? [tab] : []; },
      async reload(id) {
        calls.reload.push({ id, pending: structuredClone(store.reloadPending) });
        if (failReload) throw new Error('reload failed');
      }
    },
    runtime: { getManifest: () => ({ version: '1.2.3' }) }
  };
  const context = { browser, URL, document: {
    getElementById: (id) => elements.get(id), createElement: element
  }, window: { close: () => { calls.closed++; } } };
  runInNewContext(source, context);
  const boxes = new Map(elements.get('features').children.map((label) => [label.children[0].id, label.children[0]]));
  return {
    store, calls, boxes, note: elements.get('note'), reload: elements.get('reload'),
    version: elements.get('version'),
    settle: () => runInNewContext('queue', context),
    toggle(id, checked) {
      const box = boxes.get(id);
      assert.equal(box.disabled, false);
      box.checked = checked;
      return box.listeners.change();
    },
    allowReload: () => { failReload = false; }
  };
}

let count = 0;
async function test(name, check) {
  await check();
  count++;
  console.log(`  ok    ${name}`);
}

await test('opening reads storage and current tab once, defaults switches off', async () => {
  const world = popup();
  assert.ok([...world.boxes.values()].every((box) => box.disabled));
  await world.settle();
  assert.equal(world.calls.get.length, 1);
  assert.equal(world.calls.query.length, 1);
  assert.deepEqual(world.calls.query[0], { active: true, currentWindow: true });
  assert.ok([...world.boxes.values()].every((box) => !box.checked && !box.disabled));
  assert.equal(world.note.textContent, 'All features off.');
  assert.equal(world.reload.hidden, true);
  assert.equal(world.version.textContent, 'v1.2.3');
});

await test('rapid toggles preserve independent changes and latest same-switch value', async () => {
  const world = popup({ features: { unknown: true }, pending: { 2: place } });
  await world.settle();
  world.toggle('hours', true);
  world.toggle('photos', true);
  world.toggle('reviews', true);
  world.toggle('hours', false);
  await world.settle();
  assert.deepEqual(world.store.features, { hours: false, reviews: true, photos: true, unknown: true });
  assert.deepEqual([...world.boxes.values()].map((box) => box.checked), [false, true, true]);
  assert.deepEqual(world.store.reloadPending, { 1: true, 2: place });
  assert.equal(world.note.textContent, 'Reload the Maps tab to apply.');
  assert.equal(world.reload.hidden, false);
  assert.equal(world.calls.query.length, 1);
  assert.equal(world.calls.get.length, 5); // Initialization, then one pending-map read per change.
});

await test('turning final switch off still explains pending reload, including reopen', async () => {
  const world = popup({ features: { hours: true } });
  await world.settle();
  await world.toggle('hours', false);
  assert.equal(world.note.textContent, 'All features off. Reload the Maps tab to apply.');
  assert.equal(world.reload.hidden, false);
  const reopened = popup({ features: world.store.features, pending: world.store.reloadPending });
  await reopened.settle();
  assert.equal(reopened.note.textContent, world.note.textContent);
  assert.equal(reopened.reload.hidden, false);
});

await test('enabled switches without pending reload show Ready', async () => {
  const world = popup({ features: { reviews: true } });
  await world.settle();
  assert.equal(world.boxes.get('reviews').checked, true);
  assert.equal(world.note.textContent, 'Ready.');
  assert.equal(world.reload.hidden, true);
});

await test('non-Maps tabs, unsupported paths, and missing tabs never offer reload', async () => {
  for (const tab of [
    { id: 1, url: 'https://example.com/' },
    { id: 1, url: 'https://www.google.com/maps' },
    { id: 1, url: 'https://www.google.com/Maps/place/X' },
    { id: 1, url: 'http://www.google.com/maps/place/X' },
    { id: 1, url: 'https://google.com.evil.example/maps/place/X' },
    { id: 1 }, undefined
  ]) {
    const world = popup({ tab: tab ?? null, pending: { 1: true } });
    await world.settle();
    await world.toggle('photos', true);
    assert.equal(world.note.textContent, 'Ready.');
    assert.equal(world.reload.hidden, true);
    assert.deepEqual(world.store.reloadPending, { 1: true });
    assert.equal(world.calls.set.length, 1);
    assert.equal(world.calls.get.length, 1);
    await world.reload.onclick();
    assert.equal(world.calls.reload.length, 0);
  }
});

await test('localized injected paths and tab ID zero can request reload', async () => {
  for (const url of ['https://www.google.co.jp/maps/', 'https://maps.google.fr/maps/place/X',
    'https://www.google.co.uk/maps/search/test']) {
    const world = popup({ tab: { id: 0, url } });
    await world.settle();
    await world.toggle('hours', true);
    assert.deepEqual(world.store.reloadPending, { 0: true });
    assert.equal(world.reload.hidden, false);
    assert.equal(world.note.textContent, 'Reload the Maps tab to apply.');
  }
});

await test('failed reload preserves pending prompt; successful retry clears only current tab', async () => {
  const world = popup({ pending: { 1: true, 2: place }, failReload: true });
  await world.settle();
  await world.reload.onclick();
  assert.deepEqual(world.store.reloadPending, { 1: true, 2: place });
  assert.equal(world.reload.hidden, false);
  assert.equal(world.reload.disabled, false);
  assert.equal(world.calls.closed, 0);
  assert.equal(world.note.textContent, 'Could not reload the Maps tab. Try again.');
  world.allowReload();
  await world.reload.onclick();
  assert.deepEqual(world.calls.reload.map(({ id }) => id), [1, 1]);
  assert.ok(world.calls.reload.every(({ pending }) => pending[1] === true));
  assert.deepEqual(world.store.reloadPending, { 2: place });
  assert.equal(world.reload.hidden, true);
  assert.equal(world.calls.closed, 1);
});

await test('reload waits for queued saves and ignores duplicate clicks', async () => {
  const world = popup({ pending: { 1: true } });
  await world.settle();
  world.toggle('photos', true);
  const loading = world.reload.onclick();
  assert.equal(world.reload.disabled, true);
  await world.reload.onclick();
  await loading;
  assert.equal(world.store.features.photos, true);
  assert.equal(world.calls.reload.length, 1);
  assert.deepEqual(world.store.reloadPending, {});
  assert.equal(world.calls.closed, 1);
});

console.log(`popup: ${count}/${count} passed`);
