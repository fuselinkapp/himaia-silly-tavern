# Maia Voice — SillyTavern extension

> Give your characters a voice that stays in character.

A SillyTavern third-party extension that connects to the Maia Voice API. You
pick a persona (with a point of view, an idiolect, a scene-aware delivery)
and Maia turns chat replies into in-character spoken audio.

## Status

**bet1.7** — settings panel only. Pick a persona and a scene, save your API
key. Chat-pipeline integration arrives in **bet1.8**.

## Install (manual)

Until the extension lands in SillyTavern's registry (bet1.10):

```bash
cd /path/to/SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/maia-voice/silly-tavern.git maia-voice
```

Restart SillyTavern, open **Extensions → Maia Voice**, paste an API key
(grab one from the [dashboard](https://maia.sh/dashboard/keys)), pick a
persona, hit **Test connection**.

## How it works

The extension is a thin client of the Maia Voice HTTP API:

- `GET /v1/personas` — returns the 8 starter personas (Apache-2.0,
  forkable; see the [voice.persona spec](https://maia.sh/docs)).
- `POST /v1/generate` (bet1.8) — sends a chat reply with `mode: "voiced"`,
  receives WAV audio, plays it inline.

Your API key never leaves your browser. The extension talks directly to
the Maia API; SillyTavern's server proxies nothing.

## Settings

| Field | What it does |
|---|---|
| **Base URL** | `https://api.maia.sh` by default. Point at your own deployment if you self-host. |
| **API key** | Bearer token. Stored in SillyTavern's extension settings (browser-local). |
| **Persona** | One of the 8 starters: warm_confidant, skeptical_buyer, sarcastic_narrator, anxious_npc, measured_diplomat, tender_parent, dry_butler, manic_sports_caster. |
| **Scene · format** | `comfort`, `challenge`, `banter`, `celebrate` — depends on the persona. Falls back to the persona's default. |
| **Scene · dialogue act** | `reassure`, `push_back`, `tease`, `witness`, `celebrate` — depends on the persona. |
| **Voice** | Optional override. Leave blank to let the persona pick. |

## License

Apache-2.0. See `LICENSE`.

## Source

This extension is developed in the [maia-voice-coach
monorepo](https://github.com/oezguercelebi/maia-voice-coach) under
`apps/silly-tavern/`. It will be extracted to a standalone repo at
publish time (bet1.10).
