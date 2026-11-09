# Unlocker — for Google Maps™: reviewer notes

Use these in the notes-to-reviewer field for each store. Source files are not
minified or obfuscated.

## What it is

Unlocker — for Google Maps™ changes how Google Maps behaves for a visitor who
is not signed in. It has three switches in its toolbar panel. Each is off until the user
turns it on. Disabled features do not unlock or hide content; payload inspection
and bundle discovery can still run.

| Switch | What it does |
|---|---|
| Full opening hours | Expands the collapsed weekly hours on click, and asks Google for the place again when its first reply carries only today |
| Review search and filters | Lets the review search and sort work without the sign-in prompt, hides the more-reviews button on the Reviews tab, and loads more reviews as you scroll by asking Google's review call for the next rows |
| Full photos | Asks Google for the gallery pages after the first, using the token Google already sent, and gives Maps the longer list |

## No cookies, no private windows

The extension requests no `cookies` permission and no explicit private-window
access, reads and writes no cookie, and opens no window. On update/startup it
removes obsolete saved-session records from extension storage; Maps page loads
also clear earlier research snapshots from page session storage. An earlier version borrowed a
session from a private window; it was removed because it did not work.

Google caps anonymous gallery replies at 10 photos, even when Maps asks for 20.
The larger request can advance pagination past photos that were not returned.
The extension replays capped requests in batches of 10 from the incoming
cursor, follows Google's continuation tokens, and merges consecutive batches.
It clears the limited mark so Maps keeps paging. Requests go only to Google;
no login credentials are read, saved or modified. Research commands and token
mutation helpers are not included in the package.

## Other permissions

- `storage`: remembers which switches are on, and which tabs are waiting for a
  reload.
- Host access is limited to the 187 hostnames in Google's supported-domains
  list at build time. Page scripts run only on `/maps/*` paths for those hosts.

## Something a reviewer may notice

The extension fetches matching Maps JavaScript bundles (URLs already loaded
by the page), including dynamically added bundles. It reads that text to learn how Google names a few
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
4. Turn on "Review search and filters". Open the Reviews tab: search and sort
   work with no sign-in prompt, and scrolling to the end of the list loads more
   reviews. These come from extra requests to the same Google review call:
   first the next rows of the same list (a row offset), then, only when a
   rating sort runs out, Google's topic chips and words from the reviews on
   screen, all under the sort you chose. No cookie is read and no sign-in is faked.
5. Turn on "Full photos". Open a place with many photos and its gallery: the
   capped server replies are replaced by merged batches, normally 20 photos
   initially, and scrolling keeps loading more. Console lines use
   `[GM-GALLERY]`.

Source and tests: https://github.com/thibautsabot/google-maps-unlocker-extension
(`node tests/run.mjs`).
