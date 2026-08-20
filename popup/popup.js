const $ = (id) => document.getElementById(id);

const send = (message) => chrome.runtime.sendMessage(message);

function hexOf(swatches, name) {
  const rgb = swatches[name];
  if (!rgb) return "transparent";
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function renderSites(sites, swatches) {
  const list = $("sites");
  list.textContent = "";

  const entries = Object.entries(sites)
    .sort((a, b) => a[1].title.localeCompare(b[1].title));

  $("siteCount").textContent = entries.length ? `(${entries.length})` : "";
  $("sitesEmpty").hidden = entries.length > 0;

  for (const [key, site] of entries) {
    const li = document.createElement("li");

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = hexOf(swatches, site.color);
    chip.style.setProperty("--sampled", site.hex);
    chip.title = `icon ${site.hex} → ${site.color}`;

    const name = document.createElement("span");
    name.className = "name";
    const title = document.createElement("b");
    title.textContent = site.title;
    const detail = document.createElement("small");
    detail.textContent = `${site.host} · ${site.color}`;
    name.append(title, detail);

    const forget = document.createElement("button");
    forget.className = "forget";
    forget.textContent = "×";
    forget.title = "Forget this site and re-read its icon";
    forget.addEventListener("click", async () => {
      forget.disabled = true;
      await send({ type: "forget", key });
      await refresh();
    });

    li.append(chip, name, forget);
    list.append(li);
  }
}

function renderUnresolved(unresolved) {
  const entries = Object.entries(unresolved);
  $("unresolvedSection").hidden = entries.length === 0;
  $("unresolvedCount").textContent = entries.length ? `(${entries.length})` : "";

  const list = $("unresolved");
  list.textContent = "";
  for (const [, item] of entries) {
    const li = document.createElement("li");
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = "transparent";
    chip.style.setProperty("--sampled", "transparent");
    chip.style.borderStyle = "dashed";

    const name = document.createElement("span");
    name.className = "name";
    const title = document.createElement("b");
    title.textContent = item.title;
    const detail = document.createElement("small");
    detail.textContent = `${item.host} · ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}`;
    name.append(title, detail);

    li.append(chip, name, document.createElement("span"));
    list.append(li);
  }
}

function renderSettings(settings) {
  $("enabled").checked = settings.enabled;
  $("granularity").value = settings.granularity;
  $("minTabs").value = String(settings.minTabs);
  $("respectManualGroups").checked = settings.respectManualGroups;
}

async function refresh() {
  const state = await send({ type: "getState" });
  if (!state) return;
  renderSettings(state.settings);
  renderSites(state.sites, state.swatches);
  renderUnresolved(state.unresolved);
}

async function withBusy(button, work) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";
  try {
    await work();
    await refresh();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

$("sweep").addEventListener("click", (e) =>
  withBusy(e.currentTarget, () => send({ type: "sweep" })));

$("resample").addEventListener("click", (e) =>
  withBusy(e.currentTarget, () => send({ type: "resample" })));

for (const [id, read] of [
  ["enabled", (el) => el.checked],
  ["granularity", (el) => el.value],
  ["minTabs", (el) => Number(el.value)],
  ["respectManualGroups", (el) => el.checked],
]) {
  $(id).addEventListener("change", async (e) => {
    await send({ type: "setSettings", patch: { [id]: read(e.currentTarget) } });
    await refresh();
  });
}

refresh();
