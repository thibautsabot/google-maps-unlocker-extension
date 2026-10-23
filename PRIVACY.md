# Privacy policy: GM Native Maps

Last updated: 7 October 2026

GM Native Maps has no server, account, analytics or tracking. It does not
collect or transmit data to the extension developer or any third-party service.
When you explicitly agree to enable "Full photos and reviews", the extension
handles Google authentication cookies locally in your browser so it can replace
the Maps session. Maps continues to send its normal requests, including those
cookies, to Google.

## What the extension reads and changes

- **Google Maps pages.** It runs on `/maps/*` pages on the 187 Google domains
  in the supported-domains list captured by this release. It reads the page and Google's own replies to show content Google
  has already sent, and changes the page in your browser to do so. If Google
  sends only today's hours, the extension repeats that place request to Google
  and gives Maps the fuller reply. Nothing it reads is sent to the extension
  developer.
- **Your settings.** Which switches are on is kept in your browser's local
  extension storage. It never leaves your device.
- **Google authentication cookies, only after explicit consent.** When you
  accept the consent dialog and enable "Full photos and reviews", it reads and
  replaces Google cookies in your normal browser profile, and saves a working
  set in local extension storage for reuse. This signs you out of Google in
  that profile. Cookie values are not sent to the extension developer or any
  third party; Google receives the cookies as part of Maps requests. With the
  feature off, no cookie is read or written. Turning the switch off also
  withdraws the saved consent; enabling it again asks you to agree again.

## What leaves your device

The extension makes requests only to Google: Maps' normal requests, plus one
fetch of Google's own Maps script so it can read the page's wording. It
contacts no other server, and does not send user data to the extension
developer or any third party.

## Contact

Questions: open an issue at
https://github.com/thibautsabot/google-maps-unlocker-extension/issues
