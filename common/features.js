const FEATURES = [
  {
    id: 'hours',
    label: 'Full opening hours',
    note: 'Shows the whole week without the sign-in prompt, even when Google first sends only today.'
  },
  {
    id: 'reviews',
    label: 'Review search and filters',
    note: 'Opens the review list, sort, and search without the sign-in prompt.'
  },
  {
    id: 'photos',
    label: 'Full photos and reviews',
    note: "Lifts Google's photo cap and one-page review limit by borrowing "
      + 'a private session. Signs you out of Google in this browser, swaps '
      + 'your Google cookies and reloads the tab.'
  }
];

const FEATURES_OFF = Object.fromEntries(FEATURES.map((f) => [f.id, false]));

const FEATURES_KEY = 'features';
const COOKIE_CONSENT_KEY = 'cookieConsentGoogleSessionSwap';

const featureOn = async (name) => {
  const stored = await browser.storage.local.get(FEATURES_KEY);
  if (!stored[FEATURES_KEY]?.[name]) return false;

  if (name === 'photos') {
    const consent = await browser.storage.local.get(COOKIE_CONSENT_KEY);
    return consent[COOKIE_CONSENT_KEY] === true;
  }

  return true;
};
