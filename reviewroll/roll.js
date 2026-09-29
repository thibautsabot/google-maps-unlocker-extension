// Review limit: some sessions are given one short page of reviews and no way
// to ask for the next. Measured on one place: 5 reviews, no continuation
// token, and the end marker `null,null,true,[true]`; the same place on a
// good session gave 10 reviews and a token, then pages of 10.
//
// The page shows the limit itself: Maps draws its see-more button only for
// a limited session. ungate.js reports that once per load. This file borrows
// another session, using the same swap the photo cap uses, and reads the
// next load the same way.
//
//   button seen, nothing swapped yet     lift() a new session
//   button seen after a review swap      that session is limited too; burn it
//   no button after a review swap        the limit lifted; keep the session
//
// A page with no button says nothing at all, so success is judged by the
// button still being absent when the tab reports its load. reviewsHello
// starts that clock.

const REVIEWS_SETTLE_MS = 9000;   // how long a swapped page has to show the button
const reviewTimers = new Map();

function clearReviewTimer(tabId) {
  clearTimeout(reviewTimers.get(tabId));
  reviewTimers.delete(tabId);
}

const reviewSwap = (tabId) => {
  const attempt = pending.get(tabId);
  return attempt?.by === 'reviews' ? attempt : null;
};

// The swapped page loaded. If it stays quiet for a while, the limit lifted.
function onReviewsHello(msg, tabId) {
  if (tabId == null || !reviewSwap(tabId)) return;

  clearReviewTimer(tabId);
  reviewTimers.set(tabId, setTimeout(() => {
    reviewTimers.delete(tabId);
    if (reviewSwap(tabId)) settle(tabId, true, 'the review page loaded and showed no limit');
  }, REVIEWS_SETTLE_MS));
}

// The page reported the limited view.
async function onReviewsLimited(msg, tabId) {
  if (tabId == null) return;
  clearReviewTimer(tabId);
  rememberUrl(tabId, msg.url);

  if (reviewSwap(tabId)) {
    settle(tabId, false, 'the swapped session still shows the review limit');
  } else if (pending.has(tabId)) {
    // A photo swap is already reloading this tab. The new load decides.
    return;
  }

  await say(tabId, 'reviews: this session is limited, trying another');
  await lift({ by: 'reviews', galleryUrl: msg.url }, tabId);
}

handles('reviewroll', 'gm-reviews-state', onReviewsLimited);

onTabGone(clearReviewTimer);
