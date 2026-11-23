// Pure logic (no network, no processes): config, API key, butler paths, images, store page checks and the steps to sell.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, isAbsolute } from 'node:path';

export const CONFIG_FILE = 'itch.json';
export const URL_NEW = 'https://itch.io/game/new';
export const URL_KEYS = 'https://itch.io/user/settings/api-keys';
export const URL_PAYOUTS = 'https://itch.io/user/settings';
export const urlEdit = id => (id ? `https://itch.io/game/edit/${id}` : 'https://itch.io/dashboard');

/** itch.io store page limits: cover 630×500 recommended, 315×250 minimum, up to 10 tags. */
export const LIMITS = Object.freeze({ coverMin: [315, 250], coverIdeal: [630, 500], taglineMax: 120, tagsMax: 10, shotsMin: 3, descriptionMinWords: 120 });
export const PRICE_MODES = ['free', 'donate', 'paid', 'pwyw'];
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

export const resolvePath = (root, p) => (isAbsolute(p) ? p : join(root, p));

// --- Config ---------------------------------------------------------------------------------------------------
/** Reads itch.json from root (or an explicit path). Throws an Error with an actionable message. */
export function loadConfig(root, t, file = CONFIG_FILE) {
  const path = resolvePath(root, file);
  if (!existsSync(path)) throw new Error(t('noConfig', { file }));
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  let cfg;
  try { cfg = JSON.parse(text); } catch (e) { throw new Error(t('badJson', { file, error: e.message })); }
  if (/"(api_?key|key|token|password)"\s*:/i.test(text)) throw new Error(t('keyInConfig', { file }));
  if (!cfg.game || !/^[a-z0-9-_]+$/.test(cfg.game)) throw new Error(t('badGame', { file }));
  if (!cfg.channels || typeof cfg.channels !== 'object' || !Object.keys(cfg.channels).length) throw new Error(t('noChannels', { file }));
  for (const name of Object.keys(cfg.channels)) if (!/^[a-z0-9-]+$/.test(name)) throw new Error(t('badChannel', { name }));
  cfg.page ??= {};
  return cfg;
}

// --- Version --------------------------------------------------------------------------------------------------
const VERSION_READERS = [
  { file: 'ProjectSettings/ProjectSettings.asset', engine: 'Unity', read: s => s.match(/^\s*bundleVersion:\s*(\S+)/m)?.[1] },
  { file: 'project.godot', engine: 'Godot', read: s => s.match(/^\s*config\/version\s*=\s*"([^"]+)"/m)?.[1] },
  { file: 'package.json', engine: 'Node', read: s => { try { return JSON.parse(s).version; } catch { return undefined; } } },
];

/** Finds an engine project at root or one folder down. Returns { engine, dir, versionFile } or null. */
export function detectEngine(root) {
  const dirs = ['.', ...(() => { try { return readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules').map(d => d.name); } catch { return []; } })()];
  for (const r of VERSION_READERS.slice(0, 2)) {
    for (const d of dirs) if (existsSync(join(root, d, r.file))) return { engine: r.engine, dir: d, versionFile: d === '.' ? r.file : `${d}/${r.file}` };
  }
  return null;
}

/** Version shown on itch: cfg.version → cfg.versionFrom → autodetected Unity/Godot/package.json. '' if none. */
export function readVersion(root, cfg = {}) {
  if (typeof cfg.version === 'string' && cfg.version.trim()) return cfg.version.trim();
  const tryFile = rel => {
    let text;
    try { text = readFileSync(resolvePath(root, rel), 'utf8'); } catch { return ''; }
    for (const r of VERSION_READERS) if (rel.replace(/\\/g, '/').endsWith(r.file)) return r.read(text) ?? '';
    return text.trim().split(/\r?\n/)[0].trim();
  };
  if (cfg.versionFrom) return tryFile(cfg.versionFrom);
  const eng = detectEngine(root);
  if (eng) return tryFile(eng.versionFile);
  return existsSync(join(root, 'package.json')) ? tryFile('package.json') : '';
}

// --- API key (never printed) -----------------------------------------------------------------------------------
function envFileValue(text, names) {
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    if (!names.includes(line.slice(0, i).trim().replace(/^export\s+/, ''))) continue;
    let v = line.slice(i + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    if (v) return v;
  }
  return '';
}

/** butler stores its login here on each OS. */
export function butlerCredsPaths(home = homedir(), platform = process.platform) {
  const list = [join(home, '.config', 'itch', 'butler_creds')];
  if (platform === 'darwin') list.push(join(home, 'Library', 'Application Support', 'itch', 'butler_creds'));
  return list;
}

/** Finds the key: environment → ~/.itchkit/env → extra env files → butler login. Returns { key, origin }. */
export function readKey({ env = process.env, envFiles = [join(homedir(), '.itchkit', 'env')], credsPaths = butlerCredsPaths() } = {}) {
  const names = ['ITCH_API_KEY', 'BUTLER_API_KEY'];
  for (const n of names) if (env[n]?.trim()) return { key: env[n].trim(), origin: n };
  for (const f of envFiles) {
    try { const v = envFileValue(readFileSync(f, 'utf8'), names); if (v) return { key: v, origin: f.replace(homedir(), '~') }; } catch { /* no file */ }
  }
  for (const f of credsPaths) {
    try { const v = readFileSync(f, 'utf8').trim(); if (v) return { key: v, origin: 'butler login' }; } catch { /* no login */ }
  }
  return { key: '', origin: '' };
}

/** itch keys have no known prefix, so they are masked by value. */
export const maskKey = (text, key) => (key && key.length >= 8 ? String(text ?? '').split(key).join('[KEY HIDDEN]') : String(text ?? ''));

// --- butler ---------------------------------------------------------------------------------------------------
const cmpVersions = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

/** Where the itch app keeps butler on each OS. */
export function brothDir({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'itch', 'broth', 'butler');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'itch', 'broth', 'butler');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'itch', 'broth', 'butler');
}

/** Candidate butler paths in order: BUTLER_PATH → ~/.itchkit/butler → itch app → "butler" on PATH. */
export function butlerCandidates({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  const exe = platform === 'win32' ? 'butler.exe' : 'butler';
  const list = [];
  if (env.BUTLER_PATH) list.push(env.BUTLER_PATH);
  list.push(join(home, '.itchkit', 'butler', exe));
  const broth = brothDir({ env, home, platform });
  try {
    const chosen = (() => { try { return readFileSync(join(broth, '.chosen-version'), 'utf8').trim(); } catch { return ''; } })();
    const all = readdirSync(join(broth, 'versions')).filter(v => /^\d+(\.\d+)*$/.test(v)).sort(cmpVersions).reverse();
    for (const v of chosen ? [chosen, ...all.filter(x => x !== chosen)] : all) list.push(join(broth, 'versions', v, exe));
  } catch { /* no itch app */ }
  return [...list.filter(p => existsSync(p)), 'butler'];
}

/** Official butler download (zip) for this OS and CPU, or '' if there is none. */
export function butlerDownloadUrl(platform = process.platform, arch = process.arch) {
  const os = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[platform];
  const cpu = { x64: 'amd64', ia32: '386', arm64: platform === 'darwin' ? 'amd64' : '' }[arch];
  return os && cpu ? `https://broth.itch.zone/butler/${os}-${cpu}/LATEST/archive/default` : '';
}

/** Arguments for "butler push" of one channel. */
export function pushArgs({ path, user, game, channel, version, ignore = [], dryRun = true }) {
  const a = ['push', path, `${user}/${game}:${channel}`, '--if-changed'];
  if (version) a.push('--userversion', version);
  for (const p of ignore) a.push('--ignore', p);
  if (dryRun) a.push('--dry-run');
  return a;
}

/** Parses the "butler status" table: | CHANNEL | UPLOAD | BUILD | VERSION |. */
export function parseStatus(text) {
  const rows = [];
  for (const l of String(text ?? '').split(/\r?\n/)) {
    if (!l.trim().startsWith('|')) continue;
    const c = l.split('|').slice(1, -1).map(s => s.trim());
    if (c.length < 2 || /^channel$/i.test(c[0])) continue;
    rows.push({ channel: c[0], upload: c[1] || '', build: c[2] || '', version: c[3] || '' });
  }
  return rows;
}

/** Minimal manifest so the itch app launches the right executable (not a crash handler). */
export const itchManifest = exe => `# Written by Itch Launch Kit: tells the itch app which executable to launch.\n[[actions]]\nname = "play"\npath = "${exe}"\n`;

/** Default ignore patterns per engine: debug symbols and backup folders that must never ship. */
export const DEFAULT_IGNORE = Object.freeze({
  Unity: ['*_BurstDebugInformation_DoNotShip', '*_BackUpThisFolder_ButDontShipItWithYourGame', '*.pdb'],
  Godot: ['*.pdb'],
  '': ['*.pdb'],
});

// --- Builds ---------------------------------------------------------------------------------------------------
const globToRegex = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

/** Size of a folder or file in bytes, skipping names that match the ignore globs. */
export function measure(path, ignore = []) {
  const res = ignore.map(globToRegex);
  let bytes = 0, files = 0;
  const skipped = new Set();
  const walk = p => {
    const s = statSync(p);
    if (s.isFile()) { bytes += s.size; files++; return; }
    for (const n of readdirSync(p)) {
      if (res.some(r => r.test(n))) { skipped.add(n); continue; }
      walk(join(p, n));
    }
  };
  walk(path);
  return { bytes, files, skipped: [...skipped].sort() };
}

export const mb = b => `${(b / 2 ** 20).toFixed(b >= 2 ** 30 ? 0 : 1)} MB`;

/** Guesses channels from build folders: names with windows/linux/mac/android/web, .apk files, folders with an .exe or index.html. */
export function guessChannels(root, engine) {
  const out = {};
  const bases = ['Builds', 'Build', 'builds', 'build', 'Export', 'export', 'exports'];
  const roots = [root, ...(engine && engine.dir !== '.' ? [join(root, engine.dir)] : [])];
  const rel = p => p.slice(root.length + 1).replace(/\\/g, '/');
  const ignore = DEFAULT_IGNORE[engine?.engine ?? ''];
  const add = (name, entry) => { if (!out[name]) out[name] = entry; };
  for (const r of roots) {
    for (const b of bases) {
      const dir = join(r, b);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        const low = n.toLowerCase();
        if (low.endsWith('.apk')) { add(low.includes('quest') ? 'quest-android' : 'android', { path: rel(p) }); continue; }
        if (!statSync(p).isDirectory()) continue;
        const inner = readdirSync(p);
        const exe = inner.find(f => f.toLowerCase().endsWith('.exe') && !/crashhandler/i.test(f));
        if (/win/.test(low) || exe) add('windows', { path: rel(p), ...(exe ? { exe } : {}), ignore });
        else if (/linux/.test(low)) add('linux', { path: rel(p), ignore });
        else if (/mac|osx/.test(low)) add('osx', { path: rel(p), ignore });
        else if (/web|html/.test(low) || inner.includes('index.html')) add('html5', { path: rel(p) });
        else if (/android/.test(low)) for (const f of inner) if (f.toLowerCase().endsWith('.apk')) add(f.toLowerCase().includes('quest') ? 'quest-android' : 'android', { path: rel(join(p, f)) });
      }
    }
  }
  return out;
}

// --- Images ---------------------------------------------------------------------------------------------------
/** Width and height of a PNG, JPEG, GIF or WebP from its header; null if unknown. */
export function imageSize(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const sizeOf = p => { try { return imageSize(readFileSync(p)); } catch { return null; } };
const fmt = s => `${s.width}×${s.height}`;

// --- Store page -----------------------------------------------------------------------------------------------
/** Checks the store page. Returns { errors, warnings, summary } (errors block selling, warnings do not). */
export function checkPage(root, page = {}, t) {
  const errors = [], warnings = [], summary = {};
  if (!page.title?.trim()) errors.push(t('pageNoTitle'));
  const tagline = page.tagline?.trim() ?? '';
  if (!tagline) errors.push(t('pageNoTagline'));
  else if (tagline.length > LIMITS.taglineMax) warnings.push(t('pageLongTagline', { n: tagline.length, max: LIMITS.taglineMax }));

  const tags = Array.isArray(page.tags) ? page.tags : [];
  if (!tags.length) errors.push(t('pageNoTags'));
  if (tags.length > LIMITS.tagsMax) errors.push(t('pageTooManyTags', { n: tags.length, max: LIMITS.tagsMax }));
  const bad = tags.filter(x => !/^[a-z0-9][a-z0-9 -]*$/.test(x));
  if (bad.length) warnings.push(t('pageBadTags', { list: bad.join(', ') }));
  summary.tags = tags.length;

  if (!page.description) errors.push(t('pageNoDescription'));
  else if (!existsSync(resolvePath(root, page.description))) errors.push(t('pageDescriptionMissing', { path: page.description }));
  else {
    const words = readFileSync(resolvePath(root, page.description), 'utf8').split(/\s+/).filter(Boolean).length;
    summary.words = words;
    if (words < LIMITS.descriptionMinWords) warnings.push(t('pageShortDescription', { n: words, min: LIMITS.descriptionMinWords }));
  }

  if (!page.cover) errors.push(t('pageNoCover'));
  else if (!existsSync(resolvePath(root, page.cover))) errors.push(t('pageCoverMissing', { path: page.cover, size: LIMITS.coverIdeal.join('×') }));
  else {
    const s = sizeOf(resolvePath(root, page.cover));
    summary.cover = s ? fmt(s) : '?';
    if (!s) errors.push(t('pageCoverFormat', { path: page.cover }));
    else {
      if (s.width < LIMITS.coverMin[0] || s.height < LIMITS.coverMin[1]) errors.push(t('pageCoverSmall', { size: fmt(s), min: LIMITS.coverMin.join('×') }));
      if (Math.abs(s.width / s.height - LIMITS.coverIdeal[0] / LIMITS.coverIdeal[1]) > 0.03) warnings.push(t('pageCoverRatio', { size: fmt(s) }));
    }
  }

  let shots = [];
  if (page.screenshots && existsSync(resolvePath(root, page.screenshots))) {
    shots = readdirSync(resolvePath(root, page.screenshots)).filter(n => IMAGE_EXT.includes(extname(n).toLowerCase())).sort();
    for (const n of shots) {
      const s = sizeOf(join(resolvePath(root, page.screenshots), n));
      if (!s) warnings.push(t('pageShotFormat', { name: n }));
      else if (s.width < 640) warnings.push(t('pageShotSmall', { size: fmt(s), name: n }));
    }
  }
  summary.screenshots = shots.length;
  if (shots.length < LIMITS.shotsMin) errors.push(t('pageFewShots', { n: shots.length, dir: page.screenshots || '-', min: LIMITS.shotsMin }));

  const mode = page.price?.mode ?? '';
  if (!PRICE_MODES.includes(mode)) errors.push(t('pageNoPrice', { list: PRICE_MODES.join(' | ') }));
  else if (mode === 'paid' && !(page.price.usd > 0)) errors.push(t('pagePaidNoPrice'));
  summary.price = mode ? (page.price.usd > 0 ? `${mode} ${page.price.usd} USD` : mode) : t('pageUndecided');
  return { errors, warnings, summary };
}

// --- Steps to sell --------------------------------------------------------------------------------------------
/**
 * Ordered list of what is missing to sell on itch. Each step: { n, id, state: ok|todo|manual|unknown, text, action }.
 * `s` gathers what is already known: butler, keyOrigin, user, game, remote, builds, page, remoteChannels, priceMode.
 */
export function sellSteps(s, t) {
  const steps = [];
  const add = (id, state, text, action = '') => steps.push({ n: steps.length + 1, id, state, text, action });
  add('butler', s.butler ? 'ok' : 'todo', s.butler ? t('stepButlerOk', { version: s.butler }) : t('stepButlerNo'), t('stepButlerAction'));
  add('key', s.keyOrigin ? 'ok' : 'todo', s.keyOrigin ? t('keyFrom', { origin: s.keyOrigin }) : t('noKey'), t('noKeyAction', { url: URL_KEYS }));
  add('user', s.user ? 'ok' : 'todo', s.user ? t('stepUserOk', { user: s.user }) : t('stepUserNo'), t('stepUserAction', { file: CONFIG_FILE }));
  const r = s.remote;
  if (!r) add('page', 'unknown', t('stepPageUnknown'), t('stepPageUnknownAction', { url: URL_NEW, game: s.game }));
  else if (!r.game) add('page', 'todo', t('stepPageNo', { game: s.game }), t('stepPageNoAction', { url: URL_NEW, game: s.game }));
  else add('page', 'ok', t('stepPageOk', { url: r.game.url }));
  const builds = s.builds || [];
  const missing = builds.filter(b => !b.exists).map(b => b.channel);
  const have = builds.length - missing.length;
  add('builds', have ? 'ok' : 'todo', t('stepBuilds', { have, total: builds.length }) + (missing.length ? t('stepBuildsMissing', { list: missing.join(', ') }) : ''), t('stepBuildsAction', { file: CONFIG_FILE }));
  const p = s.page || { errors: ['?'] };
  add('content', p.errors.length ? 'todo' : 'ok', p.errors.length ? t('stepContentNo', { count: p.errors.length, first: p.errors[0] }) : t('stepContentOk'), t('stepContentAction'));
  if (!r || !s.remoteChannels) add('uploaded', 'unknown', t('stepUploadUnknown'), t('stepUploadUnknownAction'));
  else if (!s.remoteChannels.length) add('uploaded', 'todo', t('stepUploadNo'), t('stepUploadNoAction'));
  else add('uploaded', 'ok', t('stepUploadOk', { count: s.remoteChannels.length, list: s.remoteChannels.map(c => `${c.channel} ${c.version || ''}`.trim()).join(', ') }));
  const edit = urlEdit(r?.game?.id);
  const mode = s.priceMode || '';
  if (r?.game && r.game.min_price > 0) add('price', 'ok', t('stepPriceOk', { price: (r.game.min_price / 100).toFixed(2) }));
  else if ((mode === 'free' || mode === 'donate') && r?.game) add('price', 'ok', t('stepPriceMode', { mode }));
  else add('price', 'manual', mode ? t('stepPriceManual', { mode }) : t('stepPriceUndecided'), t('stepPriceAction', { url: edit }));
  add('payouts', mode === 'free' ? 'ok' : 'manual', t('stepPayouts'), t('stepPayoutsAction', { url: URL_PAYOUTS }));
  if (!r?.game) add('published', 'unknown', t('stepPublishedUnknown'), t('stepPublishedAction', { url: edit }));
  else add('published', r.game.published ? 'ok' : 'todo', r.game.published ? t('stepPublishedOk') : t('stepPublishedNo'), t('stepPublishedAction', { url: edit }));
  return steps;
}

const SYMBOL = { ok: '✔', todo: '✘', manual: '✋', unknown: '?' };
export const stepLine = s => `${SYMBOL[s.state]} ${s.n}. ${s.text}${s.state === 'ok' ? '' : ` → ${s.action}`}`;
