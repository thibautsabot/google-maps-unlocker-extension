# Unlocker — for Google Maps™: reviewer notes

Use these in the "notes to reviewer" field of Firefox Add-ons, the Chrome Web
Store and Edge Add-ons. Nothing in the extension is minified or obfuscated.

## What it is

Unlocker — for Google Maps™ changes how Google Maps behaves for a visitor who
is not signed in. It has three switches in its toolbar panel. Each is off until the user
turns it on. With all three off it does nothing.

| Switch | What it does | Touches cookies |
|---|---|---|
| Full opening hours | Expands the collapsed weekly hours on click | No |
| Review search and filters | Lets the review search, sort and more-reviews controls work without the sign-in prompt | No |
| Full photos and reviews | Replaces the browser's Google session so Maps serves the full gallery and reviews | **Yes** |

## Why it needs the `cookies` permission

Google decides how much of a photo gallery and a review list to send per
session. Some sessions are given a short page with no way to ask for the next
one. The "Full photos and reviews" switch detects this, copies the cookies
from a private-window session into the normal browser session, and reloads the
tab. It then checks whether the page is now complete, and tries another
session if not (at most five times).

This is the only use of `cookies`. Cookie values are not sent to the developer
or other third parties. Maps receives its ordinary requests to Google. A
working set is saved in extension local storage so it can be reused.

**The user consents in the product UI before cookies are handled.** When they
try to enable the switch, the popup presents a modal disclosure before saving
the setting. It states that the feature reads and replaces Google cookies,
saves a working set locally, sends Maps requests to Google, and signs them out
of Google in this browser. "Agree and continue" is a separate affirmative
action; Cancel leaves the feature off. Turning the switch off clears consent,
so enabling it again asks again. A missing consent record blocks all
photo-roll background handlers, including on settings migrated from earlier
versions. The listing and privacy policy repeat the disclosure, but consent
is collected by the popup, not by the listing.

## Other permissions

- `storage`: remembers which switches are on and the saved session.
- Host access to `*.google.com`: the cookie swap needs it, and the content
  scripts run only on `google.com/maps/*` and `maps.google.com/maps/*`.
- `incognito: "spanning"`: the swap needs access to a private/incognito
  window. The browser keeps this permission under user control; this extension
  checks it and points the user to settings, but cannot enable it itself.

## Something a reviewer may notice

The extension does one fetch of Google's own Maps JavaScript bundle (a URL
already loaded by the page). It reads that text to learn how Google names a few
functions and labels this week, so it does not depend on names that change
between releases. It never executes the fetched text and never sends it
anywhere.

## Data collection

The extension handles authentication cookies locally after consent, and Maps
receives its normal requests. The developer receives no data. `PRIVACY.md`
explains the distinction. Firefox's `data_collection_permissions` describes
what the extension sends to the developer or other third parties; verify the
store dashboard disclosures against Mozilla's current data categories before
submitting.

## How to test

1. Load the extension. Open the toolbar panel. Everything is off.
2. Open a place on `google.com/maps` while signed out.
3. Turn on "Full opening hours". Click the hours: the whole week opens.
4. Turn on "Review search and filters". Open the Reviews tab: search, sort and
   the more-reviews button work with no sign-in prompt.
5. "Full photos and reviews" reloads the tab and replaces Google cookies. Test
   it last, in a browser profile with no Google account signed in.

Source and tests: https://github.com/thibautsabot/google-maps-unlocker-extension
(`node tests/run.mjs`).
