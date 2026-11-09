// What the background does. It has one job: a tab waiting for a reload after
// a switch was changed stops waiting once its page has loaded.

import { fakeBrowser, loadBackground, suite } from './lib/harness.mjs';

const t = suite('background');
const place = 'https://www.google.com/maps/place/X/@48.86,2.35,15z';

{
  const world = fakeBrowser({ pending: { 1: place, 2: place } });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place }, 1);
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

  await send({ type: 'gm-hello', url: place }, 1);
  t.check('with every switch off the hello is still answered', !(1 in world.pendingNow()));
}
{
  // Nothing in the background reaches for cookies, windows or other tabs.
  const world = fakeBrowser();
  loadBackground(world);
  t.check('the background was given no cookie or window API to use',
    world.browser.cookies === undefined && world.browser.windows === undefined);
}


process.exit(t.done());
