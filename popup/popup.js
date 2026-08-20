const $ = (id) => document.getElementById(id);

const send = (message) => chrome.runtime.sendMessage(message);

function hexOf(swatches, name) {
  const rgb = swatches[name];
  if (!rgb) return "transparent";
  return "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Lucide "pipette", inlined so the popup stays a self-contained bundle.
const EYEDROPPER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/>
  <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>
</svg>`;

/** The nine colors, with a way back to whatever the icon said. */
function buildPicker(key, site, override, swatches) {
  const picker = document.createElement("div");
  picker.className = "picker";
  picker.hidden = true;

  const swatchRow = document.createElement("div");
  swatchRow.className = "swatches";

  const choose = async (color) => {
    picker.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    await send({ type: "setColor", key, color });
    await refresh();
  };

  for (const name of Object.keys(swatches)) {
    const swatch = document.createElement("button");
    swatch.className = "swatch";
    swatch.style.background = hexOf(swatches, name);
    swatch.title = name;
    swatch.setAttribute("aria-label", name);
    if ((override ?? site.color) === name) swatch.classList.add("selected");
    swatch.addEventListener("click", () => choose(name));
    swatchRow.append(swatch);
  }

  const auto = document.createElement("button");
  auto.className = "auto";
  auto.textContent = override ? `Reset to icon (${site.color})` : "Using icon color";
  auto.disabled = !override;
  auto.addEventListener("click", () => choose(null));

  picker.append(swatchRow, auto);
  return picker;
}

function renderSites(sites, overrides, swatches) {
  const list = $("sites");
  list.textContent = "";

  const entries = Object.entries(sites)
    .sort((a, b) => a[1].title.localeCompare(b[1].title));

  $("siteCount").textContent = entries.length ? `(${entries.length})` : "";
  $("sitesEmpty").hidden = entries.length > 0;

  for (const [key, site] of entries) {
    const override = overrides[key];
    const effective = override ?? site.color;

    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "row";

    const chip = document.createElement("span");
    chip.className = "chip";
    chip.style.background = hexOf(swatches, effective);
    chip.style.setProperty("--sampled", site.hex);
    chip.title = override
      ? `set by hand to ${override} (icon was ${site.hex} → ${site.color})`
      : `icon ${site.hex} → ${site.color}`;

    const name = document.createElement("span");
    name.className = "name";
    const title = document.createElement("b");
    title.textContent = site.title;
    const detail = document.createElement("small");
    detail.textContent = `${site.host} · ${effective}${override ? " · custom" : ""}`;
    name.append(title, detail);

    const edit = document.createElement("button");
    edit.className = "icon-btn edit";
    edit.innerHTML = EYEDROPPER_SVG;
    edit.title = "Choose this group's color";
    edit.setAttribute("aria-label", `Choose color for ${site.title}`);
    edit.setAttribute("aria-expanded", "false");
    if (override) edit.classList.add("active");

    const forget = document.createElement("button");
    forget.className = "icon-btn forget";
    forget.textContent = "×";
    forget.title = "Forget this site and re-read its icon";
    forget.addEventListener("click", async () => {
      forget.disabled = true;
      await send({ type: "forget", key });
      await refresh();
    });

    const picker = buildPicker(key, site, override, swatches);
    edit.addEventListener("click", () => {
      // Only one picker open at a time, or the list turns into a wall.
      for (const other of list.querySelectorAll(".picker")) {
        if (other !== picker) other.hidden = true;
      }
      for (const other of list.querySelectorAll(".edit")) {
        if (other !== edit) other.setAttribute("aria-expanded", "false");
      }
      picker.hidden = !picker.hidden;
      edit.setAttribute("aria-expanded", String(!picker.hidden));
    });

    row.append(chip, name, edit, forget);
    li.append(row, picker);
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

    const row = document.createElement("div");
    row.className = "row";
    row.append(chip, name, document.createElement("span"));
    li.append(row);
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
  renderSites(state.sites, state.overrides ?? {}, state.swatches);
  renderUnresolved(state.unresolved);

  const custom = Object.keys(state.overrides ?? {}).length;
  $("resample").title = custom
    ? `Re-read every icon. Also clears the ${custom} color${custom === 1 ? "" : "s"} you set by hand.`
    : "Re-read every site's icon from scratch.";
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
