# Instructions for AI agents — Itch Launch Kit

You can sell and update the user's game on itch.io with this kit. Read this whole file before acting.

## Always start with the status
Run `node <kit>/bin/itchkit.mjs status` (or MCP tool `itch_status`) in the game folder.
It returns numbered steps and a `Next:` line. Do what `Next:` says, then run status again. Never guess the state.
The last line is `VERDICT: OK | PARTIAL | FAIL <reason>`; add `--json` for structured data.

| Symbol | Meaning | Who acts |
|---|---|---|
| ✔ | done | nobody |
| ✘ | to do; fixable in files or with the kit | you |
| ✋ | manual step on itch.io (price, payouts, taxes) | the human |
| ? | could not check (no key or no network) | the human sets the key |

## Rules
1. `push` without `--confirm` is a dry run. **Ask the human in chat before `--confirm`**, naming channels and version. Uploading publishes outside the computer.
2. Never type prices, bank, tax or password data into itch.io for the human; give them the link the kit prints.
3. Never print, copy or commit the API key. It lives in `ITCH_API_KEY`, `~/.itchkit/env` or butler's login. If `itch.json` contains a key, the kit refuses to run: remove it.
4. Edit only `itch.json`, the description `.md` and the image files of the store page. Do not touch build folders except through `push` (it writes `.itch.toml`).
5. Pushing again is safe: butler only sends what changed.

## Typical flow
1. `itchkit init` if there is no `itch.json`; then fill `user`, `game` and `page`.
2. `itchkit page` until it says the store page is complete (you can draft the description and pick tags).
3. `itchkit push --channel all` (dry run) → read sizes and skipped folders → ask → `--confirm`.
4. The human sets price, payouts and visibility on itch.io.
5. `itchkit remote` to report downloads and sales.

## Errors and what to do
| Output | Do this |
|---|---|
| `butler not found` | `itchkit install-butler` (downloads the official butler) |
| `no itch.json here` | `itchkit init` |
| `no itch.io API key` | ask the human to create one at https://itch.io/user/settings/api-keys |
| `itch rejected the API key` | ask the human for a new key |
| `no project "x" in your account` | the human creates the page at https://itch.io/game/new with URL `x` |
| `{path} does not exist; build it first` | build the game (engine-specific) or fix `channels.*.path` |
