// SPDX-License-Identifier: Apache-2.0
// Maia Voice — SillyTavern extension scaffold (bet1.7).
// Settings panel only; chat-pipeline integration lands in bet1.8.

import {
  extension_settings,
  getContext,
  renderExtensionTemplateAsync,
} from "../../../extensions.js";
import {
  saveSettingsDebounced,
  eventSource,
  event_types,
} from "../../../../script.js";
import {
  PlaybackQueue,
  requestVoicedAudio,
  sanitizeForSpeech,
} from "./voiced.js";
import {
  bindSettings as bindDebugSettings,
  isDebug,
  logQueue,
  logRequest,
  logResponse,
  logSceneIncompatibility,
} from "./debug.js";

const MAX_QUEUE_DEPTH = 3;
const MAX_INPUT_CHARS = 5000;
const MIN_INPUT_CHARS = 2;

const MODULE = "maia_voice";
const DEFAULT_BASE_URL = "https://api.himaia.dev";

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
  debug: false,
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

let _statusClearTimer = 0;
function setTransientStatus(message, kind, holdMs = 6000) {
  setStatus(message, kind);
  if (_statusClearTimer) clearTimeout(_statusClearTimer);
  _statusClearTimer = setTimeout(() => setStatus("", ""), holdMs);
}

// Module-scoped playback queue. Lazy: created on first use so module load
// inside a non-DOM context (e.g. the parse harness) doesn't error.
const queue = new PlaybackQueue();

// Track the last-spoken text per messageId. Storing the text (not just the id)
// makes dedup robust against ST's two annoying cases:
//   1. Edit message → same id, different text → re-speak.
//   2. Delete + new message lands at same index → different text → re-speak.
// A pure id-set would silently skip both. Cleared when settings.enabled flips.
const lastSpokenByMessageId = new Map();

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
    if (!s.enabled) {
      // Flipping off should also stop anything mid-playback and reset the
      // dedup map so re-enabling later doesn't refuse to speak old messages.
      queue.stop();
      lastSpokenByMessageId.clear();
    }
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

  $("maia-stop-playback").addEventListener("click", () => {
    queue.stop();
  });

  // Reflect "now playing" state into the small status pill below the button.
  queue.onChange((label) => {
    logQueue({ depth: queue.depth(), currentLabel: label });
    const el = $("maia-now-playing");
    if (!el) return;
    if (label) {
      el.textContent = `Now playing: ${label}`;
      el.classList.add("active");
    } else {
      el.textContent = "";
      el.classList.remove("active");
    }
  });

  $("maia-debug").checked = !!s.debug;
  $("maia-debug").addEventListener("change", (e) => {
    s.debug = e.target.checked;
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

async function onCharacterMessageRendered(messageId) {
  const s = settings();
  if (!s.enabled) return;
  if (!s.apiKey || !s.persona) return;

  let chatItem;
  try {
    chatItem = getContext()?.chat?.[messageId];
  } catch (err) {
    console.warn("[maia-voice] could not read chat item:", err);
    return;
  }
  if (!chatItem || chatItem.is_user) return;
  // System / narration messages aren't character voice.
  if (chatItem.is_system) return;

  const raw = chatItem.mes ?? chatItem.message ?? "";
  let clean = sanitizeForSpeech(raw);
  if (clean.length < MIN_INPUT_CHARS) return;
  if (clean.length > MAX_INPUT_CHARS) {
    clean = clean.slice(0, MAX_INPUT_CHARS - 1) + "…";
    if (isDebug()) console.warn("[maia-voice] input truncated to", MAX_INPUT_CHARS);
  }

  // Dedup on cleaned text — handles edits and index-reuse-after-deletion that
  // an id-only Set would silently miss.
  if (lastSpokenByMessageId.get(messageId) === clean) return;
  lastSpokenByMessageId.set(messageId, clean);

  // Backstop: if a stored scene field references something the picked persona
  // doesn't define, drop it. Settings UI keeps these in sync, but the runtime
  // check guards a stale persona-switch in flight.
  const persona = s._cachedStarters.find?.((x) => x.id === s.persona);
  const scene = {};
  if (s.sceneFormat) {
    if (persona && !persona.scene_formats?.includes(s.sceneFormat)) {
      logSceneIncompatibility({
        persona: s.persona,
        requested: { format: s.sceneFormat },
        allowed: persona.scene_formats ?? [],
      });
    } else {
      scene.format = s.sceneFormat;
    }
  }
  if (s.sceneDialogueAct) {
    if (persona && !persona.scene_dialogue_acts?.includes(s.sceneDialogueAct)) {
      logSceneIncompatibility({
        persona: s.persona,
        requested: { dialogue_act: s.sceneDialogueAct },
        allowed: persona.scene_dialogue_acts ?? [],
      });
    } else {
      scene.dialogue_act = s.sceneDialogueAct;
    }
  }

  // Drop the request if the queue is already saturated — runaway models
  // shouldn't burn API spend on backlog. Tell the user via the status banner.
  if (queue.depth() >= MAX_QUEUE_DEPTH) {
    setTransientStatus(
      `Queue full (${queue.depth()}). Hit Stop or wait.`,
      "err",
    );
    lastSpokenByMessageId.delete(messageId);
    return;
  }

  logRequest({
    persona: s.persona,
    scene: Object.keys(scene).length ? scene : null,
    voice: s.voice,
    inputLength: clean.length,
  });

  try {
    const result = await requestVoicedAudio({
      baseUrl: s.baseUrl,
      apiKey: s.apiKey,
      persona: s.persona,
      ...(Object.keys(scene).length ? { scene } : {}),
      ...(s.voice ? { voice: s.voice } : {}),
      input: clean,
    });
    logResponse({
      status: 200,
      ms: result.ms,
      audioBytes: result.blob.size,
      headers: result.headers,
    });
    const label = s.persona.split("/")[1] ?? s.persona;
    queue.enqueue(result.blob, label);
  } catch (err) {
    // Failures must never block ST's chat — log + transient banner only.
    console.warn("[maia-voice] generate failed:", err);
    setTransientStatus(`Voiced failed: ${err?.message ?? err}`, "err");
    // Don't keep the dedup mark if the call failed — user may want to retry
    // via swipe/edit.
    lastSpokenByMessageId.delete(messageId);
  }
}

async function loadSettingsHtml() {
  // Use the runtime-derived path so renaming the install dir doesn't break
  // template lookup. Second arg is the template id (no .html extension).
  return renderExtensionTemplateAsync(EXT_PATH, "settings");
}

async function init() {
  const s = settings();
  bindDebugSettings(s);

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

  // Wire the chat-pipeline hook. ST fires CHARACTER_MESSAGE_RENDERED after
  // the assistant message has fully rendered; we use the message id (an
  // integer index into chat[]) to dedup re-renders (swipes, edits).
  if (eventSource && event_types?.CHARACTER_MESSAGE_RENDERED) {
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onCharacterMessageRendered);
  } else {
    console.warn("[maia-voice] CHARACTER_MESSAGE_RENDERED not exposed; chat hook disabled");
  }

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
