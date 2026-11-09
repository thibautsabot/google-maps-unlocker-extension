const FEATURES = [
  {
    id: 'hours',
    label: 'Full opening hours',
    note: 'Shows the whole week without the sign-in prompt, even when Google first sends only today.'
  },
  {
    id: 'reviews',
    label: 'Review search and filters',
    note: 'Opens the review list, sort, and search without the sign-in prompt, and loads more reviews as you scroll.'
  },
  {
    id: 'photos',
    label: 'Full photos',
    note: 'Shows the photos Google keeps back when you are not signed in, '
      + 'and keeps the gallery loading as you scroll.'
  }
];

const FEATURES_OFF = Object.fromEntries(FEATURES.map((f) => [f.id, false]));

const FEATURES_KEY = 'features';
