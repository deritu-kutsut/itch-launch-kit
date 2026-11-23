// Small runtime: results with a verdict, process runner, cross-process lock and text output.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, unlinkSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export class UsageError extends Error { }

/** A result every command returns: verdict OK | PARTIAL | FAIL, a short reason, lines (most important first) and data. */
const make = (verdict, reason, lines = [], data = {}) => ({ verdict, reason, lines, data });
export const ok = (r, l, d) => make('OK', r, l, d);
export const partial = (r, l, d) => make('PARTIAL', r, l, d);
export const fail = (r, l, d) => make('FAIL', r, l, d);

export const HOME_DIR = join(homedir(), '.itchkit');

/** Runs a program without a shell. Never throws: { code, output, ms, timedOut }; code -1 = could not start. */
export function run(cmd, args = [], { cwd = process.cwd(), ms = 540000, env = {}, maxBuffer = 400000 } = {}) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let output = '', timedOut = false, child;
    const add = d => { output += d; if (output.length > maxBuffer * 2) output = output.slice(-maxBuffer); };
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, output: `Could not run ${cmd}: ${e.message}`, ms: 0, timedOut: false });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    }, ms);
    child.stdout.setEncoding('utf8').on('data', add);
    child.stderr.setEncoding('utf8').on('data', add);
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, output: `Could not run ${cmd}: ${e.message}`, ms: Date.now() - t0, timedOut }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code: timedOut ? 124 : (code ?? -1), output: output.slice(-maxBuffer), ms: Date.now() - t0, timedOut }); });
    child.stdin.end();
  });
}

/** Runs fn while holding a lock file, so two agents never push at the same time. Stale locks (> 2 h) are taken over. */
export async function withLock(name, fn, { dir = join(tmpdir(), 'itchkit-locks'), waitMs = 600000, staleMs = 7200000 } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.lock`);
  const t0 = Date.now();
  for (;;) {
    try { closeSync(openSync(file, 'wx')); break; } catch {
      try { if (Date.now() - statSync(file).mtimeMs > staleMs) { unlinkSync(file); continue; } } catch { continue; }
      if (Date.now() - t0 > waitMs) throw new Error(`another push holds the lock ${file}`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  try { return await fn(); } finally { try { unlinkSync(file); } catch { /* already gone */ } }
}

/** Text for humans and agents: at most maxLines lines, the last one is always "VERDICT: …". The rest goes to a log file. */
export function toText(result, t, { maxLines = 15, logDir = join(HOME_DIR, 'logs'), save = true } = {}) {
  const body = result.lines.map(String);
  const verdict = `${t('verdict')}: ${t(result.verdict.toLowerCase())} ${result.reason}`.trim();
  if (body.length < maxLines) return [...body, verdict].join('\n');
  let tail = [];
  if (save) {
    try {
      mkdirSync(logDir, { recursive: true });
      const path = join(logDir, `itchkit_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
      writeFileSync(path, [...body, verdict].join('\n'));
      tail = [t('fullOutput', { path })];
    } catch { /* no log, still print */ }
  }
  return [...body.slice(0, maxLines - 1 - tail.length), ...tail, verdict].join('\n');
}

export const toJson = result => JSON.stringify(result);
export const exitCode = result => (result.verdict === 'FAIL' ? 1 : 0);
