// MCP server (stdio, JSON-RPC 2.0, one message per line) so Claude, Codex, Cursor and other agents can use Itch Launch Kit as tools.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { runAction } from './commands.mjs';
import { toText } from './core.mjs';
import { pickLang, translator } from './i18n.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const COMMON = {
  config: { type: 'string', description: 'Path to itch.json (default: itch.json in the working directory)' },
  lang: { type: 'string', enum: ['en', 'es'], description: 'Language of the answer' },
};

export const TOOLS = [
  {
    name: 'itch_status', action: 'status',
    description: 'START HERE. Numbered steps to sell the game on itch.io with ✔ done, ✘ to do (you can fix it), ✋ manual for the human (price, payouts, taxes) and ? unknown, plus a "Next:" line. Read-only.',
    inputSchema: { type: 'object', properties: { ...COMMON } },
  },
  {
    name: 'itch_page', action: 'page',
    description: 'Checks the store page content from itch.json: title, tagline (≤120), tags (≤10), description file, cover (630×500), screenshots (≥3) and price mode. Read-only.',
    inputSchema: { type: 'object', properties: { ...COMMON } },
  },
  {
    name: 'itch_push', action: 'push',
    description: 'Uploads builds with butler. Without confirm=true it is a DRY RUN (nothing leaves the computer). confirm=true publishes to itch.io: ask the human first and say which channels and version.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name from itch.json, several separated by commas, or "all"' },
        confirm: { type: 'boolean', description: 'true = real upload (outward-facing). Default false = dry run' },
        version: { type: 'string', description: 'Version shown on itch (default: detected from Unity, Godot or package.json)' },
        user: { type: 'string', description: 'itch.io user (default: from itch.json or the API key)' },
        ...COMMON,
      },
      required: ['channel'],
    },
  },
  {
    name: 'itch_remote', action: 'remote',
    description: 'What is on itch.io now: published or draft, minimum price, platforms, views, downloads, purchases, earnings and uploaded channels. Read-only.',
    inputSchema: { type: 'object', properties: { ...COMMON } },
  },
  {
    name: 'itch_init', action: 'init',
    description: 'Writes a starter itch.json in the working directory (detects Unity, Godot and build folders). Never overwrites an existing file.',
    inputSchema: { type: 'object', properties: { ...COMMON } },
  },
];

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

/** Handles one JSON-RPC request. Exported for tests (deps are passed to runAction). */
export async function handle(msg, deps = {}) {
  const { id, method, params = {} } = msg;
  if (method === 'initialize') {
    return { id, result: { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'itch-launch-kit', version: VERSION } } };
  }
  if (method === 'tools/list') return { id, result: { tools: TOOLS.map(({ action, ...tool }) => tool) } };
  if (method === 'tools/call') {
    const tool = TOOLS.find(x => x.name === params.name);
    if (!tool) return { id, error: { code: -32602, message: `unknown tool ${params.name}` } };
    const args = { ...(params.arguments ?? {}), action: tool.action };
    const lang = pickLang(args.lang, deps.env);
    const t = translator(lang);
    try {
      const r = await runAction({ ...args, lang }, { ...deps, t });
      return { id, result: { content: [{ type: 'text', text: toText(r, t) }], structuredContent: r, isError: r.verdict === 'FAIL' } };
    } catch (e) {
      return { id, result: { content: [{ type: 'text', text: e.message }], isError: true } };
    }
  }
  if (method === 'ping') return { id, result: {} };
  if (id === undefined) return null; // notification
  return { id, error: { code: -32601, message: `method not found: ${method}` } };
}

export function serve() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async line => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return error(null, -32700, 'parse error'); }
    const out = await handle(msg);
    if (out && out.id !== undefined) (out.error ? error(out.id, out.error.code, out.error.message) : reply(out.id, out.result));
  });
}
