// SPDX-License-Identifier: Apache-2.0
// Debug logger for the himaia ST extension. Three switches because power users
// reach for whichever they remember:
//   - extension_settings.himaia.debug (settings checkbox)
//   - window.HIMAIA_DEV === true            (paste-into-console)
//   - localStorage.HIMAIA_DEV === "1"       (survives reload)
//
// Logs are intentionally length-only — no message payload — so a screenshare
// of DevTools doesn't leak chat content.

let _settingsRef = null;

export function bindSettings(s) {
  _settingsRef = s;
}

export function isDebug() {
  if (_settingsRef?.debug) return true;
  try {
    if (typeof window !== "undefined" && window.HIMAIA_DEV === true) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("HIMAIA_DEV") === "1") {
      return true;
    }
  } catch {
    // ignore — Storage / window unavailable in some sandboxes
  }
  return false;
}

function group(label, fn) {
  if (!isDebug()) return;
  console.groupCollapsed(`[himaia] ${label}`);
  try {
    fn();
  } finally {
    console.groupEnd();
  }
}

export function logRequest({ persona, scene, voice, inputLength }) {
  group(`request → ${persona}`, () => {
    console.log("persona:", persona);
    console.log("scene:", scene ?? "(persona default)");
    console.log("voice:", voice || "(persona default)");
    console.log("input length:", inputLength);
  });
}

export function logResponse({ status, ms, audioBytes, headers }) {
  group(`response ← ${status} · ${ms}ms · ${audioBytes}B`, () => {
    console.log("status:", status);
    console.log("ms:", ms);
    console.log("audioBytes:", audioBytes);
    if (headers) {
      // ALLOW-LIST. Deliberately excludes x-himaia-script (contains generated
      // user-adjacent content) and x-himaia-thoughts-* (model reasoning).
      // Add new headers here only after confirming they don't carry payload.
      const interesting = {};
      for (const k of [
        "x-himaia-call-id",
        "x-himaia-persona",
        "x-himaia-scene-format",
        "x-himaia-scene-dialogue-act",
        "x-himaia-fidelity",
        "x-himaia-seconds",
        "x-himaia-charge-cents",
      ]) {
        const v = headers.get?.(k) ?? headers[k];
        if (v != null) interesting[k] = v;
      }
      console.log("headers:", interesting);
    }
  });
}

export function logQueue({ depth, currentLabel }) {
  if (!isDebug()) return;
  console.log(`[himaia] queue · depth=${depth} · now=${currentLabel ?? "(idle)"}`);
}

export function logSceneIncompatibility({ persona, requested, allowed }) {
  group(`scene-incompat dropped`, () => {
    console.log("persona:", persona);
    console.log("requested:", requested);
    console.log("allowed:", allowed);
  });
}
