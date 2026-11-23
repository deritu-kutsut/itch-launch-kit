# Itch Launch Kit (en español)

**Vende y actualiza tu juego en itch.io desde la consola, o deja que tu IA lo haga.**
Un comando te dice exactamente qué falta para vender, revisa la ficha de la tienda, sube las builds con butler
y te muestra las ventas. Habla con personas (salida corta y clara) y con IAs (servidor MCP, skill y JSON).

Nació dentro de las herramientas de *Modular*, un MMORPG independiente donde Claude, Codex y otras IAs publican builds a diario.

- Sin dependencias: solo Node.js 18.17 o más nuevo.
- Windows, macOS y Linux. Detecta Unity y Godot; sirve para cualquier juego con carpeta de build.
- Español e inglés (`--lang es|en`, o automático según el sistema). Todos los comandos aceptan nombres en español.

## Empezar en un minuto
```bash
cd mi-juego
node /ruta/a/itch-launch-kit/bin/itchkit.mjs iniciar   # crea itch.json a partir del proyecto y sus builds
node /ruta/a/itch-launch-kit/bin/itchkit.mjs           # = estado: los pasos numerados para vender
```
Consejo: `npm link` dentro de la carpeta del kit te deja el comando corto `itchkit` en todas partes.

La salida tiene como mucho 15 líneas y la última siempre es el veredicto.
✔ listo · ✘ falta (lo arregla el kit o tu IA) · ✋ paso manual tuyo en itch.io · ? no se pudo comprobar (sin clave o sin red)

## Acciones
| Comando | Qué hace | ¿Sale a internet? |
|---|---|---|
| `itchkit estado` | los 10 pasos para vender y la línea «Siguiente:» | solo lee |
| `itchkit ficha` | título, lema (≤120), etiquetas (≤10), descripción, portada (630×500), capturas (≥3) y precio | no |
| `itchkit subir --channel windows` | **simulación** de butler: tamaños, carpetas excluidas, `.itch.toml` | no |
| `itchkit subir --channel all --confirm` | subida real de todos los canales con la versión del juego | **sí** |
| `itchkit remoto` | publicado o borrador, precio, plataformas, vistas, descargas, compras, ganancias y canales | solo lee |
| `itchkit iniciar` | crea `itch.json` (nunca sobrescribe) | no |
| `itchkit instalar-butler` | descarga el butler oficial en `~/.itchkit/butler` | descarga |
| `itchkit mcp` | servidor MCP para IAs (stdio) | — |

Opciones: `--channel nombre|a,b|all`, `--confirm`, `--version 1.2.0`, `--user nombre`, `--config archivo`, `--lang es|en`, `--json`.

## La clave de API
Créala en https://itch.io/user/settings/api-keys y usa **una** de estas formas:
- variable de entorno `ITCH_API_KEY`
- una línea `ITCH_API_KEY=...` en `~/.itchkit/env`
- `butler login` (el kit lee la sesión guardada de butler)

La clave nunca se imprime ni se guarda en `itch.json` (el kit rechaza una configuración que la tenga) y a butler se le pasa
por el entorno, no por la línea de comandos.

## itch.json
Mira `examples/itch.json`. Campos: `user`, `game` (la URL corta: `usuario.itch.io/<game>`), `version` o `versionFrom`,
`channels` (nombre → `path`, `exe`, `ignore`) y `page` (`title`, `tagline`, `description`, `genre`, `tags`, `cover`,
`screenshots`, `price.mode` = `free | donate | paid | pwyw` y `price.usd`).
El nombre del canal le dice a itch la plataforma: incluye `windows`, `linux`, `osx`, `android` o usa `html5`.

## Con una IA
- **Claude Code**: copia `skills/itch-launch-kit` a `.claude/skills/` y registra el servidor MCP:
  `claude mcp add itch-launch-kit -- node /ruta/a/itch-launch-kit/bin/itchkit.mjs mcp`
- **Codex, Cursor, Windsurf, Gemini CLI y cualquier cliente MCP**: servidor stdio con comando `node` y argumentos
  `["/ruta/a/itch-launch-kit/bin/itchkit.mjs", "mcp"]`. Ejemplos en `examples/mcp/`.
- **IAs sin MCP**: apúntalas a `AGENTS.md`; usan la consola y leen la línea `VERDICT:` o `--json`.

### Reglas de seguridad incluidas
1. Subir de verdad exige `--confirm` / `confirm: true`; la skill obliga a la IA a pedirte permiso antes.
2. Precio, cobros, impuestos y visibilidad no tienen API en itch: el kit solo los comprueba y te da el enlace exacto.
   Ninguna IA debe escribir datos bancarios, fiscales ni contraseñas.
3. Una sola subida a la vez (archivo de bloqueo): dos IAs nunca suben encima una de otra.

Pruebas: `npm test` (sin red). Licencia: `LICENSE.txt`. Hecho por Dalytria Studio.
