# Registering the MCP server

Replace `/path/to/itch-launch-kit` with the real folder. On Windows use forward slashes or double backslashes.

## Claude Code
```bash
claude mcp add itch-launch-kit -- node /path/to/itch-launch-kit/bin/itchkit.mjs mcp
```
or put this in `.mcp.json` at the root of your game project:
```json
{ "mcpServers": { "itch-launch-kit": { "command": "node", "args": ["/path/to/itch-launch-kit/bin/itchkit.mjs", "mcp"] } } }
```
Also copy `skills/itch-launch-kit` into `.claude/skills/`.

## Codex CLI (`~/.codex/config.toml`)
```toml
[mcp_servers.itch-launch-kit]
command = "node"
args = ["/path/to/itch-launch-kit/bin/itchkit.mjs", "mcp"]
```
Also copy `skills/itch-launch-kit` into `.agents/skills/` of your project.

## Cursor (`.cursor/mcp.json`), Windsurf, Gemini CLI and other clients
```json
{ "mcpServers": { "itch-launch-kit": { "command": "node", "args": ["/path/to/itch-launch-kit/bin/itchkit.mjs", "mcp"] } } }
```

The server works in the folder the client starts it in. If your game is elsewhere, pass `config` with the path to its `itch.json`.
