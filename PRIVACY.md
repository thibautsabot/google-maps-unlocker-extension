# Privacy policy: GM Native Maps

Last updated: 9 November 2026

GM Native Maps has no server, account, analytics or tracking. It does not
collect or transmit data to the extension developer or any third-party service.
The extension reads and writes no cookie.

## What the extension reads and changes

- **Google Maps pages.** It runs on `/maps/*` pages on the 187 Google domains
  in the supported-domains list captured by this release. It reads the page and Google's own replies to show content Google
  has already sent, and changes the page in your browser to do so. If Google
  sends only today's hours, the extension repeats that place request to Google
  and gives Maps the fuller reply. Nothing it reads is sent to the extension
  developer.
- **Your settings.** Which switches are on is kept in your browser's local
  extension storage. It never leaves your device.
- **Photo galleries.** When Google marks a gallery as limited, the extension
  replays its request in batches of 10, follows Google's continuation tokens,
  and gives Maps the merged list. These are ordinary Maps requests to Google. No
  cookie is read, written or saved, and the extension has no cookie permission.
- **Reviews.** When Google sends five reviews and no way to continue, the
  extension asks Google's review call for the following rows (a row offset),
  and, when a rating sort runs out, for Google's own topic chips and for words
  taken from the reviews already on screen. These are ordinary Maps requests
  to Google, with the same sort you chose. No cookie is read, written or saved.

## What leaves your device

The extension makes requests only to Google: photo-page replays, opening-hours
retries, review-list pages, and fetches of matching Maps JavaScript bundles for script discovery.
Discovery may fetch multiple bundles and can run while feature switches are off.
It contacts no other server, and does not send user data to the extension
developer or any third party.

## Contact

Questions: open an issue at
https://github.com/thibautsabot/google-maps-unlocker-extension/issues
