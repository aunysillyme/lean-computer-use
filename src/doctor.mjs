import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { locations, payloadFiles, safePath, digest, packageRoot } from './paths.mjs';
import { hooksRegistered } from './hooks-register.mjs';

/** Leased processes that are still running: nothing is spawned unless a lease file exists. */
/** @returns {[string, string, string, string]} */
function leftovers(env, source, run) {
  const id = 'leftover-processes', fix = 'Run lean-computer-use cleanup --apply.';
  const directory = env.LEAN_COMPUTER_USE_LEASES || join(env.XDG_STATE_HOME || join(env.HOME || homedir(), '.local/state'), 'lean-computer-use/leases');
  try {
    if (!existsSync(directory) || !readdirSync(directory).some(name => /^[0-9a-f]{16}\.json$/.test(name))) return [id, 'PASS', 'no leased processes are running', fix];
    const reaper = join(source, 'desk/desk-reap');
    if (!existsSync(reaper)) return [id, 'PASS', 'no leased processes are running', fix];
    const result = run('python3', [reaper, 'cleanup', '--all', '--json']);
    let value;
    try { value = JSON.parse(result.stdout); } catch { return [id, 'FAIL', 'leased processes exist but the process list could not be read', fix]; }
    const live = value.candidates || [], refused = value.refused || [];
    if (!live.length && refused.length) return [id, 'FAIL', `${refused.length} leased process(es) are running but cannot be proven safe to end: ${refused.map(r => `pid ${r.pid} (${r.reason})`).join('; ')}`, fix];
    if (!live.length) return [id, 'PASS', 'no leased processes are running', fix];
    const age = seconds => seconds < 90 ? `${seconds}s` : seconds < 5400 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`;
    return [id, 'FAIL', `leftover leased processes: ${live.map(c => `${c.name} pid ${c.pid} (${c.processes} processes, age ${age(c.age_seconds)})`).join('; ')}`, fix];
  } catch { return [id, 'FAIL', 'the lease list could not be read, so leftover processes could not be checked', fix]; }
}

/** @param {{dir?: string, share?: string}} options @param {Record<string, any>} adapters */
export function doctor(options = {}, adapters = {}) {
  const env = adapters.env || process.env;
  const platform = adapters.platform || process.platform;
  const version = adapters.nodeVersion || process.versions.node;
  const source = adapters.source || packageRoot;
  const roots = locations(options, env);
  const run = adapters.run || ((command, args) => spawnSync(command, args, { env, encoding: 'utf8', timeout: 5000, windowsHide: true }));
  const checks = [];
  const add = (id, status, message, fix) => checks.push({ id, status, message, fix });
  const command = (name, args) => {
    try { return run(name, args); } catch (error) { return { status: null, stdout: '', stderr: error.message, error }; }
  };
  const text = result => `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const node = Number.parseInt(version.split('.')[0], 10);
  add('platform', platform === 'darwin' ? 'PASS' : 'WARN', platform === 'darwin' ? 'macOS native control supported' : 'skipped: macOS only', 'Run native control on macOS.');
  add('node', node >= 22 ? 'PASS' : 'FAIL', `Node ${version}`, 'Use Node 22 or newer.');
  const python = command('python3', ['--version']);
  add('python', python.status === 0 ? 'PASS' : 'FAIL', python.status === 0 ? text(python) : 'python3 is unavailable', 'Install Python 3 and put python3 on PATH.');
  if (platform !== 'darwin') {
    for (const id of ['osascript', 'driver', 'daemon', 'permissions', 'telemetry']) add(id, 'WARN', 'skipped: macOS only', 'Run this check on macOS.');
  } else {
    const script = command('osascript', ['-e', 'return "ready"']);
    add('osascript', script.status === 0 ? 'PASS' : 'FAIL', script.status === 0 ? 'osascript is available' : 'osascript is unavailable', 'Restore the macOS osascript command on PATH.');
    const driver = command('cua-driver', ['--version']);
    add('driver', driver.status === 0 ? 'PASS' : 'FAIL', driver.status === 0 ? text(driver) : 'cua-driver is unavailable', 'Follow docs/cua-driver-install.md and put cua-driver on PATH.');
    const daemon = command('cua-driver', ['status']);
    const stopped = /\b(stopped|not running|inactive|disconnected)\b/i.test(text(daemon));
    add('daemon', daemon.status === 0 && !stopped ? 'PASS' : 'WARN', daemon.status === 0 && !stopped ? 'daemon is running' : 'daemon is stopped; desk starts it on demand', 'Run desk when native control is needed.');
    const permissions = command('cua-driver', ['permissions', 'status', '--json']);
    let granted = false;
    try {
      const value = JSON.parse(permissions.stdout);
      const state = value.permissions || value;
      granted = permissions.status === 0 && state.accessibility === true && state.screen_recording === true;
    } catch { /* An unreadable status is a failed permission check. */ }
    add('permissions', granted ? 'PASS' : 'FAIL', granted ? 'Accessibility and Screen Recording are granted' : 'Accessibility or Screen Recording needs approval', 'Run cua-driver permissions grant, approve both permissions, then rerun doctor.');
    const telemetry = command('cua-driver', ['telemetry', 'status']);
    let disabled = telemetry.status === 0 && /\bdisabled\b/i.test(text(telemetry));
    try {
      const value = JSON.parse(telemetry.stdout);
      disabled = telemetry.status === 0 && (value.enabled === false || value.telemetry === false || value.status === 'disabled');
    } catch { /* Text status is also supported. */ }
    add('telemetry', disabled ? 'PASS' : 'WARN', disabled ? 'telemetry is disabled' : 'telemetry status needs attention', 'Run cua-driver telemetry disable, then cua-driver telemetry status.');
  }
  try {
    const payload = payloadFiles(roots, source).filter(file => file.root === 'dir' || file.path.startsWith('desk/'));
    const missing = payload.filter(file => {
      try {
        const path = safePath(roots[file.root], file.path);
        return !existsSync(path) || digest(readFileSync(path)) !== digest(file.content);
      } catch { return true; }
    });
    add('installed-files', missing.length ? 'FAIL' : 'PASS', missing.length ? `${missing.length} installed files are missing or changed` : 'skill, agent and desk files match the package', 'Run lean-computer-use install --yes with the same --dir and --share.');
  } catch (error) {
    add('installed-files', 'FAIL', `Package files cannot be checked: ${error.message}`, 'Reinstall the npm package, then run lean-computer-use install --yes.');
  }
  try {
    const path = safePath(roots.dir, 'settings.json');
    const settings = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    const registered = hooksRegistered(settings, join(roots.share, 'hooks'), source);
    add('hooks', registered ? 'PASS' : 'WARN', registered ? 'optional hooks are registered' : 'optional hooks are not registered', 'Run lean-computer-use install --with-hooks --yes with the same --dir and --share.');
  } catch {
    add('hooks', 'WARN', 'optional hook registration could not be read', 'Review settings.json, then run lean-computer-use install --with-hooks --yes.');
  }
  const [leftId, leftStatus, leftMessage, leftFix] = leftovers(env, source, run);
  add(leftId, leftStatus, leftMessage, leftFix);
  return { checks, exitCode: checks.some(check => check.status === 'FAIL') ? 1 : 0 };
}

/** @param {string[]} args @param {Record<string, any>} adapters */
export function doctorCommand(args = [], adapters = {}) {
  const options = { json: false };
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else throw Object.assign(new Error(`Unknown option: ${arg}`), { exitCode: 2 });
  }
  const result = doctor(adapters.options || {}, adapters);
  const write = adapters.write || console.log;
  if (options.json) write(JSON.stringify(result, null, 2));
  else for (const check of result.checks) write(`${check.status} ${check.id}: ${check.message}; fix: ${check.fix}`);
  return result.exitCode;
}
