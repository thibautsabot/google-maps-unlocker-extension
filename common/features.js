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
    note: 'Shows more photos. Borrows a session from a private window and '
      + 'reloads the tab, up to six times. If Google still limits it, the '
      + 'list is lengthened in the page instead. Replaces your Google '
      + 'cookies and signs you out of Google in this browser.'
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
