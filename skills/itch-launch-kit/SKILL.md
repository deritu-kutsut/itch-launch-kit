---
name: itch-launch-kit
description: Use when the user wants to sell, publish or update a game on itch.io - checking what is missing to sell, reviewing the store page, uploading builds with butler, or reading downloads and sales. Works through the itch-launch-kit MCP tools or the itchkit CLI.
---

# Sell on itch.io with Itch Launch Kit

## Start here
Call the MCP tool `itch_status` (or run `itchkit status` in the game folder). Follow its `Next:` line, then call it again.
Symbols: ✔ done · ✘ you can fix it · ✋ manual step for the human on itch.io · ? not checked (missing key or network).

## Tools
| MCP tool | CLI | Use |
|---|---|---|
| `itch_status` | `itchkit status` | steps to sell and the next action |
| `itch_page` | `itchkit page` | store page checks: title, tagline ≤120, tags ≤10, description, cover 630×500, ≥3 screenshots, price |
| `itch_push` | `itchkit push --channel <x\|all>` | dry run by default; `confirm: true` / `--confirm` uploads for real |
| `itch_remote` | `itchkit remote` | price, downloads, purchases, earnings, channels |
| `itch_init` | `itchkit init` | starter `itch.json` |

## Rules
1. Before `confirm: true`, ask the user in chat and say which channels and which version. Without it, only dry runs.
2. Price, payouts, taxes and visibility are manual (✋): give the user the link; never type bank, tax or password data.
3. Never print or store the API key. It belongs in `ITCH_API_KEY`, `~/.itchkit/env` or `butler login`.
4. If butler is missing, run `itchkit install-butler`.

## Writing the store page
- Tagline: one line, no title repeated, ≤120 characters.
- Tags: lowercase, ≤10, no genre or platform (itch has separate fields for those).
- Description: a hook in two sentences, what the player does (list), platforms, status (early access?), credits.
- Cover 630×500 PNG; 3 to 5 screenshots of real gameplay, at least 640 px wide.

Full details: `AGENTS.md` and `README.md` in the kit folder.
