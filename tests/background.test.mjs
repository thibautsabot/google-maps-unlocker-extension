// What the background does. It has one job: a tab waiting for a reload after
// a switch was changed stops waiting once its page has loaded.

import { fakeBrowser, loadBackground, suite } from './lib/harness.mjs';

const t = suite('background');
const place = 'https://www.google.com/maps/place/X/@48.86,2.35,15z';

{
  const world = fakeBrowser({ pending: { 1: place, 2: place } });
  const send = loadBackground(world);

  await send({ type: 'gm-hello' }, 1);
  t.check('a page that has loaded is no longer waiting for a reload',
    !(1 in world.pendingNow()));
  t.check('  and another tab still is', 2 in world.pendingNow());
}
{
  const world = fakeBrowser({ pending: { 1: place } });
  const send = loadBackground(world);

  world.listeners['tab-removed'](1);
  await new Promise((r) => setTimeout(r, 60));
  t.check('a tab that closes stops waiting', !(1 in world.pendingNow()));
}
{
  const world = fakeBrowser({ pending: { 1: place } });
  const send = loadBackground(world);

  await send({ type: 'gm-something-else' }, 1);
  t.check('a message it does not know is ignored', 1 in world.pendingNow() && !world.did.length);
}
{
  const world = fakeBrowser({ features: { hours: false, photos: false }, pending: { 1: place } });
  const send = loadBackground(world);

  await send({ type: 'gm-hello' }, 1);
  t.check('with every switch off the hello is still answered', !(1 in world.pendingNow()));
}
{
  const world = fakeBrowser({ pending: { 1: true } });
  loadBackground(world);
  world.listeners.message({ type: 'gm-hello' }, {});
  await new Promise((r) => setTimeout(r, 60));
  t.check('hello without a sender tab leaves pending records unchanged',
    world.pendingNow()[1] === true && !world.did.length);
}


{
  const world = fakeBrowser();
  world.store.goodRoll = { cookies: [{ value: 'old-session' }] };
  world.store.cookieConsentGoogleSessionSwap = true;
  loadBackground(world);
  world.listeners.installed();
  await new Promise((r) => setTimeout(r, 60));
  t.check('update removes obsolete saved session and consent records',
    !('goodRoll' in world.store) && !('cookieConsentGoogleSessionSwap' in world.store));
}

{
  const world = fakeBrowser({ pending: { 0: true, 1: true, 2: true, 3: true } });
  loadBackground(world);
  world.listeners.message({ type: 'gm-hello' }, { tab: { id: 0 } });
  world.listeners.message({ type: 'gm-hello' }, { tab: { id: 1 } });
  world.listeners['tab-removed'](2);
  await new Promise((r) => setTimeout(r, 60));
  t.check('overlapping hello and close events preserve every deletion',
    !(0 in world.pendingNow()) && !(1 in world.pendingNow()) && !(2 in world.pendingNow()));
  t.check('overlapping cleanup leaves unrelated tabs waiting', world.pendingNow()[3] === true);
}

{
  const world = fakeBrowser({ pending: { 1: true, 2: true } });
  const get = world.browser.storage.local.get;
  let fail = true;
  world.browser.storage.local.get = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error('storage unavailable');
    }
    return get(...args);
  };
  loadBackground(world);
  world.listeners['tab-removed'](1);
  world.listeners['tab-removed'](2);
  await new Promise((r) => setTimeout(r, 60));
  t.check('failed cleanup does not block later cleanup events',
    world.pendingNow()[1] === true && !(2 in world.pendingNow()));
}

process.exit(t.done());
