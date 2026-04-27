# himaia voice — SillyTavern extension

> Give your characters a voice that stays in character.

A SillyTavern third-party extension that connects to the himaia voice API. You
pick a persona (with a point of view, an idiolect, a scene-aware delivery)
and himaia turns chat replies into in-character spoken audio.

## Status

`v0.1.0` — first public release. See [`CHANGELOG.md`](./CHANGELOG.md).
Treat as alpha; please file the bugs you find.

## Install

```bash
cd /path/to/SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/fuselinkapp/himaia-silly-tavern.git himaia-voice
```

Restart SillyTavern, open **Extensions → himaia voice**, paste an API key
(grab one from the [dashboard](https://himaia.dev/dashboard/keys)), pick a
persona, hit **Test connection**.

## How it works

The extension is a thin client of the himaia voice HTTP API:

- `GET /v1/personas` — returns the 8 starter personas (Apache-2.0,
  forkable; see the [voice.persona spec](https://himaia.dev/docs)).
- `POST /v1/generate` (bet1.8) — sends a chat reply with `mode: "voiced"`,
  receives WAV audio, plays it inline.

Your API key never leaves your browser. The extension talks directly to
the himaia API; SillyTavern's server proxies nothing.

## Settings

| Field | What it does |
|---|---|
| **Base URL** | `https://api.himaia.dev` by default. Point at your own deployment if you self-host. |
| **API key** | Bearer token. Stored in SillyTavern's extension settings (browser-local). |
| **Persona** | One of the 8 starters: warm_confidant, skeptical_buyer, sarcastic_narrator, anxious_npc, measured_diplomat, tender_parent, dry_butler, manic_sports_caster. |
| **Scene · format** | `comfort`, `challenge`, `banter`, `celebrate` — depends on the persona. Falls back to the persona's default. |
| **Scene · dialogue act** | `reassure`, `push_back`, `tease`, `witness`, `celebrate` — depends on the persona. |
| **Voice** | Optional override. Leave blank to let the persona pick. |

## Reporting issues

Please file bugs at
[github.com/fuselinkapp/himaia-silly-tavern/issues](https://github.com/fuselinkapp/himaia-silly-tavern/issues).
Include your SillyTavern version, the persona you picked, and (if debug
logging was on) the relevant `[himaia]` console output. Message content
is never auto-included; redact what you don't want public.

## License

Apache-2.0. See `LICENSE`. Made by [himaia](https://himaia.dev) · © Fuse Link Inc..
The `voice.persona` spec the personas are written in is also
Apache-2.0 and lives at
[github.com/fuselinkapp/himaia-voice-persona](https://github.com/fuselinkapp/himaia-voice-persona).
