import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chmodSync, writeFileSync } from 'node:fs';
import { doctor, doctorCommand } from '../src/doctor.mjs';
import { installCommand } from '../src/install.mjs';
import { temp, write } from './support.mjs';

async function setup(t) {
  const root = temp(t);
  const source = join(root, 'source');
  write(source, 'skills/lean-computer-use/SKILL.md', '# Sample\n');
  write(source, 'briefs/desk-brief.md', '# Desk task brief\n');
  write(source, 'agents/desk-runner.md', 'Use __DESK_DIR__.\n');
  write(source, 'desk/desk', '# sample\n');
  write(source, 'hooks/settings-snippet.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', marker: 'lean-computer-use', hooks: [] }] } }));
  const options = { dir: join(root, 'host'), share: join(root, 'share') };
  await installCommand(['--dir', options.dir, '--share', options.share, '--yes', '--with-hooks'], { source, write() {} });
  return { root, source, options };
}

function goodRun(name, args) {
  const key = `${name} ${args.join(' ')}`;
  return { status: 0, stderr: '', stdout: key.includes('permissions') ? '{"accessibility":true,"screen_recording":true}' : key.includes('telemetry') ? 'Telemetry disabled' : 'ready' };
}

test('doctor passes installed files and macOS capabilities', async t => {
  const value = await setup(t);
  const result = doctor(value.options, { ...value, platform: 'darwin', nodeVersion: '22.0.0', run: goodRun });
  assert.equal(result.exitCode, 0);
  assert.equal(result.checks.every(check => check.status === 'PASS'), true);
  assert.equal(result.checks.every(check => check.fix.length > 0), true);
});

test('doctor checks package files on other platforms and skips driver commands', async t => {
  const value = await setup(t);
  const calls = [];
  const result = doctor(value.options, { ...value, platform: 'linux', run: (name, args) => { calls.push(name); return goodRun(name, args); } });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, ['python3']);
  assert.equal(result.checks.find(check => check.id === 'installed-files').status, 'PASS');
  assert.equal(result.checks.find(check => check.id === 'driver').message, 'skipped: macOS only');
});

test('doctor command checks explicit install roots', async t => {
  const value = await setup(t);
  const lines = [];
  const result = doctorCommand(['--dir', value.options.dir, '--share', value.options.share, '--json'], {
    source: value.source, platform: 'linux', run: goodRun, write: line => lines.push(line)
  });
  assert.equal(result, 0);
  assert.equal(JSON.parse(lines[0]).checks.find(check => check.id === 'installed-files').status, 'PASS');
  assert.throws(() => doctorCommand(['--dir']), /Missing value for --dir/);
});

test('doctor fails missing runtime, permissions and changed installed files', async t => {
  const value = await setup(t);
  writeFileSync(join(value.options.dir, 'agents/desk-runner.md'), 'user edited\n');
  const result = doctor(value.options, { ...value, platform: 'darwin', nodeVersion: '20.0.0', run: () => ({ status: 1, stdout: '', stderr: '' }) });
  for (const id of ['node', 'python', 'osascript', 'driver', 'permissions', 'installed-files']) assert.equal(result.checks.find(check => check.id === id).status, 'FAIL', id);
  assert.equal(result.exitCode, 1);
  assert.match(result.checks.find(check => check.id === 'daemon').message, /desk starts it on demand/);
});

test('doctor warns for enabled telemetry and optional unregistered hooks', async t => {
  const value = await setup(t);
  writeFileSync(join(value.options.dir, 'settings.json'), '{}');
  const result = doctor(value.options, { ...value, platform: 'darwin', run: (name, args) => args[0] === 'telemetry' ? { status: 0, stdout: 'enabled' } : goodRun(name, args) });
  assert.equal(result.exitCode, 0);
  assert.equal(result.checks.find(check => check.id === 'telemetry').status, 'WARN');
  assert.equal(result.checks.find(check => check.id === 'hooks').status, 'WARN');
  const lines = [];
  assert.equal(doctorCommand(['--json'], { ...value, options: value.options, platform: 'linux', run: goodRun, write: value => lines.push(value) }), 0);
  assert.ok(Array.isArray(JSON.parse(lines[0]).checks));
});

test('doctor external commands resolve from injected PATH', { skip: process.platform === 'win32' }, async t => {
  const value = await setup(t);
  const directory = join(value.root, 'commands');
  const fake = `#!/usr/bin/env node\nconst args=process.argv.slice(2).join(' '); console.log(args.includes('permissions')?'{}':args.includes('telemetry')?'disabled':'fake-ready');\n`;
  for (const name of ['python3', 'osascript', 'cua-driver']) chmodSync(write(directory, name, fake), 0o755);
  const result = doctor(value.options, { ...value, platform: 'darwin', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } });
  assert.equal(result.checks.find(check => check.id === 'driver').message, 'fake-ready');
  assert.equal(result.checks.find(check => check.id === 'permissions').status, 'FAIL');
});
