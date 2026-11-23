// Itch Launch Kit tests: pure logic, actions with a fake butler and a fake itch API, CLI parsing and MCP. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction, lastLines } from '../src/commands.mjs';
import { parseArgs } from '../src/cli.mjs';
import { handle, TOOLS } from '../src/mcp.mjs';
import { toText } from '../src/core.mjs';
import { translator, KEYS, SPANISH_KEYS, pickLang } from '../src/i18n.mjs';
import {
  readKey, maskKey, pushArgs, parseStatus, imageSize, checkPage, sellSteps, measure, loadConfig, readVersion, butlerCandidates,
  detectEngine, guessChannels, butlerDownloadUrl,
} from '../src/logic.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'itchkit-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
const t = translator('en');
const KEY = 'secret-key-1234567';
const noFiles = { keyOptions: { envFiles: [join(tmp, 'none.env')], credsPaths: [join(tmp, 'none.creds')] } };

const png = (w, h) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0]);

/** Toy Unity project with builds, a store page and itch.json. */
function project(name, { page = true, config = true } = {}) {
  const r = join(tmp, name);
  mkdirSync(join(r, 'Builds/Windows/Game_BurstDebugInformation_DoNotShip'), { recursive: true });
  writeFileSync(join(r, 'Builds/Windows/Game.exe'), 'x'.repeat(100));
  writeFileSync(join(r, 'Builds/Windows/UnityCrashHandler64.exe'), 'c');
  writeFileSync(join(r, 'Builds/Windows/Game_BurstDebugInformation_DoNotShip/a.txt'), 'y'.repeat(5000));
  writeFileSync(join(r, 'Builds/game.apk'), 'z'.repeat(50));
  mkdirSync(join(r, 'ProjectSettings'), { recursive: true });
  writeFileSync(join(r, 'ProjectSettings/ProjectSettings.asset'), 'PlayerSettings:\n  bundleVersion: 1.2.3\n');
  if (config) {
    writeFileSync(join(r, 'itch.json'), JSON.stringify({
      user: '', game: 'my-game',
      channels: { windows: { path: 'Builds/Windows', exe: 'Game.exe', ignore: ['*DoNotShip*'] }, android: { path: 'Builds/game.apk' } },
      page: { title: 'T', tagline: 'Short', description: 'itch/d.md', tags: ['rpg', 'fantasy'], cover: 'itch/c.png', screenshots: 'itch/s', price: { mode: 'paid', usd: 5 } },
    }));
  }
  if (page) {
    mkdirSync(join(r, 'itch/s'), { recursive: true });
    writeFileSync(join(r, 'itch/d.md'), 'word '.repeat(200));
    writeFileSync(join(r, 'itch/c.png'), png(630, 500));
    for (const n of ['1.png', '2.png', '3.jpg']) writeFileSync(join(r, 'itch/s', n), n.endsWith('jpg') ? jpg(1280, 720) : png(1920, 1080));
  }
  return r;
}

/** Fake butler and itch API that record calls. */
function fakes() {
  const calls = [];
  const run = async (cmd, args, o) => {
    calls.push({ cmd, args, env: o?.env });
    if (args[0] === 'version') return cmd === 'butler' ? { code: 0, output: 'v15.32.0, built on Jan 1' } : { code: -1, output: '' };
    if (args[0] === 'status') return { code: 0, output: '| CHANNEL | UPLOAD | BUILD | VERSION |\n| windows | #1 | √ #3 | 1.2.3 |\n' };
    if (args[0] === 'push') return { code: 0, output: `▐▓▓▓░░▌ 50%\r\nPushing 1.2 MiB\n${KEY} done\n` };
    return { code: 1, output: '' };
  };
  const fetchJson = async url => {
    if (url.endsWith('/profile')) return { status: 200, json: { user: { username: 'dev' } } };
    if (url.endsWith('/profile/games')) return { status: 200, json: { games: [{ id: 7, title: 'My Game', url: 'https://dev.itch.io/my-game', published: false, min_price: 500, purchases_count: 2, downloads_count: 9, views_count: 40, earnings: [{ amount_formatted: '$9.00' }] }] } };
    return { status: 404, json: null };
  };
  return { calls, run, fetchJson };
}
const deps = (root, f, env = { ITCH_API_KEY: KEY }) => ({ root, env, run: f.run, fetchJson: f.fetchJson, ...noFiles, t });

test('i18n: Spanish has every English message', () => {
  assert.deepEqual(KEYS.filter(k => !SPANISH_KEYS.includes(k)), []);
  assert.equal(pickLang(undefined, { LANG: 'es_MX.UTF-8' }), 'es');
  assert.equal(pickLang('en', { LANG: 'es' }), 'en');
  assert.equal(translator('es')('next', { action: 'x' }), 'Siguiente: x');
});

test('readKey: environment, env file and butler login, in that order', () => {
  const f = join(tmp, 'a.env'); writeFileSync(f, '# c\nITCH_API_KEY = "fromfile12345"\n');
  const c = join(tmp, 'creds'); writeFileSync(c, 'fromlogin12345\n');
  assert.deepEqual(readKey({ env: { BUTLER_API_KEY: 'fromenv12345' }, envFiles: [f], credsPaths: [c] }), { key: 'fromenv12345', origin: 'BUTLER_API_KEY' });
  assert.equal(readKey({ env: {}, envFiles: [f], credsPaths: [c] }).key, 'fromfile12345');
  assert.equal(readKey({ env: {}, envFiles: [], credsPaths: [c] }).origin, 'butler login');
  assert.equal(readKey({ env: {}, envFiles: [], credsPaths: [] }).key, '');
});

test('maskKey and lastLines hide the key and progress bars', () => {
  assert.equal(maskKey(`a ${KEY} b`, KEY), 'a [KEY HIDDEN] b');
  assert.deepEqual(lastLines(`▐▓▓░░▌ 50%\r\nPushing 1 MiB\n${KEY} ok\n`, KEY), ['Pushing 1 MiB', '[KEY HIDDEN] ok']);
});

test('pushArgs and parseStatus', () => {
  assert.deepEqual(pushArgs({ path: 'b', user: 'u', game: 'g', channel: 'windows', version: '1.0', ignore: ['*X*'] }), ['push', 'b', 'u/g:windows', '--if-changed', '--userversion', '1.0', '--ignore', '*X*', '--dry-run']);
  assert.ok(!pushArgs({ path: 'b', user: 'u', game: 'g', channel: 'w', dryRun: false }).includes('--dry-run'));
  assert.deepEqual(parseStatus('| CHANNEL | UPLOAD | BUILD | VERSION |\n| windows | #12 | √ #4 | 0.1.0 |\n| android | #13 | √ #2 |  |\n').map(x => [x.channel, x.version]), [['windows', '0.1.0'], ['android', '']]);
  assert.deepEqual(parseStatus('No channels yet'), []);
});

test('imageSize reads PNG and JPEG headers', () => {
  assert.deepEqual(imageSize(png(630, 500)), { width: 630, height: 500 });
  assert.deepEqual(imageSize(jpg(1280, 720)), { width: 1280, height: 720 });
  assert.equal(imageSize(Buffer.from('not an image at all, sorry')), null);
});

test('measure skips folders that must not ship', () => {
  const r = project('measure');
  const m = measure(join(r, 'Builds/Windows'), ['*DoNotShip*']);
  assert.equal(m.bytes, 101);
  assert.deepEqual(m.skipped, ['Game_BurstDebugInformation_DoNotShip']);
});

test('checkPage: complete page passes; broken page gives actionable errors', () => {
  const r = project('page');
  const cfg = loadConfig(r, t);
  assert.deepEqual(checkPage(r, cfg.page, t).errors, []);
  const bad = checkPage(r, { ...cfg.page, cover: 'itch/s/3.jpg', tags: Array(11).fill('a'), price: { mode: '' } }, t);
  assert.ok(bad.errors.some(e => e.includes('11 tags')));
  assert.ok(bad.errors.some(e => e.includes('price.mode')));
  assert.ok(bad.warnings.some(e => e.includes('ratio')));
});

test('loadConfig refuses bad channels and API keys inside itch.json', () => {
  const r = project('badcfg', { page: false, config: false });
  writeFileSync(join(r, 'itch.json'), JSON.stringify({ game: 'g', channels: { 'Win Dows': { path: 'x' } } }));
  assert.throws(() => loadConfig(r, t), /invalid channel "Win Dows"/);
  writeFileSync(join(r, 'itch.json'), JSON.stringify({ game: 'g', api_key: 'x', channels: { windows: { path: 'x' } } }));
  assert.throws(() => loadConfig(r, t), /API key/);
});

test('version detection: Unity, Godot, package.json and explicit', () => {
  const r = project('version', { page: false });
  assert.equal(readVersion(r), '1.2.3');
  assert.equal(readVersion(r, { version: '9.9' }), '9.9');
  const g = join(tmp, 'godot', 'game'); mkdirSync(g, { recursive: true });
  writeFileSync(join(g, 'project.godot'), '[application]\nconfig/name="X"\nconfig/version="0.4.0"\n');
  assert.equal(detectEngine(join(tmp, 'godot')).versionFile, 'game/project.godot');
  assert.equal(readVersion(join(tmp, 'godot')), '0.4.0');
});

test('guessChannels finds the Windows build with its exe and the APK', () => {
  const r = project('guess', { page: false, config: false });
  const c = guessChannels(r, detectEngine(r));
  assert.equal(c.windows.exe, 'Game.exe');
  assert.equal(c.android.path, 'Builds/game.apk');
  assert.ok(c.windows.ignore.some(p => p.includes('DoNotShip')));
});

test('sellSteps: everything ready leaves only the manual payouts step', () => {
  const s = sellSteps({ butler: '15', keyOrigin: 'x', user: 'u', game: 'g', remote: { game: { id: 1, url: 'u', min_price: 100, published: true } }, builds: [{ channel: 'w', exists: true }], page: { errors: [] }, remoteChannels: [{ channel: 'w', version: '1' }], priceMode: 'paid' }, t);
  assert.equal(s.length, 10);
  assert.deepEqual(s.filter(x => x.state !== 'ok').map(x => x.id), ['payouts']);
});

test('butler candidates end with butler on PATH; download URL exists for common OSes', () => {
  assert.equal(butlerCandidates({ env: {}, home: tmp }).at(-1), 'butler');
  assert.match(butlerDownloadUrl('win32', 'x64'), /windows-amd64/);
  assert.match(butlerDownloadUrl('linux', 'x64'), /linux-amd64/);
  assert.equal(butlerDownloadUrl('aix', 'ppc'), '');
});

test('status detects the user from the API and channels from butler, never leaks the key', async () => {
  const r = project('status');
  const f = fakes();
  const res = await runAction({}, deps(r, f));
  assert.equal(res.data.user, 'dev');
  assert.equal(res.data.remoteChannels[0].channel, 'windows');
  assert.deepEqual(res.data.steps.filter(s => s.state !== 'ok').map(s => s.id), ['payouts', 'published']);
  assert.ok(!JSON.stringify(res).includes(KEY));
  assert.equal(f.calls.find(c => c.args[0] === 'status').env.BUTLER_API_KEY, KEY);
});

test('push is a dry run by default, writes .itch.toml and accepts Spanish aliases', async () => {
  const r = project('push');
  const f = fakes();
  const res = await runAction({ action: 'subir', channel: 'all', user: 'dev' }, deps(r, f));
  assert.equal(res.verdict, 'OK');
  assert.equal(res.data.dryRun, true);
  const pushes = f.calls.filter(c => c.args[0] === 'push');
  assert.equal(pushes.length, 2);
  assert.ok(pushes.every(p => p.args.includes('--dry-run') && p.args.includes('1.2.3')));
  assert.ok(pushes[0].args.includes('dev/my-game:windows'));
  assert.ok(readFileSync(join(r, 'Builds/Windows/.itch.toml'), 'utf8').includes('path = "Game.exe"'));
  assert.ok(!JSON.stringify(res).includes(KEY));
});

test('push --confirm uploads for real; without a key it fails with instructions', async () => {
  const r = project('confirm');
  const f = fakes();
  await runAction({ action: 'push', channel: 'android', user: 'dev', confirm: true }, deps(r, f));
  assert.ok(!f.calls.find(c => c.args[0] === 'push').args.includes('--dry-run'));
  const none = await runAction({ action: 'push', channel: 'android' }, deps(r, f, {}));
  assert.equal(none.verdict, 'FAIL');
  assert.match(none.lines.join(' '), /api-keys/);
  await assert.rejects(runAction({ action: 'push', channel: 'mac' }, deps(r, f)), /not in itch.json/);
});

test('remote shows price, sales and channels', async () => {
  const r = project('remote');
  const res = await runAction({ action: 'remote' }, deps(r, fakes()));
  assert.equal(res.verdict, 'OK');
  assert.match(res.lines.join('\n'), /5\.00 USD/);
  assert.match(res.lines.join('\n'), /Purchases 2/);
});

test('init writes a starter itch.json once', async () => {
  const r = project('init', { page: false, config: false });
  const res = await runAction({ action: 'init' }, { root: r, t });
  assert.equal(res.verdict, 'OK');
  const cfg = JSON.parse(readFileSync(join(r, 'itch.json'), 'utf8'));
  assert.equal(cfg.versionFrom, 'ProjectSettings/ProjectSettings.asset');
  assert.equal(cfg.channels.windows.exe, 'Game.exe');
  assert.equal((await runAction({ action: 'init' }, { root: r, t })).verdict, 'PARTIAL');
});

test('toText keeps at most 15 lines and ends with the verdict', () => {
  const text = toText({ verdict: 'OK', reason: 'r', lines: Array.from({ length: 30 }, (_, i) => `l${i}`) }, t, { save: false });
  const lines = text.split('\n');
  assert.equal(lines.length, 15);
  assert.equal(lines.at(-1), 'VERDICT: OK r');
});

test('CLI parses actions and flags', () => {
  assert.deepEqual(parseArgs(['push', '--channel', 'all', '--confirm', '--lang=es']), { _: ['push'], action: 'push', channel: 'all', confirm: true, lang: 'es' });
});

test('MCP: initialize, tools/list and tools/call', async () => {
  const init = await handle({ id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.serverInfo.name, 'itch-launch-kit');
  const list = await handle({ id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map(x => x.name), TOOLS.map(x => x.name));
  const r = project('mcp');
  const call = await handle({ id: 3, method: 'tools/call', params: { name: 'itch_page', arguments: { lang: 'en' } } }, { root: r, env: {} });
  assert.match(call.result.content[0].text, /VERDICT: OK/);
  assert.equal((await handle({ id: 4, method: 'nope' })).error.code, -32601);
});
