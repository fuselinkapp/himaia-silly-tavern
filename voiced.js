// SPDX-License-Identifier: Apache-2.0
// Voiced-tier client + audio queue for the Maia ST extension (bet1.8).
//
// Three responsibilities, kept tiny:
//   1. requestVoicedAudio  — fetch /v1/generate {mode: "voiced"} → audio Blob
//   2. PlaybackQueue       — single <audio>, FIFO blob queue, blob-URL cleanup
//   3. sanitizeForSpeech   — strip ST formatting that shouldn't be read aloud
//
// Streaming TTS is deferred to a follow-up phase (the API doesn't stream
// audio yet). The fetch signature accepts an `onChunk` callback that exists
// purely as a seam — it's never invoked today, but consumers already program
// against the streaming-friendly interface.

/**
 * @typedef RequestVoicedArgs
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} persona             "maia/<slug>" (with optional @version)
 * @property {{format?: string, dialogue_act?: string}} [scene]
 * @property {string} [voice]
 * @property {string} input
 * @property {(chunk: Uint8Array) => void} [onChunk]   reserved for streaming
 */

/**
 * @param {RequestVoicedArgs} args
 * @returns {Promise<Blob>}
 */
export async function requestVoicedAudio(args) {
  const { baseUrl, apiKey, persona, scene, voice, input } = args;
  if (!apiKey) throw new Error("api key not configured");
  if (!persona) throw new Error("no persona selected");
  if (!input?.trim()) throw new Error("empty input");

  const base = (baseUrl || "https://api.maia.sh").replace(/\/$/, "");
  const body = {
    mode: "voiced",
    persona,
    input,
  };
  if (scene && (scene.format || scene.dialogue_act)) body.scene = scene;
  if (voice) body.voice = voice;

  const res = await fetch(`${base}/v1/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const txt = await res.text();
      detail = txt.slice(0, 200);
    } catch {
      // ignore — leave detail empty
    }
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  // Future: when /v1/generate supports a streaming content-type we'll iterate
  // res.body's reader here and pipe chunks to args.onChunk. Today the response
  // is a single audio/wav blob.
  return await res.blob();
}

// ---------- Playback queue ----------

export class PlaybackQueue {
  constructor() {
    /** @type {{blob: Blob, label: string, url: string}[]} */
    this._items = [];
    this._audio = null;
    this._listeners = new Set();
  }

  /** Returns a label for whatever's playing now, or null. */
  current() {
    return this._audio?.dataset?.label ?? null;
  }

  /** Subscribe to "now playing" changes. Returns an unsubscribe fn. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  enqueue(blob, label) {
    const url = URL.createObjectURL(blob);
    this._items.push({ blob, label, url });
    this._kick();
  }

  stop() {
    if (this._audio) {
      this._audio.pause();
      this._cleanup();
    }
    // Drop the rest of the queue too — Stop means stop everything.
    for (const item of this._items) URL.revokeObjectURL(item.url);
    this._items.length = 0;
    this._notify();
  }

  _kick() {
    if (this._audio) return; // already playing
    const next = this._items.shift();
    if (!next) {
      this._notify();
      return;
    }
    const audio = document.createElement("audio");
    audio.src = next.url;
    audio.dataset.label = next.label;
    audio.style.display = "none";
    // {once: true} so neither `ended` nor `error` can fire twice for the same
    // element. The `play().catch` path also routes through `_cleanup`, which
    // is now idempotent (see below) — so duplicate triggers are safe.
    audio.addEventListener("ended", () => this._cleanup(audio), { once: true });
    audio.addEventListener("error", () => this._cleanup(audio), { once: true });
    document.body.appendChild(audio);
    this._audio = audio;
    this._notify();
    audio.play().catch((err) => {
      console.warn("[maia-voice] audio play failed:", err);
      this._cleanup(audio);
    });
  }

  // Idempotent. Optional `expected` arg lets a late-firing listener verify it's
  // cleaning up its own element rather than the queue's *next* one — prevents
  // the race where one element's error fires after the queue has moved on.
  _cleanup(expected) {
    if (!this._audio) return;
    if (expected && this._audio !== expected) return;
    const url = this._audio.src;
    this._audio.remove();
    this._audio = null;
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore — already revoked
    }
    this._kick();
  }

  _notify() {
    for (const fn of this._listeners) {
      try {
        fn(this.current());
      } catch (err) {
        console.warn("[maia-voice] queue listener threw:", err);
      }
    }
  }
}

// ---------- Sanitizer ----------

/**
 * Strip the things SillyTavern adds that shouldn't be read aloud:
 *  - triple-backtick code fences (entire block)
 *  - `*emphasis*` and `_emphasis_` markers (keep the words)
 *  - HTML tags (drop)
 *  - Markdown links `[text](url)` → `text`
 *
 * Preserve:
 *  - newlines (natural pauses)
 *  - bracketed delivery tags like `[short pause]`, `[warm]` — those are TTS
 *    instructions for the Voiced tier prompt, not noise.
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeForSpeech(text) {
  if (typeof text !== "string") return "";
  let out = text;
  // Code fences (multi-line, lazy match).
  out = out.replace(/```[\s\S]*?```/g, " ");
  // Inline code.
  out = out.replace(/`[^`\n]+`/g, " ");
  // HTML tags.
  out = out.replace(/<[^>]+>/g, "");
  // Markdown links: keep the link text only.
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // **bold** / __bold__ first — must run before the single-marker pass
  // because the single-marker regex requires no `*`/`_` inside the run.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  out = out.replace(/__([^_\n]+)__/g, "$1");
  // *emphasis* and _emphasis_ markers — drop the markers, keep the words.
  // Avoid eating lone underscores in identifiers by requiring word boundaries.
  out = out.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,!?;:])/g, "$1$2");
  out = out.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?;:])/g, "$1$2");
  // Collapse runs of 3+ blank lines but otherwise preserve newlines.
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}
