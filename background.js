import { siteFor, refineTitle } from "./lib/site.js";
import { nearestGroupColor, rgbToHex, GROUP_SWATCHES } from "./lib/palette.js";
import { resolveSiteIdentity } from "./lib/icon.js";
import * as store from "./lib/store.js";

const NO_GROUP = chrome.tabGroups.TAB_GROUP_ID_NONE;

// Group mutations race badly against each other -- two tabs of the same site
// arriving together will each create their own group. Everything is funnelled
// through one serial chain instead.
let chain = Promise.resolve();
function enqueue(work) {
  chain = chain.then(work).catch((err) => console.error("[auto-tab-groups]", err));
  return chain;
}

/**
 * Learn a site the only way this extension is allowed to: read its icon.
 * Returns null when the color cannot be determined yet -- the caller must then
 * leave the tab ungrouped rather than invent a color.
 */
async function learnSite(site, tab) {
  // Icons and <link> tags are not reliably present until the page has loaded.
  if (tab.status !== "complete") return null;

  const identity = await resolveSiteIdentity(tab, site);
  if (!identity) {
    await store.markUnresolved(site.key, { title: site.title, host: site.host });
    return null;
  }

  const record = {
    title: refineTitle(site.title, identity.names),
    color: nearestGroupColor(identity.rgb),
    rgb: identity.rgb,
    hex: rgbToHex(identity.rgb),
    host: site.host,
    iconUrl: identity.iconUrl,
    learnedAt: Date.now(),
  };
  await store.putSite(site.key, record);
  return record;
}

/** Ungrouped, unpinned tabs in the same window that belong to the same site. */
async function siblingTabIds(tab, settings) {
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const key = siteFor(tab.url, settings)?.key;
  return tabs
    .filter((t) => !t.pinned && t.groupId === NO_GROUP && t.url
      && siteFor(t.url, settings)?.key === key)
    .map((t) => t.id);
}

async function placeTab(tab, record, settings, sites) {
  if (tab.groupId !== NO_GROUP) {
    const group = await chrome.tabGroups.get(tab.groupId).catch(() => null);
    if (group) {
      if (group.title === record.title) {
        // Already home. The icon may have been re-sampled since, so keep the
        // color in sync.
        if (group.color !== record.color) {
          await chrome.tabGroups.update(group.id, { color: record.color });
        }
        return;
      }
      const isOurs = Object.values(sites).some((s) => s.title === group.title);
      if (settings.respectManualGroups && !isOurs) return;
    }
  }

  const [existing] = await chrome.tabGroups.query({
    windowId: tab.windowId,
    title: record.title,
  });
  if (existing) {
    await chrome.tabs.group({ groupId: existing.id, tabIds: [tab.id] });
    if (existing.color !== record.color) {
      await chrome.tabGroups.update(existing.id, { color: record.color });
    }
    return;
  }

  let tabIds = [tab.id];
  if (settings.minTabs > 1) {
    tabIds = await siblingTabIds(tab, settings);
    // This tab may currently sit in some other group, which siblingTabIds
    // filters out -- it still belongs in the new one.
    if (!tabIds.includes(tab.id)) tabIds.push(tab.id);
    if (tabIds.length < settings.minTabs) return;
  }

  const groupId = await chrome.tabs.group({
    tabIds,
    createProperties: { windowId: tab.windowId },
  });
  await chrome.tabGroups.update(groupId, { title: record.title, color: record.color });
}

async function handleTab(tabId) {
  const settings = await store.getSettings();
  if (!settings.enabled) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.pinned || !tab.url) return;

  const site = siteFor(tab.url, settings);
  if (!site) return; // chrome://, about:, files -- nothing to parse a site out of

  let sites = await store.getSites();
  let record = sites[site.key];
  if (!record) {
    record = await learnSite(site, tab);
    // No icon color means no group. There is deliberately no fallback color;
    // the tab stays ungrouped and is retried on the next navigation or sweep.
    if (!record) return;
    sites = await store.getSites();
  }

  // A color picked by hand always beats the one read from the icon.
  const override = (await store.getOverrides())[site.key];
  if (override) record = { ...record, color: override };

  await placeTab(tab, record, settings, sites);
}

/** Dissolve our groups that have dropped below the minimum tab count. */
async function enforceMinTabs(windowId) {
  const settings = await store.getSettings();
  if (!settings.enabled || settings.minTabs <= 1) return;

  const sites = await store.getSites();
  const ourTitles = new Set(Object.values(sites).map((s) => s.title));
  const groups = await chrome.tabGroups.query(
    windowId === undefined ? {} : { windowId }
  );
  for (const group of groups) {
    if (!ourTitles.has(group.title)) continue;
    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length > 0 && tabs.length < settings.minTabs) {
      await chrome.tabs.ungroup(tabs.map((t) => t.id)).catch(() => {});
    }
  }
}

async function sweep() {
  const settings = await store.getSettings();
  if (!settings.enabled) return;
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  for (const tab of tabs) {
    await handleTab(tab.id).catch((err) => console.warn("[auto-tab-groups]", err));
  }
  await enforceMinTabs();
}

async function resample() {
  await store.clearLearned();
  await sweep();
}

// ---- events ---------------------------------------------------------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // The URL lands first, the favicon and <link> tags only once loading finishes,
  // so both are worth reacting to.
  if (changeInfo.url || changeInfo.favIconUrl || changeInfo.status === "complete") {
    enqueue(() => handleTab(tabId));
  }
});

chrome.tabs.onAttached.addListener((tabId) => enqueue(() => handleTab(tabId)));

chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) enqueue(() => enforceMinTabs(removeInfo.windowId));
});

chrome.tabs.onDetached.addListener((_tabId, detachInfo) => {
  enqueue(() => enforceMinTabs(detachInfo.oldWindowId));
});

chrome.runtime.onInstalled.addListener(() => enqueue(sweep));
chrome.runtime.onStartup.addListener(() => enqueue(sweep));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "getState":
        sendResponse({
          settings: await store.getSettings(),
          sites: await store.getSites(),
          unresolved: await store.getUnresolved(),
          overrides: await store.getOverrides(),
          swatches: GROUP_SWATCHES,
        });
        return;
      case "setColor": {
        // null hands the site back to its icon; anything else must be a real
        // tab-group color, since Chrome rejects unknown names.
        const color = message.color;
        if (color !== null && !Object.hasOwn(GROUP_SWATCHES, color)) {
          sendResponse({ error: `not a tab-group color: ${color}` });
          return;
        }
        await store.setOverride(message.key, color);
        await enqueue(sweep);
        sendResponse({ ok: true });
        return;
      }
      case "setSettings":
        await store.setSettings(message.patch);
        await enqueue(sweep);
        sendResponse({ settings: await store.getSettings() });
        return;
      case "sweep":
        await enqueue(sweep);
        sendResponse({ ok: true });
        return;
      case "resample":
        await enqueue(resample);
        sendResponse({ ok: true });
        return;
      case "forget":
        await store.forgetSite(message.key);
        await enqueue(sweep);
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ error: "unknown message" });
    }
  })();
  return true; // responding asynchronously
});
