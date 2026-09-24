// The three lists a feature hooks into, so adding one means adding a folder
// and its scripts. common/dispatch.js reads these and never names a feature.
//
//   HANDLERS   which message a feature answers, and which switch must be on
//   TAB_GONE   what a feature forgets when a tab closes
//   READY      what a feature says when the background starts

const HANDLERS = new Map();

// feature is the toolbar switch that must be on, or null when the message
// is answered even with everything switched off
const handles = (feature, type, fn) => HANDLERS.set(type, { feature, fn });

const TAB_GONE = [];

const onTabGone = (fn) => TAB_GONE.push(fn);

const READY = [];

const onReady = (fn) => READY.push(fn);
