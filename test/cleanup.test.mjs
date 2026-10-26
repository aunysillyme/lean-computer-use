import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installCommand, uninstallCommand } from '../src/install.mjs';
import { hooksRegistered } from '../src/hooks-register.mjs';
import { reapCommand } from '../src/cleanup.mjs';
import { doctor } from '../src/doctor.mjs';
import { main } from '../src/cli.mjs';
import { ROOT, temp } from './support.mjs';

const skip = process.platform === 'win32' && 'process tools need a POSIX ps';
const events = ['SubagentStop', 'Stop', 'SessionEnd'];

test('installer registers the cleanup hooks once, keeps user hooks, and uninstall removes only ours', { skip }, async t => {
  const root = temp(t), dir = join(root, 'host'), share = join(root, 'share');
  mkdirSync(dir);
  const user = { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } };
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(user));
  const args = ['--dir', dir, '--share', share, '--with-hooks', '--yes'];
  await installCommand(args, { write() {} });
  const first = readFileSync(join(dir, 'settings.json'), 'utf8');
  const settings = JSON.parse(first);
  for (const event of events) {
    const ours = settings.hooks[event].filter(entry => entry.marker === 'lean-computer-use' && entry.hooks.some(hook => hook.command.includes('cleanup_hook.sh')));
    assert.equal(ours.length, 1, event);
    assert.ok(ours[0].hooks[0].timeout >= 10);
  }
  assert.equal(settings.hooks.SubagentStop[0].matcher, 'desk-runner');
  assert.ok(settings.hooks.Stop.some(entry => entry.hooks[0].command === 'echo mine'));
  assert.ok(statSync(join(share, 'hooks/cleanup_hook.sh')).mode & 0o100);
  assert.ok(statSync(join(share, 'desk/desk-reap')).mode & 0o100);
  assert.ok(hooksRegistered(settings, join(share, 'hooks')));
  await installCommand(args, { write() {} });
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), first);
  await uninstallCommand(['--dir', dir, '--share', share], { write() {} });
  const after = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
  assert.deepEqual(after, user);
  assert.equal(existsSync(join(share, 'desk/desk-reap')), false);
});

test('cleanup and spawn run the packaged reaper and return its exit code', async t => {
  const calls = [];
  const run = (program, args) => { calls.push([program, ...args]); return { status: 7 }; };
  assert.equal(reapCommand('cleanup', ['--apply'], { run }), 7);
  assert.deepEqual(calls[0], ['python3', join(ROOT, 'desk/desk-reap'), 'cleanup', '--apply']);
  assert.equal(reapCommand('spawn', ['--', 'true'], { run: () => ({ status: null }) }), 1);
  assert.throws(() => reapCommand('cleanup', [], { run: () => ({ error: new Error('missing') }) }), error => error.exitCode === 2);
  const lines = [];
  assert.equal(await main(['cleanup', '--apply'], { write: value => lines.push(value), cleanup: { run } }), 7);
});

test('end to end: spawn leases a fake driver, doctor reports it, cleanup ends it', { skip: skip || spawnSync('node', ['--version']).status !== 0 }, async t => {
  const root = temp(t), leases = join(root, 'leases'), bin = join(root, 'bin');
  mkdirSync(bin);
  symlinkSync(realpathSync(process.execPath), join(bin, 'cua-driver'));
  const env = { ...process.env, LEAN_COMPUTER_USE_LEASES: leases, HOME: root };
  delete env.CLAUDE_CODE_SESSION_ID;
  const reaper = join(ROOT, 'desk/desk-reap');
  const call = (...args) => spawnSync('python3', [reaper, ...args], { env, encoding: 'utf8', timeout: 30000 });
  const started = call('spawn', '--session', 'S1', '--', join(bin, 'cua-driver'), '-e', 'setTimeout(()=>{},120000)', '--', 'serve');
  assert.equal(started.status, 0, started.stderr);
  const pid = Number(/pid=(\d+)/.exec(started.stdout)[1]);
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } });
  const result = doctor({ dir: join(root, 'host'), share: join(root, 'share') }, { env, platform: 'linux', run: (program, args) => spawnSync(program, args, { env, encoding: 'utf8' }) });
  const check = result.checks.find(item => item.id === 'leftover-processes');
  assert.equal(check.status, 'FAIL'); assert.match(check.message, /cua-driver pid \d+/);
  const cleaned = call('cleanup', '--apply', '--all');
  assert.equal(cleaned.status, 0, cleaned.stdout + cleaned.stderr);
  assert.equal(cleaned.stdout.trim(), 'cleanup: ended=cua-driver:1 left=0');
  const again = doctor({ dir: join(root, 'host'), share: join(root, 'share') }, { env, platform: 'linux', run: (program, args) => spawnSync(program, args, { env, encoding: 'utf8' }) });
  assert.equal(again.checks.find(item => item.id === 'leftover-processes').status, 'PASS');
});

test('doctor runs no extra command when no lease exists', { skip }, t => {
  const root = temp(t), calls = [];
  const env = { ...process.env, LEAN_COMPUTER_USE_LEASES: join(root, 'none') };
  const result = doctor({ dir: join(root, 'host'), share: join(root, 'share') }, { env, platform: 'linux', run: (program) => { calls.push(program); return { status: 0, stdout: 'ready', stderr: '' }; } });
  assert.deepEqual(calls, ['python3']);
  assert.equal(result.checks.find(item => item.id === 'leftover-processes').status, 'PASS');
});

test('doctor fails when a leased process is running but refused', { skip }, t => {
  const root = temp(t), leases = join(root, 'leases');
  mkdirSync(leases);
  writeFileSync(join(leases, '0123456789abcdef.json'), '{}');
  const env = { ...process.env, LEAN_COMPUTER_USE_LEASES: leases };
  const answer = JSON.stringify({ candidates: [], refused: [{ id: 'x', pid: 42, reason: 'a browser is never ended here' }] });
  const result = doctor({ dir: join(root, 'host'), share: join(root, 'share') }, { env, platform: 'linux', run: program => program === 'python3' ? { status: 0, stdout: answer, stderr: '' } : { status: 0, stdout: '', stderr: '' } });
  const check = result.checks.find(item => item.id === 'leftover-processes');
  assert.equal(check.status, 'FAIL'); assert.match(check.message, /pid 42 \(a browser is never ended here\)/);
});
