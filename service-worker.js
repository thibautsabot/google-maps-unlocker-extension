// Chrome takes one service worker where Firefox takes a list of scripts.
// importScripts gives the same shared scope, in the manifest's order, with
// the namespace shim first so browser.* exists before anything uses it.
importScripts(
  'common/compat.js',
  'common/features.js',
  'common/registry.js',
  'common/log.js',
  'photos/cookies.js',
  'photos/verdict.js',
  'photos/roll.js',
  'common/dispatch.js'
);
