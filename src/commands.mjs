// The six actions of Itch Launch Kit. Every action returns a result { verdict, reason, lines, data } and never prints.
import { existsSync, mkdirSync, statSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { ok, partial, fail, UsageError, run, withLock, HOME_DIR } from './core.mjs';
import { translator } from './i18n.mjs';
import {
  CONFIG_FILE, URL_KEYS, URL_NEW, urlEdit, resolvePath, loadConfig, readVersion, readKey, maskKey, butlerCandidates, butlerDownloadUrl,
  pushArgs, parseStatus, itchManifest, measure, mb, checkPage, sellSteps, stepLine, detectEngine, guessChannels, DEFAULT_IGNORE,
} from './logic.mjs';

export const ACTIONS = ['status', 'page', 'push', 'remote', 'init', 'install-butler'];
/** Spanish aliases, so «itchkit estado» works too. */
export const ALIASES = { estado: 'status', ficha: 'page', subir: 'push', remoto: 'remote', iniciar: 'init', 'instalar-butler': 'install-butler' };
const PUSH_MS = 60 * 60 * 1000;

// --- itch API (key in the Authorization header; falls back to the classic form with the key in the path) ---------
async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json };
}

export async function itchApi(key, resource, t, fetchJson = getJson) {
  const classic = { profile: 'me', 'profile/games': 'my-games' }[resource];
  let r = await fetchJson(`https://api.itch.io/${resource}`, { Authorization: `Bearer ${key}` });
  if (r.status !== 200 || !r.json || r.json.errors) r = await fetchJson(`https://itch.io/api/1/${key}/${classic}`);
  if (r.status === 401 || r.status === 403 || r.json?.errors) throw new Error(t('keyRejected', { error: r.json?.errors?.[0] ?? r.status, url: URL_KEYS }));
  if (r.status !== 200 || !r.json) throw new Error(t('httpError', { status: r.status, resource }));
  return r.json;
}

async function queryRemote(key, game, t, fetchJson) {
  const [profile, games] = await Promise.all([itchApi(key, 'profile', t, fetchJson), itchApi(key, 'profile/games', t, fetchJson)]);
  const list = games.games ?? [];
  const found = list.find(g => String(g.url ?? '').replace(/\/+$/, '').endsWith(`/${game}`)) ?? null;
  return { user: profile.user?.username ?? '', game: found, count: list.length };
}

// --- butler ---------------------------------------------------------------------------------------------------
async function findButler(env, runner) {
  for (const path of butlerCandidates({ env })) {
    const r = await runner(path, ['version'], { ms: 20000 });
    const v = r.code === 0 && r.output.match(/v?(\d+\.\d+\.\d+)/)?.[1];
    if (v) return { path, version: v };
  }
  return null;
}

/** Last useful lines of butler output, without progress bars and with the key masked. */
export const lastLines = (output, key, n = 4) =>
  maskKey(output, key).split(/[\r\n]+/).map(s => s.trim()).filter(s => s && !/^[▐▌█░▒▓\s\d.%|\-]*$/.test(s)).slice(-n);

function measureChannels(root, cfg) {
  return Object.entries(cfg.channels).map(([channel, c]) => {
    const abs = c.path ? resolvePath(root, c.path) : '';
    if (!abs || !existsSync(abs)) return { channel, path: c.path, exists: false };
    const m = measure(abs, c.ignore ?? []);
    return { channel, path: c.path, exists: true, bytes: m.bytes, files: m.files, skipped: m.skipped, modified: statSync(abs).mtime.toISOString().slice(0, 16).replace('T', ' ') };
  });
}

/** Everything we can learn, local and (with a key) remote. Network errors are kept, never thrown. */
async function gather(root, cfg, ctx, { withRemote = true } = {}) {
  const { key, origin } = readKey(ctx.keyOptions);
  const butler = await findButler(ctx.env, ctx.run);
  let remote = null, remoteError = '', remoteChannels = null;
  if (key && withRemote) {
    try { remote = await queryRemote(key, cfg.game, ctx.t, ctx.fetchJson); } catch (e) { remoteError = maskKey(e.message, key); }
  }
  const user = ctx.user || cfg.user || remote?.user || '';
  if (butler && key && user && remote?.game) {
    const r = await ctx.run(butler.path, ['status', `${user}/${cfg.game}`], { ms: 60000, env: { BUTLER_API_KEY: key } });
    remoteChannels = r.code === 0 ? parseStatus(r.output) : null;
  }
  return { key, origin, butler, remote, remoteError, remoteChannels, user };
}

// --- Actions --------------------------------------------------------------------------------------------------
async function status(root, cfg, ctx) {
  const { t } = ctx;
  const g = await gather(root, cfg, ctx);
  const builds = measureChannels(root, cfg);
  const page = checkPage(root, cfg.page, t);
  const steps = sellSteps({
    butler: g.butler?.version, keyOrigin: g.origin, user: g.user, game: cfg.game, remote: g.remote,
    builds, page, remoteChannels: g.remoteChannels, priceMode: cfg.page?.price?.mode,
  }, t);
  const ready = steps.filter(s => s.state === 'ok').length;
  const next = steps.find(s => s.state === 'todo') ?? steps.find(s => s.state !== 'ok');
  const lines = [
    t('statusHeader', { title: cfg.page?.title || cfg.game, ready, total: steps.length }),
    ...(next ? [t('next', { action: next.action })] : []),
    ...steps.map(stepLine),
    ...(g.remoteError ? [t('warning', { text: g.remoteError })] : []),
  ];
  const data = { steps, builds, page, user: g.user, game: cfg.game, version: readVersion(root, cfg), remote: g.remote?.game ?? null, remoteChannels: g.remoteChannels };
  const reason = t('statusReason', { ready, total: steps.length });
  return ready === steps.length ? ok(reason, lines, data) : partial(reason, lines, data);
}

function page(root, cfg, { t }) {
  const p = cfg.page ?? {};
  const r = checkPage(root, p, t);
  const lines = [
    ...r.errors.map(x => `✘ ${x}`),
    ...r.warnings.map(x => `! ${x}`),
    t('pageSummary1', { title: p.title || '—', genre: p.genre || '—', price: r.summary.price }),
    t('pageSummary2', { tagline: p.tagline || '—' }),
    t('pageSummary3', { n: r.summary.tags, tags: (p.tags ?? []).join(', ') || '—' }),
    t('pageSummary4', { description: p.description || '—', words: r.summary.words ? t('pageWords', { n: r.summary.words }) : '', cover: r.summary.cover ?? '—', shots: r.summary.screenshots }),
  ];
  const reason = r.errors.length ? t('pageReasonTodo', { todo: r.errors.length, warn: r.warnings.length }) : t('pageReasonOk') + (r.warnings.length ? t('pageReasonWarn', { n: r.warnings.length }) : '');
  return (r.errors.length ? partial : ok)(reason, lines, r);
}

async function push(root, cfg, ctx, { channel, version, confirm }) {
  const { t } = ctx;
  const names = Object.keys(cfg.channels);
  if (!channel) throw new UsageError(t('pushNeedsChannel', { list: names.join('|') }));
  const chosen = channel === 'all' ? names : String(channel).split(',').map(s => s.trim()).filter(Boolean);
  for (const n of chosen) if (!cfg.channels[n]) throw new UsageError(t('pushUnknownChannel', { name: n, file: CONFIG_FILE, list: names.join(', ') }));
  const g = await gather(root, cfg, ctx, { withRemote: !ctx.user && !cfg.user });
  if (!g.butler) return fail(t('pushNoButler'), [t('pushNoButlerLine')]);
  if (!g.key) return fail(t('noKey'), [t('noKeyAction', { url: URL_KEYS })]);
  if (!g.user) return fail(t('pushNoUser'), [t('pushNoUserLine', { file: CONFIG_FILE }), ...(g.remoteError ? [g.remoteError] : [])]);
  const ver = version || readVersion(root, cfg);
  const dryRun = !confirm;

  const work = async () => {
    const res = [];
    for (const n of chosen) {
      const c = cfg.channels[n];
      const abs = resolvePath(root, c.path ?? '');
      if (!c.path || !existsSync(abs)) { res.push({ channel: n, state: 'missing', detail: t('pushMissingPath', { path: c.path }) }); continue; }
      let manifest = '';
      if (c.exe && statSync(abs).isDirectory() && !existsSync(join(abs, '.itch.toml'))) {
        if (!existsSync(join(abs, c.exe))) { res.push({ channel: n, state: 'missing', detail: t('pushMissingExe', { exe: c.exe, path: c.path }) }); continue; }
        writeFileSync(join(abs, '.itch.toml'), itchManifest(c.exe));
        manifest = t('pushManifest');
      }
      const m = measure(abs, c.ignore ?? []);
      const args = pushArgs({ path: abs, user: g.user, game: cfg.game, channel: n, version: ver, ignore: c.ignore ?? [], dryRun });
      const r = await ctx.run(g.butler.path, args, { ms: dryRun ? 600000 : PUSH_MS, env: { BUTLER_API_KEY: g.key } });
      res.push({
        channel: n, state: r.code === 0 ? 'ok' : r.timedOut ? 'timeout' : 'error',
        detail: t('pushDetail', { size: mb(m.bytes), files: m.files }) + (m.skipped.length ? t('pushSkipped', { list: m.skipped.join(', ') }) : '') + manifest,
        output: lastLines(r.output, g.key),
      });
    }
    return res;
  };
  const res = dryRun ? await work() : await withLock('itch-push', work);
  const bad = res.filter(r => r.state !== 'ok');
  const target = `${g.user}/${cfg.game}`;
  const lines = [
    dryRun ? t('pushDry', { channel }) : t('pushDone', { target, version: ver || t('pushNoVersion') }),
    ...res.flatMap(r => [`${r.state === 'ok' ? '✔' : '✘'} ${r.channel}: ${r.detail}`, ...(r.state === 'ok' && dryRun ? [] : (r.output ?? []).map(s => `   ${s}`))]),
    ...(!dryRun && !bad.length ? [t('pushProcessing')] : []),
  ];
  const data = { dryRun, target, version: ver, channels: res };
  const reason = t('pushReason', { ok: res.length - bad.length, total: res.length, how: dryRun ? t('pushHowDry') : t('pushHowReal') });
  return bad.length ? (bad.length === res.length ? fail : partial)(reason, lines, data) : ok(reason, lines, data);
}

async function remote(root, cfg, ctx) {
  const { t } = ctx;
  const g = await gather(root, cfg, ctx);
  if (!g.key) return fail(t('noKey'), [t('noKeyAction', { url: URL_KEYS })]);
  if (g.remoteError) return fail(t('remoteFail'), [g.remoteError]);
  const game = g.remote.game;
  if (!game) return partial(t('remoteNoGame', { game: cfg.game }), [t('remoteNoGameLine', { user: g.user, n: g.remote.count, game: cfg.game, url: URL_NEW, file: CONFIG_FILE })], { user: g.user });
  const earnings = (game.earnings ?? []).map(x => x.amount_formatted ?? `${x.amount} ${x.currency}`).join(' + ') || '0';
  const platforms = ['windows', 'linux', 'osx', 'android'].filter(p => game[`p_${p}`]).join(', ') || t('remoteNone');
  const lines = [
    t('remoteTitle', { title: game.title, state: game.published ? t('remotePublished') : t('remoteDraft'), url: game.url }),
    t('remotePrice', { price: game.min_price > 0 ? `${(game.min_price / 100).toFixed(2)} USD` : t('remoteFree'), platforms }),
    t('remoteStats', { views: game.views_count ?? 0, downloads: game.downloads_count ?? 0, purchases: game.purchases_count ?? 0, earnings }),
    ...(g.remoteChannels ? (g.remoteChannels.length ? g.remoteChannels.map(c => t('remoteChannel', { channel: c.channel, version: c.version || '?', build: c.build || '?' })) : [t('remoteNoBuilds')]) : [t('remoteNoButler')]),
    t('remoteEdit', { url: urlEdit(game.id) }),
  ];
  return ok(t('remoteReason', { purchases: game.purchases_count ?? 0, downloads: game.downloads_count ?? 0 }), lines, { game, channels: g.remoteChannels, user: g.user });
}

/** Writes a starter itch.json from what it finds (engine, version file, build folders). Never overwrites. */
function init(root, { t, configFile }) {
  const path = resolvePath(root, configFile);
  if (existsSync(path)) return partial(t('initExists', { file: configFile }), [t('initExists', { file: configFile })], { path });
  const engine = detectEngine(root);
  const channels = guessChannels(root, engine);
  const slug = (root.split(/[\\/]/).filter(Boolean).at(-1) || 'my-game').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-game';
  const cfg = {
    user: '',
    game: slug,
    ...(engine ? { versionFrom: engine.versionFile } : {}),
    channels: Object.keys(channels).length ? channels : { windows: { path: 'Builds/Windows', exe: 'Game.exe', ignore: DEFAULT_IGNORE[''] } },
    page: {
      title: '', tagline: '', description: 'itch/description.md', genre: '', tags: [],
      cover: 'itch/cover.png', screenshots: 'itch/screenshots', price: { mode: '', usd: 0 },
    },
  };
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  const lines = [
    t('initCreated', { file: configFile }),
    engine ? t('initEngine', { engine: `${engine.engine} (${engine.versionFile})` }) : t('initNoEngine'),
    ...(Object.keys(channels).length ? Object.entries(channels).map(([c, v]) => t('initChannel', { channel: c, path: v.path })) : [t('initNoBuilds')]),
    t('initNext'),
  ];
  return ok(t('initCreated', { file: configFile }), lines, { path, config: cfg });
}

/** Downloads the official butler from broth.itch.zone into ~/.itchkit/butler. */
async function installButler(ctx) {
  const { t } = ctx;
  const have = await findButler(ctx.env, ctx.run);
  if (have) return ok(t('installHave', { version: have.version, path: have.path }), [t('installHave', { version: have.version, path: have.path })], have);
  const url = butlerDownloadUrl();
  if (!url) return fail(t('installUnsupported', { platform: process.platform, arch: process.arch }), []);
  const dir = join(HOME_DIR, 'butler');
  try {
    mkdirSync(dir, { recursive: true });
    const r = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const zip = join(dir, 'butler.zip');
    writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    const un = process.platform === 'linux' ? await ctx.run('unzip', ['-o', zip, '-d', dir]) : await ctx.run('tar', ['-xf', zip, '-C', dir]);
    if (un.code !== 0) throw new Error(un.output.trim().split(/\r?\n/).at(-1) || 'unzip failed');
    const exe = join(dir, process.platform === 'win32' ? 'butler.exe' : 'butler');
    if (process.platform !== 'win32') chmodSync(exe, 0o755);
    const got = await findButler({ ...ctx.env, BUTLER_PATH: exe }, ctx.run);
    if (!got) throw new Error(`butler did not start; files: ${readdirSync(dir).join(', ')}`);
    return ok(t('installDone', { version: got.version, path: exe }), [t('installDone', { version: got.version, path: exe })], got);
  } catch (e) {
    return fail(t('installFail', { error: e.message }), [t('installFail', { error: e.message })]);
  }
}

/**
 * Runs one action. `args`: { action, channel, version, confirm, user, config, lang }.
 * `deps` (for tests): { root, env, run, fetchJson, keyOptions }.
 */
export async function runAction(args = {}, deps = {}) {
  const t = deps.t ?? translator(args.lang ?? 'en');
  const action = ALIASES[args.action] ?? args.action ?? 'status';
  if (!ACTIONS.includes(action)) throw new UsageError(t('usageAction', { list: ACTIONS.join(', ') }));
  // Paths inside itch.json are relative to the folder that holds it.
  const configPath = resolvePath(deps.root ?? process.cwd(), args.config || CONFIG_FILE);
  const root = dirname(configPath);
  const env = deps.env ?? process.env;
  const ctx = {
    t, env, run: deps.run ?? run, fetchJson: deps.fetchJson ?? getJson, user: args.user,
    keyOptions: { env, ...(deps.keyOptions ?? {}) }, configFile: basename(configPath),
  };
  if (action === 'install-butler') return installButler(ctx);
  if (action === 'init') return init(root, ctx);
  let cfg;
  try { cfg = loadConfig(root, t, ctx.configFile); } catch (e) { return fail(e.message, []); }
  if (action === 'page') return page(root, cfg, ctx);
  if (action === 'push') return push(root, cfg, ctx, args);
  if (action === 'remote') return remote(root, cfg, ctx);
  return status(root, cfg, ctx);
}
