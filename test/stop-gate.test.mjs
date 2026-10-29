import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { installCommand, uninstallCommand } from '../src/install.mjs';
import { keepCommand } from '../src/cleanup.mjs';
import { doctor } from '../src/doctor.mjs';
import { main } from '../src/cli.mjs';
import { ROOT, temp } from './support.mjs';

const skip = process.platform === 'win32' && 'hook shims need a POSIX shell';
const gate = /\/(touch_hook|stop_gate)\.sh/;
const settingsOf = dir => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
const manifestOf = share => JSON.parse(readFileSync(join(share, 'install-manifest.json'), 'utf8'));
function roots(t) {
  const root = temp(t);
  return { root, dir: join(root, 'host'), share: join(root, 'share'), surfaces: join(root, 'surfaces') };
}
const hookEnv = surfaces => ({ ...process.env, LEAN_COMPUTER_USE_SURFACES: surfaces, CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: '' });
const runHook = (share, name, payload, surfaces) => spawnSync(join(share, `hooks/${name}.sh`), { input: JSON.stringify(payload), env: hookEnv(surfaces), encoding: 'utf8' });
const action = { session_id: 'session', hook_event_name: 'PostToolUse', tool_name: 'mcp__computer-use__app_click', tool_input: {}, tool_response: {} };
const stop = { session_id: 'session', hook_event_name: 'Stop', stop_hook_active: false, background_tasks: [] };
const surfaceFile = (surfaces, agent = '') => join(surfaces, `${createHash('sha256').update(agent ? `session\0${agent}` : 'session').digest('hex').slice(0, 24)}.json`);
const pythonRun = (program, args, env) => spawnSync(program, args, { env, encoding: 'utf8' });

test('install registers touch and stop gate once, runner matcher included, and uninstall removes them', { skip }, async t => {
  const { dir, share } = roots(t);
  const args = ['--dir', dir, '--share', share, '--with-hooks', '--yes'];
  for (let round = 0; round < 2; round++) assert.equal(await installCommand(args, { write() {} }), 0);
  const settings = settingsOf(dir);
  for (const [event, name, matcher] of [['PostToolUse', 'touch_hook', 'mcp__computer-use__.*|mcp__cua-driver__.*'], ['Stop', 'stop_gate', undefined], ['SubagentStop', 'stop_gate', 'desk-runner']]) {
    const entries = settings.hooks[event].filter(entry => entry.hooks.some(hook => hook.command.includes(`/${name}.sh`)));
    assert.equal(entries.length, 1, event);
    assert.equal(entries[0].matcher, matcher);
    assert.equal(entries[0].marker, 'lean-computer-use');
    assert.equal(entries[0].hooks[0].timeout, 10);
  }
  assert.equal(manifestOf(share).stopGate, true);
  assert.equal(manifestOf(share).packageVersion, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  await uninstallCommand(['--dir', dir, '--share', share], { write() {} });
  assert.equal(existsSync(join(share, 'hooks/stop_gate.sh')), false);
  assert.equal(existsSync(join(share, 'hooks/_surfaces.py')), false);
  assert.equal(existsSync(join(dir, 'settings.json')), false);
});

test('install --no-stop-gate omits the gate, keeps its files, and doctor accepts it', { skip }, async t => {
  const { dir, share, surfaces } = roots(t);
  assert.equal(await installCommand(['--dir', dir, '--share', share, '--with-hooks', '--no-stop-gate', '--yes'], { write() {} }), 0);
  assert.doesNotMatch(readFileSync(join(dir, 'settings.json'), 'utf8'), gate);
  assert.match(readFileSync(join(dir, 'settings.json'), 'utf8'), /cleanup_hook\.sh/);
  assert.equal(manifestOf(share).stopGate, false);
  assert.ok(existsSync(join(share, 'hooks/stop_gate.py')));
  const result = doctor({ dir, share }, { env: { ...process.env, LEAN_COMPUTER_USE_SURFACES: surfaces }, platform: 'linux' });
  assert.equal(result.checks.find(check => check.id === 'hooks').status, 'PASS');
});

test('reinstall with --no-stop-gate removes earlier gate registrations and keeps user hooks', { skip }, async t => {
  const { dir, share } = roots(t);
  const args = ['--dir', dir, '--share', share, '--with-hooks', '--yes'];
  await installCommand(args, { write() {} });
  const settings = settingsOf(dir);
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo mine' }] });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
  await installCommand([...args, '--no-stop-gate'], { write() {} });
  const after = readFileSync(join(dir, 'settings.json'), 'utf8');
  assert.doesNotMatch(after, gate);
  assert.match(after, /echo mine/);
  await installCommand(args, { write() {} });
  assert.match(readFileSync(join(dir, 'settings.json'), 'utf8'), gate);
});

test('installed shims gate a dirty Stop once and keep from the CLI clears it', { skip }, async t => {
  const { dir, share, surfaces } = roots(t);
  await installCommand(['--dir', dir, '--share', share, '--with-hooks', '--yes'], { write() {} });
  assert.equal(runHook(share, 'touch_hook', action, surfaces).stdout, '');
  const blocked = runHook(share, 'stop_gate', stop, surfaces);
  assert.equal(blocked.status, 0);
  const value = JSON.parse(blocked.stdout);
  assert.equal(value.decision, 'block');
  assert.match(value.reason, /release_full_control or app_release/);
  assert.match(value.reason, /npx --yes lean-computer-use keep --reason "<why>"/);
  runHook(share, 'touch_hook', { ...action, agent_id: 'a1' }, surfaces);
  const env = hookEnv(surfaces);
  assert.equal(keepCommand(['--reason', 'review', '--session', 'session'], { env, run: (program, args) => pythonRun(program, args, env) }), 0);
  assert.equal(JSON.parse(readFileSync(surfaceFile(surfaces, 'a1'), 'utf8')).surfaces.desktop.kept, true);
  runHook(share, 'touch_hook', action, surfaces);
  assert.equal(runHook(share, 'stop_gate', { ...stop, hook_event_name: 'SubagentStop', agent_type: 'desk-runner', agent_id: 'a1' }, surfaces).stdout, '');
});

test('keep forwards its options to the packaged state module and validates usage', async () => {
  const calls = [];
  const run = (program, args) => { calls.push([program, ...args]); return { status: 0 }; };
  assert.equal(keepCommand(['--reason', 'review', '--session', 'abc'], { run }), 0);
  assert.deepEqual(calls[0], ['python3', join(ROOT, 'hooks/_surfaces.py'), 'keep', '--reason', 'review', '--session', 'abc']);
  for (const args of [[], ['--session', 'abc'], ['--reason'], ['--reason', '--session'], ['--other', 'x']]) {
    assert.throws(() => keepCommand(args, { run }), error => error.exitCode === 2, JSON.stringify(args));
  }
  assert.throws(() => keepCommand(['--reason', 'x'], { run: () => ({ error: new Error('missing') }) }), error => error.exitCode === 2);
  const lines = [];
  await main(['--help'], { write: value => lines.push(value) });
  assert.match(lines[0], /keep --reason TEXT \[--session ID\]/);
  assert.match(lines[0], /--no-stop-gate/);
  assert.equal(await main(['keep', '--reason', 'x'], { cleanup: { run } }), 0);
});

test('doctor open-surfaces fails on stale held control and passes once kept or released', { skip }, async t => {
  const { dir, share, surfaces } = roots(t);
  const env = hookEnv(surfaces);
  const run = (program, args) => pythonRun(program, args, env);
  const check = () => doctor({ dir, share }, { env, platform: 'linux', run }).checks.find(item => item.id === 'open-surfaces');
  assert.equal(check().status, 'PASS');
  runHook(ROOT, 'touch_hook', action, surfaces);
  runHook(ROOT, 'touch_hook', { ...action, agent_id: 'a1' }, surfaces);
  assert.equal(check().status, 'PASS');
  for (const agent of ['', 'a1']) {
    const value = JSON.parse(readFileSync(surfaceFile(surfaces, agent), 'utf8'));
    value.surfaces.desktop.lastAction -= 660000;
    writeFileSync(surfaceFile(surfaces, agent), JSON.stringify(value));
  }
  const stale = check();
  assert.equal(stale.status, 'FAIL');
  assert.match(stale.message, /1 session\(s\)/);
  assert.match(stale.fix, /keep --reason/);
  assert.equal(keepCommand(['--reason', 'review', '--session', 'session'], { run }), 0);
  assert.equal(check().status, 'PASS');
  mkdirSync(join(surfaces, 'x'), { recursive: true });
  writeFileSync(surfaceFile(surfaces), '{malformed');
  assert.equal(check().status, 'FAIL');
});
