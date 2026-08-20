// Persisted state. The service worker is torn down when idle, so everything is
// re-read lazily on wake and kept in a module-level cache while it is alive.

const SETTINGS_KEY = "settings.v1";
const SITES_KEY = "sites.v1";
const UNRESOLVED_KEY = "unresolved.v1";
const CACHE_VERSION_KEY = "cacheVersion";

// Bump whenever icon sampling or colour matching changes, so colours learned by
// the old logic are discarded instead of being served from cache forever. Users
// should not have to know to press "Re-sample icons" after an update.
const CACHE_VERSION = 2;

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
    [SETTINGS_KEY, SITES_KEY, UNRESOLVED_KEY, CACHE_VERSION_KEY]
  );

  // key -> { title, color, rgb, hex, host, iconUrl, learnedAt }
  let sites = raw[SITES_KEY] || {};
  // key -> { title, host, attempts, lastTriedAt }
  let unresolved = raw[UNRESOLVED_KEY] || {};

  if (raw[CACHE_VERSION_KEY] !== CACHE_VERSION) {
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

/** Forget every learned colour so the next sweep re-samples icons from scratch. */
export async function clearLearned() {
  const state = await load();
  state.sites = {};
  state.unresolved = {};
  await chrome.storage.local.set({ [SITES_KEY]: {}, [UNRESOLVED_KEY]: {} });
}

export async function forgetSite(key) {
  const state = await load();
  delete state.sites[key];
  delete state.unresolved[key];
  await chrome.storage.local.set({
    [SITES_KEY]: state.sites,
    [UNRESOLVED_KEY]: state.unresolved,
  });
}
