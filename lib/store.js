// Persisted state. The service worker is torn down when idle, so everything is
// re-read lazily on wake and kept in a module-level cache while it is alive.

const SETTINGS_KEY = "settings.v1";
const SITES_KEY = "sites.v1";
const UNRESOLVED_KEY = "unresolved.v1";
const OVERRIDES_KEY = "overrides.v1";
const CACHE_VERSION_KEY = "cacheVersion";

// Bump whenever icon sampling or color matching changes, so colors learned by
// the old logic are discarded instead of being served from cache forever. Users
// should not have to know to press "Re-sample icons" after an update.
const CACHE_VERSION = 3;

export const DEFAULT_SETTINGS = {
  enabled: true,
  // "domain"    -> one group per registrable domain (docs.google.com -> Google)
  // "subdomain" -> one group per host          (docs.google.com -> Docs / Google)
  granularity: "domain",
  // Tabs a site needs before it gets its own group.
  minTabs: 1,
  // Leave tabs alone if the user has dragged them into a group we do not manage.
  respectManualGroups: false,
};

let cache = null;

async function load() {
  if (cache) return cache;
  const raw = await chrome.storage.local.get(
    [SETTINGS_KEY, SITES_KEY, UNRESOLVED_KEY, OVERRIDES_KEY, CACHE_VERSION_KEY]
  );

  // key -> { title, color, rgb, hex, host, iconUrl, learnedAt }
  let sites = raw[SITES_KEY] || {};
  // key -> { title, host, attempts, lastTriedAt }
  let unresolved = raw[UNRESOLVED_KEY] || {};

  if (raw[CACHE_VERSION_KEY] !== CACHE_VERSION) {
    // Only sampled data is discarded. Overrides are the user's own decisions,
    // not something this extension derived, so they survive every reset.
    sites = {};
    unresolved = {};
    await chrome.storage.local.set({
      [SITES_KEY]: sites,
      [UNRESOLVED_KEY]: unresolved,
      [CACHE_VERSION_KEY]: CACHE_VERSION,
    });
  }

  cache = {
    settings: { ...DEFAULT_SETTINGS, ...(raw[SETTINGS_KEY] || {}) },
    sites,
    unresolved,
    // key -> group color name, set by hand and always winning over the icon
    overrides: raw[OVERRIDES_KEY] || {},
  };
  return cache;
}

// Another context (the popup) may have written; drop our copy and re-read.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") cache = null;
});

export async function getSettings() {
  return (await load()).settings;
}

export async function setSettings(patch) {
  const state = await load();
  state.settings = { ...state.settings, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: state.settings });
  return state.settings;
}

export async function getSites() {
  return (await load()).sites;
}

export async function getUnresolved() {
  return (await load()).unresolved;
}

export async function putSite(key, record) {
  const state = await load();
  state.sites[key] = record;
  delete state.unresolved[key];
  await chrome.storage.local.set({
    [SITES_KEY]: state.sites,
    [UNRESOLVED_KEY]: state.unresolved,
  });
}

export async function markUnresolved(key, info) {
  const state = await load();
  const previous = state.unresolved[key];
  state.unresolved[key] = {
    ...info,
    attempts: (previous?.attempts ?? 0) + 1,
    lastTriedAt: Date.now(),
  };
  await chrome.storage.local.set({ [UNRESOLVED_KEY]: state.unresolved });
}

export async function getOverrides() {
  return (await load()).overrides;
}

/**
 * Pin a site to a color by hand, or pass null to hand it back to the icon.
 * @param {string} key
 * @param {string|null} color a tab-group color name
 */
export async function setOverride(key, color) {
  const state = await load();
  if (color) state.overrides[key] = color;
  else delete state.overrides[key];
  await chrome.storage.local.set({ [OVERRIDES_KEY]: state.overrides });
}

/**
 * Forget every learned color so the next sweep re-samples icons from scratch.
 * This is the one action that also drops hand-picked overrides: it is the
 * explicit "start over from what the icons say" button. Short of pressing it,
 * an override lasts indefinitely and survives restarts.
 */
export async function clearLearned() {
  const state = await load();
  state.sites = {};
  state.unresolved = {};
  state.overrides = {};
  await chrome.storage.local.set({
    [SITES_KEY]: {},
    [UNRESOLVED_KEY]: {},
    [OVERRIDES_KEY]: {},
  });
}

/** Full reset for one site: drop what was learned and any override with it. */
export async function forgetSite(key) {
  const state = await load();
  delete state.sites[key];
  delete state.unresolved[key];
  delete state.overrides[key];
  await chrome.storage.local.set({
    [SITES_KEY]: state.sites,
    [UNRESOLVED_KEY]: state.unresolved,
    [OVERRIDES_KEY]: state.overrides,
  });
}
