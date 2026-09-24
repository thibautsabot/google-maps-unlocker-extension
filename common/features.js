const FEATURES = [
  {
    id: 'hours',
    label: 'Full opening hours',
    // appliesAtOnce says whether a tab already open will obey a change without reloading
    note: 'Expands the whole week without the sign-in prompt.',
    appliesAtOnce: true
  },
  {
    id: 'photos',
    label: 'Full photo gallery',
    note: "Lifts Google's photo cap by borrowing a private session. Swaps "
      + 'your Google cookies and reloads the tab.',
    appliesAtOnce: false
  }
];

const FEATURES_OFF = Object.fromEntries(FEATURES.map((f) => [f.id, false]));

const FEATURES_KEY = 'features';

const featureOn = async (name) =>
  !!(await browser.storage.local.get(FEATURES_KEY))[FEATURES_KEY]?.[name];
