import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packRecord } from '../scripts/proof.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, temp, write } from './support.mjs';

test('package metrics accept npm array and package-keyed output', () => {
  const record = { size: 100, files: [{ path: 'README.md' }] };
  assert.deepEqual(packRecord(JSON.stringify([record])), record);
  assert.deepEqual(packRecord(JSON.stringify({ 'lean-computer-use': record })), record);
  assert.throws(() => packRecord('{}'), /no package record/);
});

test('README shows the trailer directly after install within its first thirty lines', () => {
  const opening = readFileSync(join(ROOT, 'README.md'), 'utf8').split('\n').slice(0, 30).join('\n');
  assert.ok(opening.includes('```sh\nnpx lean-computer-use\n```\n\n![lean-computer-use: background Mac computer control for AI agents, a 14-second look at the desk commands, the saved read and the cleanup proof](docs/trailer.gif)'));
  assert.ok(existsSync(join(ROOT, 'docs/trailer.gif')));
});

test('packed package installs offline, runs commands and uninstalls its files', t => {
  const root = temp(t);
  const env = { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_cache: join(root, 'cache'), LEAN_COMPUTER_USE_HOME: join(root, 'home/.local/share/lean-computer-use'), HOME: join(root, 'home') };
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const run = (command, args, cwd = root) => {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, shell: process.platform === 'win32' && command === npm });
    assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const pack = packRecord(run(npm, ['pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', root], ROOT));
  assert.ok(pack.files.every(file => !file.path.endsWith('.gif')), 'GIF files stay outside the npm package');
  assert.ok(pack.files.every(file => !file.path.startsWith('website/')), 'Website files stay outside the npm package');
  assert.ok(pack.size <= 300000 && pack.unpackedSize <= 1000000);
  assert.ok(pack.files.every(file => !/^\.repo-build\/|^(?:test|proof)\/|(?:^|\/)tests\//.test(file.path)));
  // npm 10 matches a bare "*.md" at any depth and npm 12 only at the root, so every nested file must be named by its own entry.
  const entries = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).files.filter(entry => entry !== '*.md');
  const named = path => entries.some(entry => entry.endsWith('/') ? path.startsWith(entry)
    : new RegExp(`^${entry.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(path));
  assert.deepEqual(pack.files.map(file => file.path).filter(path => path.includes('/') && !named(path)), []);
  assert.ok(pack.files.some(file => file.path === 'hooks/README.md'));
  write(root, 'package.json', '{"private":true}');
  run(npm, ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', join(root, pack.filename)]);
  const binary = join(root, 'node_modules/lean-computer-use/bin/lean-computer-use.mjs');
  const plan = run(process.execPath, [binary, 'install', '--dry-run', '--yes']);
  assert.ok(plan.includes('Install plan') && plan.includes('manifest:'));
  run(process.execPath, [binary, 'install', '--yes']);
  const measured = JSON.parse(run(npm, ['exec', '--offline', '--no', '--', 'lean-computer-use', 'measure', '--projects-dir', join(ROOT, 'test/fixtures/transcripts'), '--json']));
  assert.equal(measured.main.median, 200);
  const doctorEnv = { ...env };
  if (process.platform !== 'win32') {
    const fakeBin = join(root, 'fake-bin');
    for (const name of ['python3', 'osascript', 'cua-driver']) {
      const script = write(root, `fake-bin/${name}`, '#!/bin/sh\ncase "$1 $2" in\n  "permissions status") echo \'{"accessibility":true,"screen_recording":true}\' ;;\n  "telemetry status") echo disabled ;;\n  *) echo ready ;;\nesac\n');
      chmodSync(script, 0o755);
    }
    doctorEnv.PATH = fakeBin + ':' + env.PATH;
  }
  const doctor = spawnSync(npm, ['exec', '--offline', '--no', '--', 'lean-computer-use', 'doctor', '--json'], { cwd: root, env: doctorEnv, encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' });
  assert.ok([0, 1].includes(doctor.status));
  const result = JSON.parse(doctor.stdout);
  assert.equal(result.checks.find(check => check.id === 'installed-files').status, 'PASS');
  run(process.execPath, [binary, 'uninstall']);
  assert.ok(!existsSync(env.HOME) || readdirSync(env.HOME).length === 0);
});
