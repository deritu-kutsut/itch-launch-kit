// Itch Launch Kit command line. «itchkit mcp» starts the MCP server for AI agents.
import { runAction, ACTIONS, ALIASES } from './commands.mjs';
import { UsageError, toText, toJson, exitCode } from './core.mjs';
import { pickLang, translator } from './i18n.mjs';

const HELP = {
  en: `Itch Launch Kit — sell and update your game on itch.io from the terminal or from any AI agent.

Usage: itchkit [action] [options]
  status          what is missing to sell, step by step (default)
  page            check the store page: title, tagline, tags, description, cover, screenshots, price
  push            butler push per channel; DRY RUN unless --confirm
  remote          what is on itch: channels, price, views, downloads, purchases, earnings
  init            write a starter itch.json (detects Unity, Godot and build folders)
  install-butler  download the official butler into ~/.itchkit/butler
  mcp             start the MCP server (stdio) for Claude, Codex and other agents

Options:
  --channel <name|a,b|all>  channels to push      --confirm       really upload (push)
  --version <x.y.z>         version shown on itch --user <name>   itch user
  --config <file>           config (itch.json)    --lang en|es    language
  --json                    one-line JSON result  --help

The API key is read from ITCH_API_KEY, ~/.itchkit/env or "butler login". It is never printed.`,
  es: `Itch Launch Kit — vende y actualiza tu juego en itch.io desde la consola o desde cualquier IA.

Uso: itchkit [acción] [opciones]   (también: estado, ficha, subir, remoto, iniciar, instalar-butler)
  status          qué falta para vender, paso a paso (por defecto)
  page            revisa la ficha: título, lema, etiquetas, descripción, portada, capturas y precio
  push            butler push por canal; SIMULA salvo --confirm
  remote          lo que hay en itch: canales, precio, vistas, descargas, compras y ganancias
  init            crea un itch.json inicial (detecta Unity, Godot y carpetas de build)
  install-butler  descarga el butler oficial en ~/.itchkit/butler
  mcp             arranca el servidor MCP (stdio) para Claude, Codex y otros agentes

Opciones:
  --channel <nombre|a,b|all>  canales a subir      --confirm       sube de verdad (push)
  --version <x.y.z>           versión en itch      --user <nombre> usuario de itch
  --config <archivo>          configuración        --lang en|es    idioma
  --json                      resultado JSON       --help

La clave se lee de ITCH_API_KEY, ~/.itchkit/env o «butler login». Nunca se imprime.`,
};

/** Parses argv into { action, channel, version, confirm, user, config, lang, json, help }. */
export function parseArgs(argv) {
  const out = { _: [] };
  const flags = new Set(['confirm', 'json', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    if (flags.has(k)) { out[k] = inline === undefined ? true : inline !== 'false'; continue; }
    const v = inline ?? argv[++i];
    if (v === undefined) throw new UsageError(`--${k} needs a value`);
    out[k] = v;
  }
  out.action = out._[0];
  return out;
}

export async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const lang = pickLang(args.lang);
  const t = translator(lang);
  if (args.action === 'mcp') { (await import('./mcp.mjs')).serve(); return; }
  if (args.help || args.action === 'help') { console.log(HELP[lang]); return; }
  try {
    const result = await runAction({ ...args, lang }, { t });
    console.log(args.json ? toJson(result) : toText(result, t));
    process.exitCode = exitCode(result);
  } catch (e) {
    if (e instanceof UsageError) { console.error(`${e.message}\n${t('usageAction', { list: [...ACTIONS, ...Object.keys(ALIASES)].join(', ') })}`); process.exitCode = 2; return; }
    console.error(e.stack || e.message);
    process.exitCode = 1;
  }
}

