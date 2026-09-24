// What the scripts running inside the page report, and when they keep quiet.

import { loadPage, galleryReply, askingFor, askingBlind, askingBatched, storage, suite, wait }
  from './lib/harness.mjs';
import { REQUEST_1, REQUEST_2, REPLY_1, REPLY_2, TOKEN_1, REQUEST_CAPPED, REPLY_CAPPED, frame, shifted }
  from './lib/real.mjs';

const t = suite('page');

// --- switched off -----------------------------------------------------------
{
  const page = loadPage();
  page.reply(galleryReply(10, 45), askingFor(20));
  await wait(50);

  t.check('off: a capped reply is not reported', page.sent('gm-roll-outcome').length === 0);
  t.check('off: nothing is logged either', page.logs.length === 0);
}

// --- a capped gallery -------------------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingFor(20));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('a capped reply is reported', !!outcome);
  t.check('  served 10', outcome?.firstPage === 10);
  t.check('  of 45', outcome?.serverTotal === 45);
  t.check('  having asked for 20', outcome?.asked === 20);
  t.check('the request is announced before its reply, so silence can be told'
    + ' from a slow answer', page.sent('gm-gallery-asking').length === 1);
}

// --- a place with a great many photos ---------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 250000), askingFor(20));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('a total in the hundreds of thousands is still read, so the cap is still seen',
    outcome?.serverTotal === 250000);
}

// --- an uncapped gallery ----------------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(20, 45), askingFor(20));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('an uncapped reply is reported as served 20', outcome?.firstPage === 20);
}

// --- captured traffic -------------------------------------------------------
//
// Two real pages, replayed as Maps sent them. Everything above this uses the
// same shapes with the counts varied; this checks the shapes themselves.
{
  const page = loadPage();
  page.switchOn();
  page.reply(frame('hspqX', REPLY_1), REQUEST_1);
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('real page 1: the gallery is reported', !!outcome);
  t.check('  not mistaken for the single-photo viewer because of the category tabs',
    page.sent('gm-gallery-idle').length === 0);
  t.check('  served 20 of 45', outcome?.firstPage === 20 && outcome?.serverTotal === 45);
  t.check('  having asked for 20, read from the paging message', outcome?.asked === 20);

  page.reply(frame('hspqX', REPLY_2), REQUEST_2);
  await wait(50);

  const [paged] = page.sent('gm-gallery-paged');
  t.check('real page 2: reported as the session paging, 19 photos', paged?.photos === 19);
}

{
  const page = loadPage();
  page.switchOn();
  page.reply(frame('hspqX', REPLY_CAPPED), REQUEST_CAPPED);
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('real capped page: served 10 of 45 having asked for 20, which is the cap read'
    + ' straight off the first page', outcome?.firstPage === 10 && outcome?.serverTotal === 45
    && outcome?.asked === 20);
}

{
  const sent = JSON.parse(JSON.parse(new URLSearchParams(REQUEST_2).get('f.req'))[0][0][1]);
  t.check('real page 2 carries page 1\'s token beside the page size, which is what'
    + ' identifies the paging message', sent[4][2][2] === TOKEN_1 && REPLY_1[5] === TOKEN_1);
}

// --- when Google moves the page size ----------------------------------------
//
// The real pages again, with a field added ahead of the paging message. The
// default layout must not read the thumbnail size it now points at; a
// session that pages must teach the new place; and the next load — capped,
// so it never pages — must be judged by what was taught.
{
  const shared = storage();

  const before = loadPage({ localStorage: shared });
  before.switchOn();
  before.reply(frame('hspqX', REPLY_CAPPED), shifted(REQUEST_CAPPED));
  await wait(50);
  t.check('moved: the default layout gives up rather than read the wrong field',
    before.sent('gm-roll-outcome')[0]?.asked === null);

  const generous = loadPage({ localStorage: shared });
  generous.switchOn();
  generous.reply(frame('hspqX', REPLY_1), shifted(REQUEST_1));
  generous.reply(frame('hspqX', REPLY_2), shifted(REQUEST_2));
  await wait(50);
  t.check('moved: a session that pages learns where the page size went, and says so',
    generous.logs.some((l) => l.includes('has moved from [4,2,1] to [4,3,1]')));

  const capped = loadPage({ localStorage: shared });
  capped.switchOn();
  capped.reply(frame('hspqX', REPLY_CAPPED), shifted(REQUEST_CAPPED));
  await wait(50);
  const [outcome] = capped.sent('gm-roll-outcome');
  t.check('moved: a later capped load is judged by what was learned — 10 of 20',
    outcome?.firstPage === 10 && outcome?.asked === 20);
}

{
  const { envelopes, learnLayout } = loadPage().win.__GMX;
  const before = envelopes(REQUEST_1)[0].args;
  const after = envelopes(REQUEST_2)[0].args;
  t.check('learning finds the paging message in real traffic on its own',
    JSON.stringify(learnLayout(before, REPLY_1, 20, after)) === '{"size":[4,2,1],"token":[4,2,2]}');

  // One of the reply's own category ids sent back beside a count: a second
  // round trip that passes every other test.
  const b = JSON.parse(JSON.stringify(before));
  const a = JSON.parse(JSON.parse(JSON.stringify(JSON.stringify(after))));
  b[9] = [null, 30];
  a[9] = ['CgIgAQ==', 30];
  t.check('two candidates learn nothing, rather than whichever came first',
    learnLayout(b, REPLY_1, 20, a) === null);
}

{
  const shared = storage();
  const page = loadPage({ localStorage: shared });
  page.switchOn();
  page.reply(frame('hspqX', REPLY_1), REQUEST_1);
  page.reply(frame('hspqX', REPLY_2), REQUEST_2);
  await wait(50);

  t.check('unmoved: paging relearns the default and stays quiet about it',
    !page.logs.some((l) => l.includes('has moved')) && shared.getItem('gmnx.pagingLayout') === null);
}

// --- when the page size cannot be read --------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBlind());
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('a page size that is not where it belongs is reported unknown, not guessed',
    outcome?.asked === null);
}

// --- a batch of several calls -----------------------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBatched(20));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('in a batch, the page size is read from the call that served the gallery',
    outcome?.asked === 20);
}

{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), 'f.req=' + encodeURIComponent('[[["hspqX",42,null]]]'));
  await wait(50);

  const [outcome] = page.sent('gm-roll-outcome');
  t.check('arguments that are not a JSON string are skipped, not coerced',
    outcome && outcome.asked === null);
}

// --- the second page, which is what a cap actually looks like ---------------
{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(0, 45), askingBlind());
  await wait(50);

  // Not observed: on the captured capped session Maps never asked for a
  // second page at all. Kept so that an empty follow-up, should one ever
  // arrive, is reported as nothing rather than dropped.
  const [paged] = page.sent('gm-gallery-paged');
  t.check('an empty follow-up page is reported', !!paged);
  t.check('  as nothing served', paged?.photos === 0);
}

{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(20, 45), askingBlind());
  await wait(50);

  const [paged] = page.sent('gm-gallery-paged');
  t.check('a second page that arrives says the session can page', paged?.photos === 20);
}

{
  const page = loadPage();
  page.switchOn();
  page.reply(galleryReply(10, 45), askingBlind());
  page.reply(galleryReply(20, 45), askingBlind());
  page.reply(galleryReply(0, 45), askingBlind());
  await wait(50);

  t.check('only the first follow-up counts, so the end of a long scroll is not a cap',
    page.sent('gm-gallery-paged').length === 1);
}

// --- the single photo viewer ------------------------------------------------
{
  const page = loadPage({ url: 'https://www.google.com/maps/@48.86,2.35,3a,75y,90t/data=!3m7' });
  page.switchOn();
  page.reply(galleryReply(1, 45), askingFor(20));
  await wait(50);

  t.check('one photo of many is the viewer, not a capped gallery',
    page.sent('gm-roll-outcome').length === 0);
  t.check('  and it says so, to release the verdict', page.sent('gm-gallery-idle').length === 1);
}

// --- counting what the page itself carries ----------------------------------
{
  const page = loadPage();
  page.switchOn();
  page.scripts.set('state', {
    textContent: 'APP_INITIALIZATION_STATE=' + JSON.stringify(
      Array.from({ length: 27 }, (_, i) => `https://lh3.googleusercontent.com/p/P${i}\\u003dw100`))
  });
  await wait(4500);

  const counts = page.sent('gm-page-photos');
  t.check('the page reports how many photos it has', counts.length > 0);
  t.check('  reading escaped URLs correctly (27, not 0)', counts.some((c) => c.photos === 27));
  t.check('  and marks the last one final', counts.some((c) => c.final));
  t.check('  carrying the address, so a photo view is recognisable',
    counts.every((c) => typeof c.url === 'string'));
}

// --- the same photo at several sizes is one photo ---------------------------
{
  const page = loadPage();
  page.switchOn();
  page.scripts.set('state', {
    textContent: 'APP_INITIALIZATION_STATE=' + JSON.stringify([
      'https://lh3.googleusercontent.com/p/SAME=w203-h152',
      'https://lh3.googleusercontent.com/p/SAME=w86-h86',
      'https://lh3.googleusercontent.com/p/OTHER=w203'
    ])
  });
  await wait(4500);

  const counts = page.sent('gm-page-photos');
  t.check('sizes of one photo are not counted twice',
    counts.length > 0 && Math.max(...counts.map((c) => c.photos)) === 2);
}

// --- the console API --------------------------------------------------------
{
  const page = loadPage();
  t.check('GMGallery.borrowPrivate exists', typeof page.api()?.borrowPrivate === 'function');
  t.check('GMGallery.forget exists', typeof page.api()?.forget === 'function');
  t.check('the state gallery-ui reads is exposed', !!page.win.__GM_GALLERY__);
}

process.exit(t.done());
