// SPDX-License-Identifier: Apache-2.0
// Maia Voice — SillyTavern extension scaffold (bet1.7).
// Settings panel only; chat-pipeline integration lands in bet1.8.

import {
  extension_settings,
  renderExtensionTemplateAsync,
} from "../../../extensions.js";
import {
  saveSettingsDebounced,
  eventSource,
  event_types,
} from "../../../../script.js";

const MODULE = "maia_voice";
const DEFAULT_BASE_URL = "https://api.maia.sh";

// Derive the third-party folder name from this module's URL so renaming the
// install dir (e.g. during the bet1.10 extraction) doesn't silently break the
// settings template lookup. Falls back to "maia-voice" if parsing fails.
const EXT_PATH = (() => {
  try {
    const m = import.meta.url.match(/\/scripts\/extensions\/(third-party\/[^/]+)\//);
    return m?.[1] ?? "third-party/maia-voice";
  } catch {
    return "third-party/maia-voice";
  }
})();

const DEFAULTS = Object.freeze({
  enabled: false,
  baseUrl: DEFAULT_BASE_URL,
  apiKey: "",
  persona: "",
  sceneFormat: "",
  sceneDialogueAct: "",
  voice: "",
  _cachedStarters: [],
});

function settings() {
  if (!extension_settings[MODULE]) extension_settings[MODULE] = { ...DEFAULTS };
  // Backfill new fields without clobbering existing values.
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in extension_settings[MODULE])) {
      extension_settings[MODULE][k] = DEFAULTS[k];
    }
  }
  return extension_settings[MODULE];
}

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, kind /* "ok" | "err" | "" */) {
  const el = $("maia-status");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

async function fetchStarters() {
  const s = settings();
  if (!s.apiKey) throw new Error("API key required");
  const base = (s.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const res = await fetch(`${base}/v1/personas`, {
    headers: { Authorization: `Bearer ${s.apiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body?.starters)) throw new Error("response missing starters[]");
  return body.starters;
}

function populatePersonaSelect(starters) {
  const sel = $("maia-persona");
  if (!sel) return;
  const current = settings().persona;
  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— pick a persona —";
  sel.appendChild(placeholder);
  for (const s of starters) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.id})`;
    sel.appendChild(opt);
  }
  if (current && starters.some((s) => s.id === current)) sel.value = current;
  applyPersonaScenes(starters, sel.value);
}

function applyPersonaScenes(starters, personaId) {
  const persona = starters.find((s) => s.id === personaId);
  const tagline = $("maia-persona-tagline");
  if (tagline) tagline.textContent = persona?.tagline ?? "";

  const fmtSel = $("maia-scene-format");
  const actSel = $("maia-scene-act");
  if (fmtSel) {
    const current = settings().sceneFormat;
    fmtSel.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— persona default —";
    fmtSel.appendChild(placeholder);
    for (const f of persona?.scene_formats ?? []) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      fmtSel.appendChild(opt);
    }
    if (current && (persona?.scene_formats ?? []).includes(current)) fmtSel.value = current;
  }
  if (actSel) {
    const current = settings().sceneDialogueAct;
    actSel.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— persona default —";
    actSel.appendChild(placeholder);
    for (const a of persona?.scene_dialogue_acts ?? []) {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = a;
      actSel.appendChild(opt);
    }
    if (current && (persona?.scene_dialogue_acts ?? []).includes(current)) actSel.value = current;
  }
}

function bindHandlers() {
  const s = settings();

  $("maia-enabled").checked = !!s.enabled;
  $("maia-enabled").addEventListener("change", (e) => {
    s.enabled = e.target.checked;
    saveSettingsDebounced();
  });

  $("maia-base-url").value = s.baseUrl ?? DEFAULT_BASE_URL;
  $("maia-base-url").addEventListener("change", (e) => {
    s.baseUrl = e.target.value.trim() || DEFAULT_BASE_URL;
    saveSettingsDebounced();
  });

  $("maia-api-key").value = s.apiKey ?? "";
  $("maia-api-key").addEventListener("change", (e) => {
    s.apiKey = e.target.value.trim();
    saveSettingsDebounced();
  });

  $("maia-key-toggle").addEventListener("click", () => {
    const input = $("maia-api-key");
    input.type = input.type === "password" ? "text" : "password";
  });

  $("maia-voice").value = s.voice ?? "";
  $("maia-voice").addEventListener("change", (e) => {
    s.voice = e.target.value;
    saveSettingsDebounced();
  });

  $("maia-persona").addEventListener("change", (e) => {
    s.persona = e.target.value;
    applyPersonaScenes(s._cachedStarters, s.persona);
    saveSettingsDebounced();
  });
  $("maia-scene-format").addEventListener("change", (e) => {
    s.sceneFormat = e.target.value;
    saveSettingsDebounced();
  });
  $("maia-scene-act").addEventListener("change", (e) => {
    s.sceneDialogueAct = e.target.value;
    saveSettingsDebounced();
  });

  $("maia-test-conn").addEventListener("click", async () => {
    setStatus("Connecting…", "");
    try {
      const starters = await fetchStarters();
      s._cachedStarters = starters;
      saveSettingsDebounced();
      populatePersonaSelect(starters);
      setStatus(`Connected — ${starters.length} starter${starters.length === 1 ? "" : "s"} available.`, "ok");
    } catch (err) {
      setStatus(`Failed: ${err?.message ?? err}`, "err");
    }
  });
}

async function loadSettingsHtml() {
  // Use the runtime-derived path so renaming the install dir doesn't break
  // template lookup. Second arg is the template id (no .html extension).
  return renderExtensionTemplateAsync(EXT_PATH, "settings");
}

async function init() {
  const s = settings();

  let html;
  try {
    html = await loadSettingsHtml();
  } catch (err) {
    console.error("[maia-voice] failed to load settings template:", err);
    return;
  }

  // Mount once, with a clear preference order: ST renders the modern drawer
  // into #extensions_settings2; older builds use #extensions_settings. Avoid
  // the `?? fallback` trick — `insertAdjacentHTML` returns `undefined` so it
  // would always fall through and double-mount.
  const target =
    document.getElementById("extensions_settings2") ??
    document.getElementById("extensions_settings");
  if (!target) {
    console.warn("[maia-voice] extensions settings container not found");
    return;
  }
  target.insertAdjacentHTML("beforeend", html);

  bindHandlers();

  // Render whatever we cached previously so the dropdown isn't empty if the
  // API is briefly unreachable on this load.
  if (s._cachedStarters?.length) populatePersonaSelect(s._cachedStarters);

  // Background reconcile: if we have a key, refresh the starter list and clear
  // any stored persona that no longer exists upstream.
  if (s.apiKey) {
    fetchStarters()
      .then((starters) => {
        s._cachedStarters = starters;
        if (s.persona && !starters.some((x) => x.id === s.persona)) {
          s.persona = "";
          s.sceneFormat = "";
          s.sceneDialogueAct = "";
          setStatus("Stored persona is no longer available — please pick again.", "err");
        }
        saveSettingsDebounced();
        populatePersonaSelect(starters);
      })
      .catch((err) => {
        // Silent on init — surface only if the user hits "Test connection".
        console.debug("[maia-voice] background starter refresh failed:", err);
      });
  }
}

// SillyTavern fires APP_READY once the core UI is mounted. Attach init there
// so the settings container reliably exists. Falls back to running immediately
// if the event has already fired by the time this module loads.
if (eventSource && event_types?.APP_READY) {
  eventSource.on(event_types.APP_READY, () => {
    init().catch((err) => console.error("[maia-voice] init failed:", err));
  });
} else {
  init().catch((err) => console.error("[maia-voice] init failed:", err));
}

export { settings, fetchStarters };
