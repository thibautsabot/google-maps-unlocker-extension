# Unlocker — for Google Maps™: reviewer notes

Use these in the notes-to-reviewer field for each store. Source files are not
minified or obfuscated.

## What it is

Unlocker — for Google Maps™ changes how Google Maps behaves for a visitor who
is not signed in. It has three switches in its toolbar panel. Each is off until the user
turns it on. With all three off it does nothing.

| Switch | What it does |
|---|---|
| Full opening hours | Expands the collapsed weekly hours on click, and asks Google for the place again when its first reply carries only today |
| Review search and filters | Lets the review search, sort and more-reviews controls work without the sign-in prompt |
| Full photos | Asks Google for the gallery pages after the first, using the token Google already sent, and gives Maps the longer list |

## No cookies, no private windows

The extension requests no `cookies` permission and no `incognito` access, reads
and writes no cookie, and opens no window. An earlier version borrowed a
session from a private window; it was removed because it did not work.

The photo switch changes one reply. Google gives a visitor who is not signed in
10 photos on the first gallery page, with a "limited" mark that makes Maps stop
asking for more. The extension requests the next pages from Google with the
token that reply carried, appends their photos, clears the mark and hands Maps
the longer list. It runs in the page and sends nothing anywhere but to Google.

## Other permissions

- `storage`: remembers which switches are on, and which tabs are waiting for a
  reload.
- Host access is limited to the 187 hostnames in Google's supported-domains
  list at build time. Page scripts run only on `/maps/*` paths for those hosts.

## Something a reviewer may notice

The extension does one fetch of Google's own Maps JavaScript bundle (a URL
already loaded by the page). It reads that text to learn how Google names a few
functions and labels this week, so it does not depend on names that change
between releases. It never executes the fetched text and never sends it
anywhere.

## Data collection

The developer receives no data, and no cookie is read. `PRIVACY.md` explains
what the extension reads on the page. Firefox's `data_collection_permissions`
is declared as `none`.

## How to test

1. Load the extension. Open the toolbar panel. Everything is off.
2. Open a place on `google.com/maps` while signed out.
3. Turn on "Full opening hours" and reload the Maps tab when offered. Click the
   hours: the whole week opens. If the first place reply has only today, the
   extension asks for the place again; console lines use `[GM-HOURS]`.
4. Turn on "Review search and filters". Open the Reviews tab: search, sort and
   the more-reviews button work with no sign-in prompt.
5. Turn on "Full photos". Open a place with many photos and its gallery: the
   first page shows 10, and scrolling keeps loading more. Console lines use
   `[GM-GALLERY]`.

Source and tests: https://github.com/thibautsabot/google-maps-unlocker-extension
(`node tests/run.mjs`).
