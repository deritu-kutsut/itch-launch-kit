# Itch Launch Kit

**Sell and update your game on itch.io from the terminal — or let your AI agent do it.**
One command tells you exactly what is missing to sell, checks your store page, uploads your builds with butler
and shows your sales. It speaks to humans (short, clear output) and to AI agents (MCP server, skill, JSON).

Born inside the tooling of *Modular*, an indie MMORPG, where Claude, Codex and other agents ship builds every day.

- Zero dependencies: only Node.js 18.17 or newer.
- Windows, macOS and Linux. Unity and Godot are detected automatically; anything with a build folder works.
- English and Spanish (`--lang en|es`, or automatic from your system).

## 60-second start
```bash
cd my-game
node /path/to/itch-launch-kit/bin/itchkit.mjs init     # writes itch.json from your project and build folders
node /path/to/itch-launch-kit/bin/itchkit.mjs           # = status: the numbered steps to sell
```
Tip: `npm link` inside the kit folder gives you the short `itchkit` command everywhere.

`itchkit` prints at most 15 lines; the last one is always the verdict:
```
Sell "Star Courier" on itch.io: 6 of 10 steps ready
Next: itchkit push --channel all  (dry run; add --confirm to upload)
✔ 1. butler 15.32.0
✔ 2. API key (ITCH_API_KEY)
✔ 3. user stellar-dev
✔ 4. page https://stellar-dev.itch.io/star-courier
✔ 5. 2 of 2 local builds
✔ 6. store page content complete
✘ 7. nothing uploaded yet → itchkit push --channel all  (dry run; add --confirm to upload)
✋ 8. set the price (paid) in the dashboard → in https://itch.io/game/edit/123 → Pricing
✋ 9. payouts and tax interview (PayPal/Stripe) → done by you in https://itch.io/user/settings → Payouts
✘ 10. draft → in https://itch.io/game/edit/123 → Visibility & access → Public
VERDICT: PARTIAL 6/10 steps to sell
```
✔ done · ✘ to do (the kit or your agent can fix it) · ✋ manual step for you on itch.io · ? could not check (no key or network)

## Actions
| Command | What it does | Touches the internet? |
|---|---|---|
| `itchkit status` | the 10 steps to sell, with a "Next:" line | reads only |
| `itchkit page` | title, tagline (≤120), tags (≤10), description, cover (630×500), screenshots (≥3), price | no |
| `itchkit push --channel windows` | butler **dry run**: sizes, skipped folders, `.itch.toml` | no |
| `itchkit push --channel all --confirm` | real upload of every channel with your game version | **yes** |
| `itchkit remote` | published or draft, price, platforms, views, downloads, purchases, earnings, channels | reads only |
| `itchkit init` | starter `itch.json` (never overwrites) | no |
| `itchkit install-butler` | downloads the official butler into `~/.itchkit/butler` | downloads |
| `itchkit mcp` | MCP server for AI agents (stdio) | — |

Options: `--channel name|a,b|all`, `--confirm`, `--version 1.2.0`, `--user name`, `--config file`, `--lang en|es`, `--json`.

## The API key
Create one at https://itch.io/user/settings/api-keys and use **one** of these:
- environment variable `ITCH_API_KEY`
- a line `ITCH_API_KEY=...` in `~/.itchkit/env`
- `butler login` (the kit reads butler's saved login)

The key is never printed, never written to `itch.json` (the kit refuses a config that contains one) and is passed to butler
through the environment, not the command line.

## itch.json
See `examples/itch.json`. Fields:
- `user` (empty = detected from the key), `game` = your project slug (`user.itch.io/<game>`).
- `version` or `versionFrom` (default: Unity `bundleVersion`, Godot `config/version` or `package.json`).
- `channels`: name → `path` (folder or file), `exe` (writes `.itch.toml` so the itch app launches it), `ignore` (globs never uploaded).
  The channel name tells itch the platform: include `windows`, `linux`, `osx`, `android` or use `html5`.
- `page`: `title`, `tagline`, `description` (.md file), `genre`, `tags`, `cover`, `screenshots` (folder), `price.mode`
  (`free | donate | paid | pwyw`) and `price.usd`.

Unity builds: `*_BurstDebugInformation_DoNotShip` and `*_BackUpThisFolder_ButDontShipItWithYourGame` are ignored by default.

## With an AI agent
- **Claude Code**: copy `skills/itch-launch-kit` to `.claude/skills/` and register the MCP server:
  `claude mcp add itch-launch-kit -- node /path/to/itch-launch-kit/bin/itchkit.mjs mcp`
- **Codex, Cursor, Windsurf, Gemini CLI and any MCP client**: add a stdio server with command `node` and args
  `["/path/to/itch-launch-kit/bin/itchkit.mjs", "mcp"]`. Examples in `examples/mcp/`.
- **Agents without MCP**: point them to `AGENTS.md`; they run the CLI and read the `VERDICT:` line or `--json`.

Tools: `itch_status` (start here), `itch_page`, `itch_push` (dry run unless `confirm: true`), `itch_remote`, `itch_init`.

### Safety rules built in
1. A real upload needs `--confirm` / `confirm: true`; the skill tells agents to ask you first.
2. Price, payouts, taxes and visibility have no API on itch: the kit only checks them and gives you the exact link.
   No agent should ever type bank, tax or password data.
3. One push at a time (lock file), so two agents never upload over each other.

## Troubleshooting
| Message | Fix |
|---|---|
| `butler not found` | `itchkit install-butler`, or install the itch app, or set `BUTLER_PATH` |
| `itch rejected the API key` | create a new key; old keys can be revoked |
| `no project "x" in your account` | create it at https://itch.io/game/new with URL `x`, or fix `game` |
| channel shows no version | itch is still processing the build; run `itchkit remote` again in a few minutes |

Run the tests with `npm test` (no network needed).

License: MIT (see `LICENSE.txt`). Made by Dalytria Studio.
