// What the background does with each thing a page can report.
//
// Every one of these was a bug at some point on 22–23 September. They are
// here so the next change has to keep them fixed.

import { fakeBrowser, loadBackground, cookie, savedSession, suite, wait } from './lib/harness.mjs';

const t = suite('background');
const capped = { type: 'gm-roll-outcome', firstPage: 10, serverTotal: 45, asked: 20 };
const blind = { type: 'gm-roll-outcome', firstPage: 10, serverTotal: 45, asked: null };
const place = 'https://www.google.com/maps/place/X/@48.86,2.35,15z';
const photoView = 'https://www.google.com/maps/@48.86,2.35,3a,75y,90t/data=!3m7';

// --- switched off -----------------------------------------------------------
{
  const world = fakeBrowser({ features: { hours: false, photos: false } });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });
  await send(capped);
  await send({ type: 'gm-borrow-private' });

  t.check('off: no cookie is touched and no tab reloaded',
    !world.did.some((d) => d.startsWith('cookie') || d === 'RELOAD' || d.startsWith('private')));
  t.check('off: a console command is refused in silence',
    !world.did.length);
}

// --- the ordinary capped page -----------------------------------------------
{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });
  await send(capped);

  t.check('capped: the saved session is put back first',
    world.did.some((d) => d === 'cookie NID=saved-one'));
  t.check('capped: and the tab reloads', world.did.includes('RELOAD'));
  t.check('capped: nothing is shown on screen yet',
    !world.did.some((d) => d.startsWith('TOAST')));
}

// --- a first page whose size could not be read ------------------------------
//
// Ten of forty-five used to be enough on its own, because ten was the number
// Google was serving at the time. Without the page size it is pagination as
// much as it is a cap, so nothing is decided until a second page says so.
{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });
  await send(blind);

  t.check('an unreadable page size is not called a cap on the first page alone',
    !world.did.includes('RELOAD') && !world.did.some((d) => d.startsWith('private window')));

  await send({ type: 'gm-gallery-paged', photos: 0 });

  t.check('  an empty second page settles it as capped',
    world.did.some((d) => d.includes('second page came back empty')));
  t.check('  and only then does it act', world.did.includes('RELOAD'));
}

{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });
  await send(blind);
  await send({ type: 'gm-gallery-paged', photos: 20 });

  t.check('a second page that arrives clears the session instead',
    world.did.some((d) => d.includes('not capped')));
  t.check('  so nothing is rolled', !world.did.some((d) => d.startsWith('private window')));
}

{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });
  await send({ type: 'gm-gallery-paged', photos: 0 });

  t.check('a paging report with no first gallery behind it is ignored',
    !world.did.includes('RELOAD'));
}

// --- a lift that worked -----------------------------------------------------
{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send(capped);
  await send({ type: 'gm-hello', url: place });
  await send({ type: 'gm-page-photos', photos: 27, final: false, url: place });
  await wait(2000);

  t.check('worked: exactly one toast, after the reload',
    world.did.filter((d) => d.startsWith('TOAST')).length === 1);
  t.check('worked: it names which session was used',
    world.did.some((d) => d.startsWith('TOAST') && d.includes('Reused the session saved earlier')));
}

// --- silence is not proof ---------------------------------------------------
{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send(capped);
  await send({ type: 'gm-hello', url: place });
  await send({ type: 'gm-page-photos', photos: 3, final: false, url: place });
  await wait(5000);

  t.check('a page that came back with three photos is not a success',
    !world.did.some((d) => d.startsWith('TOAST')));
  t.check('  and it rolls again', world.did.some((d) => d.startsWith('private window')));
}

// --- a reply that arrives after the verdict would have ----------------------
{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send(capped);
  await send({ type: 'gm-hello', url: place });
  await send({ type: 'gm-gallery-asking' });
  await wait(2000);                      // past the 1.5s silence verdict
  await send(capped);                    // the slow reply: still capped

  t.check('a request in flight holds the verdict back',
    !world.did.some((d) => d.startsWith('TOAST')));
}

// --- the single photo viewer ------------------------------------------------
{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send(capped);
  const before = world.did.length;

  await send({ type: 'gm-hello', url: photoView });
  await send({ type: 'gm-gallery-asking' });
  await send({ type: 'gm-gallery-idle' });
  await send({ type: 'gm-page-photos', photos: 2, final: true, url: photoView });
  await wait(2500);

  const after = world.did.slice(before);
  t.check('a photo view is not judged at all', after.some((d) => d.includes('cannot tell')));
  t.check('  and does not trigger a roll', !after.some((d) => d.startsWith('private window')));
}

// --- rolling stops ----------------------------------------------------------
{
  const world = fakeBrowser({ privateSession: (n) => [cookie('NID', `private-${n}`, { storeId: '1' })] });
  const send = loadBackground(world);

  for (let load = 0; load < 7; load++) {
    await send({ type: 'gm-hello', url: place });
    await send(capped);
    }

  const rolls = world.did.filter((d) => d.startsWith('private window')).length;
  t.check(`rolling stops at five (rolled ${rolls})`, rolls === 5);
  t.check('  and says it gave up', world.did.some((d) => d.includes('gave up after 5')));
}

// --- borrowing the same session twice ---------------------------------------
{
  const world = fakeBrowser({ privateSession: () => [cookie('NID', 'always-the-same', { storeId: '1' })] });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });
  await send(capped);
  await send({ type: 'gm-hello', url: place });
  await send(capped);

  t.check('a session already seen capped is refused rather than swapped in again',
    world.did.some((d) => d.includes('already tried') || d.includes('came back the same one')));
}

// --- consent survives a swap ------------------------------------------------
{
  const world = fakeBrowser({
    jar: [cookie('SOCS', 'consent-given'), cookie('NID', 'capped')],
    privateSession: () => [cookie('NID', 'fresh', { storeId: '1' })]
  });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });
  await send(capped);

  const jar = world.jarNow();
  t.check('the consent answer is kept across a swap',
    jar.find((c) => c.name === 'SOCS')?.value === 'consent-given');
  t.check('  and the borrowed session still lands',
    jar.find((c) => c.name === 'NID')?.value === 'fresh');
}

// --- the tab is on a photo when the swap happens ----------------------------
{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });        // the place it came from
  await send({ type: 'gm-hello', url: photoView });    // then a photo was opened
  await send(capped);

  t.check('the place is reopened rather than the photo reloaded',
    world.did.some((d) => d.startsWith('OPEN ') && !d.includes(',3a,')));
}

// --- forgetting -------------------------------------------------------------
{
  const world = fakeBrowser({ saved: savedSession([cookie('NID', 'saved-one')]) });
  const send = loadBackground(world);

  await send({ type: 'gm-hello', url: place });
  await send({ type: 'gm-forget' });

  t.check('forget drops the saved session', !('goodRoll' in world.storage));
  t.check('  and says what it forgot', world.did.some((d) => d.includes('forgot the session saved')));
}

process.exit(t.done());
