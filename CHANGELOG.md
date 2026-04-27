# Changelog

## 0.1.0 — alpha (initial release)

First public release. Built across bet1.7–1.9 of the himaia Bet 1 plan.
Treat as alpha: a power-user community will find bugs the author didn't.

**Settings panel.** API key (with show/hide), base URL, persona dropdown
populated from `GET /v1/personas`, scene format + dialogue act dropdowns
keyed off the picked persona, voice override, master enable toggle,
"Test connection" button.

**Chat hook.** Hooks `CHARACTER_MESSAGE_RENDERED`, sanitizes assistant
replies (`**bold**`, `*action*`, code fences, HTML, link URLs), posts
to `/v1/generate` with `mode: "voiced"`, plays the returned WAV through
a single hidden audio element fed by a FIFO blob queue. Stop button
drops the queue; "now playing" pill shows the persona that's speaking.

**Hardening.** Skip <2-char cleaned messages, truncate >5000 chars rather
than reject, cap queue depth at 3 (with a "Queue full" banner above
that), runtime scene-compatibility backstop that drops a stale stored
format/dialogue_act when the picked persona doesn't define it.

**Debug logger.** Three switches (settings checkbox, `window.HIMAIA_DEV`,
`localStorage.HIMAIA_DEV`). Length-only, never logs message content. The
response-header allow-list explicitly excludes `x-himaia-script` and
`x-himaia-thoughts-*` so a screenshare doesn't leak chat content.

**Privacy.** API key lives in SillyTavern's `extension_settings` (browser-
local). Audio data is never persisted by the extension. Calls go
directly from the user's browser to the himaia API; SillyTavern's server
proxies nothing.

### Known gaps

- Streaming TTS not yet supported (the API returns full WAV today; the
  fetch wrapper has an unused `onChunk` seam for when streaming lands).
- Per-character persona binding (different ST character → different himaia
  persona) is not yet implemented; one global persona for now.
- 8-voice short list in the picker; the full himaia voice catalog will be
  exposed when `/v1/voices` ships.
