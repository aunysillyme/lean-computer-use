import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installCommand, uninstallCommand } from '../src/install.mjs';
import { mergeHooks, removeHooks } from '../src/hooks-register.mjs';
import { digest, shellQuote } from '../src/paths.mjs';
import { temp, write } from './support.mjs';

function fixtureSource(root) {
  const source = join(root, 'source');
  write(source, 'skills/lean-computer-use/SKILL.md', '# Sample skill\n');
  write(source, 'skills/lean-computer-use/methods/verify.md', '# Verify\n');
  write(source, 'briefs/desk-brief.md', '# Desk task brief\n');
  write(source, 'agents/desk-runner.md', 'Use __DESK_DIR__ for actions.\n');
  for (const file of ['desk', 'desk-read', 'desk-clean', '_resolve.py']) write(source, `desk/${file}`, '# sample executable\n');
  write(source, 'desk/tests/ignored.py', '# test only\n');
  write(source, 'hooks/sample.sh', '# sample hook\n');
  const hooks = { hooks: { PreToolUse: [{ matcher: 'Bash', marker: 'lean-computer-use', hooks: [{ type: 'command', command: '"__HOOKS_DIR__/sample.sh"' }] }] } };
  write(source, 'hooks/settings-snippet.json', JSON.stringify(hooks));
  return source;
}

const snapshot = root => readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
  const path = join(root, entry.name);
  return entry.isDirectory() ? [`${entry.name}/`, ...snapshot(path).map(value => `${entry.name}/${value}`)] : [`${entry.name}:${readFileSync(path).toString('base64')}:${lstatSync(path).mode & 0o777}`];
});

function setup(t) {
  const root = temp(t);
  const source = fixtureSource(root);
  const state = join(root, 'state');
  mkdirSync(state);
  const dir = join(state, 'host');
  const share = join(state, 'share');
  const args = ['--dir', dir, '--share', share];
  return { root, source, state, dir, share, args, adapters: { source, write() {} } };
}

test('installer ships desk-brief.md and records it in the manifest', async t => {
  const value = setup(t);
  await installCommand([...value.args, '--yes'], value.adapters);
  const path = 'skills/lean-computer-use/desk-brief.md';
  const content = readFileSync(join(value.source, 'briefs/desk-brief.md'));
  assert.deepEqual(readFileSync(join(value.dir, path)), content);
  const manifest = JSON.parse(readFileSync(join(value.share, 'install-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.files.filter(entry => entry.path === path), [
    { root: 'dir', path, hash: digest(content), mode: 0o644 },
  ]);
  await uninstallCommand(value.args, value.adapters);
  assert.equal(existsSync(join(value.dir, path)), false);
});

test('uninstall keeps an edited desk-brief.md and lists it', async t => {
  const value = setup(t);
  await installCommand([...value.args, '--yes'], value.adapters);
  const path = join(value.dir, 'skills/lean-computer-use/desk-brief.md');
  writeFileSync(path, 'User task details\n');
  const lines = [];
  await uninstallCommand(value.args, { ...value.adapters, write: line => lines.push(line) });
  assert.equal(readFileSync(path, 'utf8'), 'User task details\n');
  assert.ok(lines.includes(`keep: ${path} (user-edited file)`));
  assert.deepEqual(readdirSync(join(value.dir, 'skills/lean-computer-use')), ['desk-brief.md']);
});

test('desk brief replacements keep a backup and restore the original', async t => {
  const value = setup(t);
  const path = write(value.dir, 'skills/lean-computer-use/desk-brief.md', 'Original task\n');
  const before = snapshot(value.state);
  await assert.rejects(installCommand(value.args, value.adapters), /requires --yes/);
  await installCommand([...value.args, '--yes'], value.adapters);
  assert.equal(readFileSync(`${path}.bak`, 'utf8'), 'Original task\n');
  await uninstallCommand(value.args, value.adapters);
  assert.deepEqual(snapshot(value.state), before);
});

test('install then uninstall restores the temp tree', async t => {
  const value = setup(t);
  const before = snapshot(value.state);
  assert.equal(await installCommand([...value.args, '--yes', '--with-hooks'], value.adapters), 0);
  assert.equal(lstatSync(join(value.share, 'desk/desk')).mode & 0o777, 0o755);
  assert.match(readFileSync(join(value.dir, 'agents/desk-runner.md'), 'utf8'), new RegExp(value.share.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(existsSync(join(value.share, 'desk/tests')), false);
  assert.equal(existsSync(join(value.dir, 'skills/lean-computer-use/desk-brief.md')), true);
  assert.equal(await uninstallCommand(value.args, value.adapters), 0);
  assert.deepEqual(snapshot(value.state), before);
});

test('install backups restore differing files byte-for-byte and keep mode', async t => {
  const value = setup(t);
  const original = write(value.dir, 'skills/lean-computer-use/SKILL.md', 'User original\n');
  const before = snapshot(value.state);
  await installCommand([...value.args, '--yes'], value.adapters);
  assert.equal(readFileSync(`${original}.bak`, 'utf8'), 'User original\n');
  await uninstallCommand(value.args, value.adapters);
  assert.deepEqual(snapshot(value.state), before);
});

test('differing files require --yes even on an interactive input', async t => {
  const value = setup(t);
  write(value.dir, 'skills/lean-computer-use/SKILL.md', 'Existing content\n');
  const before = snapshot(value.state);
  await assert.rejects(installCommand(value.args, { ...value.adapters, input: { isTTY: true } }), /requires --yes/);
  assert.deepEqual(snapshot(value.state), before);
});

test('successive replacements preserve earlier backups and restore the latest edit', async t => {
  const value = setup(t);
  const original = write(value.dir, 'skills/lean-computer-use/SKILL.md', 'First original\n');
  await installCommand([...value.args, '--yes'], value.adapters);
  writeFileSync(original, 'Later user edit\n');
  await installCommand([...value.args, '--yes'], value.adapters);
  const manifest = JSON.parse(readFileSync(join(value.share, 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.files.find(entry => entry.path.endsWith('SKILL.md')).retainedBackups.length, 1);
  const lines = [];
  await uninstallCommand(value.args, { ...value.adapters, write: line => lines.push(line) });
  assert.equal(readFileSync(original, 'utf8'), 'Later user edit\n');
  assert.equal(readFileSync(`${original}.bak`, 'utf8'), 'First original\n');
  assert.ok(lines.some(line => line.startsWith('keep backup:')));
});

test('nested target creation cleans only the directories this install created', async t => {
  const value = setup(t);
  const args = ['--dir', join(value.state, 'settings/deeper/host'), '--share', join(value.state, 'data/deeper/share')];
  const before = snapshot(value.state);
  await installCommand([...args, '--yes'], value.adapters);
  await uninstallCommand(args, value.adapters);
  assert.deepEqual(snapshot(value.state), before);
});

test('same and overlapping host and share roots restore the initial tree', async t => {
  const value = setup(t);
  const common = join(value.state, 'common');
  const cases = [
    { dir: common, share: common },
    { dir: common, share: join(common, 'data') },
    { dir: join(common, 'host'), share: common },
  ];
  const before = snapshot(value.state);
  for (const roots of cases) {
    const args = ['--dir', roots.dir, '--share', roots.share];
    await installCommand([...args, '--yes', '--with-hooks'], value.adapters);
    await uninstallCommand(args, value.adapters);
    assert.deepEqual(snapshot(value.state), before);
  }
});

test('a forged ancestor count is rejected before unlinking files', async t => {
  const value = setup(t);
  await installCommand([...value.args, '--yes'], value.adapters);
  const path = join(value.share, 'install-manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const entry = manifest.directories.find(directory => directory.root === 'share');
  entry.path = '';
  entry.parents = manifest.anchors.share.parents;
  writeFileSync(path, JSON.stringify(manifest));
  const before = snapshot(value.state);
  await assert.rejects(uninstallCommand(value.args, value.adapters), /escapes its install anchor/);
  assert.deepEqual(snapshot(value.state), before);
});

test('installed agent and hook commands quote paths as shell arguments', async t => {
  const value = setup(t);
  const share = join(value.state, "space and 'quote $sample");
  const args = ['--dir', value.dir, '--share', share, '--with-hooks', '--yes'];
  await installCommand(args, value.adapters);
  const agent = readFileSync(join(value.dir, 'agents/desk-runner.md'), 'utf8');
  assert.ok(agent.includes(shellQuote(join(share, 'desk'))));
  const settings = JSON.parse(readFileSync(join(value.dir, 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, shellQuote(join(share, 'hooks/sample.sh')));
  await uninstallCommand(['--dir', value.dir, '--share', share], value.adapters);
});

test('uninstall keeps a user-edited file', async t => {
  const value = setup(t);
  await installCommand([...value.args, '--yes'], value.adapters);
  const path = join(value.dir, 'skills/lean-computer-use/SKILL.md');
  writeFileSync(path, 'Edited by user\n');
  await uninstallCommand(value.args, value.adapters);
  assert.equal(readFileSync(path, 'utf8'), 'Edited by user\n');
});

test('hooks merge keeps unrelated settings and is idempotent', async t => {
  const value = setup(t);
  const initial = { theme: 'light', hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo ready' }] }] } };
  write(value.dir, 'settings.json', JSON.stringify(initial));
  const before = snapshot(value.state);
  await installCommand([...value.args, '--yes', '--with-hooks'], value.adapters);
  const once = readFileSync(join(value.dir, 'settings.json'), 'utf8');
  await installCommand([...value.args, '--yes', '--with-hooks'], value.adapters);
  assert.equal(readFileSync(join(value.dir, 'settings.json'), 'utf8'), once);
  assert.equal(JSON.parse(once).hooks.PreToolUse.length, 2);
  await uninstallCommand(value.args, value.adapters);
  assert.deepEqual(snapshot(value.state), before);
});

test('edited settings lose only marked entries during uninstall', async t => {
  const value = setup(t);
  await installCommand([...value.args, '--yes', '--with-hooks'], value.adapters);
  const path = join(value.dir, 'settings.json');
  const settings = JSON.parse(readFileSync(path, 'utf8'));
  settings.theme = 'dark';
  settings.hooks.PostToolUse = [{ matcher: 'Read', hooks: [] }];
  writeFileSync(path, JSON.stringify(settings));
  await uninstallCommand(value.args, value.adapters);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { theme: 'dark', hooks: { PostToolUse: [{ matcher: 'Read', hooks: [] }] } });
});

test('dry install and uninstall write nothing and confirmation is required', async t => {
  const value = setup(t);
  const before = snapshot(value.state);
  await installCommand([...value.args, '--dry'], value.adapters);
  assert.deepEqual(snapshot(value.state), before);
  await assert.rejects(installCommand(value.args, { ...value.adapters, input: { isTTY: false } }), /confirmation/);
  assert.deepEqual(snapshot(value.state), before);
  await installCommand([...value.args, '--yes'], value.adapters);
  const installed = snapshot(value.state);
  await uninstallCommand([...value.args, '--dry-run'], value.adapters);
  assert.deepEqual(snapshot(value.state), installed);
});

test('default target and environment share root produce an exact preview', async t => {
  const value = setup(t);
  const lines = [];
  await installCommand(['--dry-run'], { ...value.adapters, env: { HOME: value.state, LEAN_COMPUTER_USE_HOME: value.share }, write: line => lines.push(line) });
  assert.ok(lines.some(line => line === `create: ${join(value.state, '.claude/agents/desk-runner.md')}`));
  assert.ok(lines.includes(`create: ${join(value.state, '.claude/skills/lean-computer-use/desk-brief.md')}`));
  assert.ok(lines.some(line => line === `create: ${join(value.share, 'desk/desk')}`));
  assert.deepEqual(snapshot(value.state), []);
});

test('preexisting identical package files stay outside uninstall ownership', async t => {
  const value = setup(t);
  const path = write(value.dir, 'skills/lean-computer-use/SKILL.md', '# Sample skill\n');
  await installCommand([...value.args, '--yes'], value.adapters);
  await uninstallCommand(value.args, value.adapters);
  assert.equal(readFileSync(path, 'utf8'), '# Sample skill\n');
});

test('uninstall rejects absent manifest, traversal, absolute entries and symlinks', async t => {
  const value = setup(t);
  await assert.rejects(uninstallCommand(value.args, value.adapters), error => error.exitCode === 2 && error.message.includes('install-manifest.json'));
  await installCommand([...value.args, '--yes'], value.adapters);
  const path = join(value.share, 'install-manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const unsafe of ['../outside', '/outside', 'desk/../outside', 'desk\\outside']) {
    writeFileSync(path, JSON.stringify({ ...manifest, files: [{ ...manifest.files[0], path: unsafe }] }));
    await assert.rejects(uninstallCommand(value.args, value.adapters));
  }
  writeFileSync(path, JSON.stringify(manifest));
  if (process.platform !== 'win32') {
    const link = join(value.root, 'linked');
    symlinkSync(value.dir, link);
    await assert.rejects(installCommand(['--dir', link, '--share', value.share, '--yes'], value.adapters), /Symlink/);
  }
});

test('hook helper removes only marker-owned entries', t => {
  const value = setup(t);
  const settings = { mode: 'safe', hooks: { PreToolUse: [{ matcher: 'Read', hooks: [] }] } };
  const merged = mergeHooks(settings, join(value.share, 'hooks'), value.source);
  assert.deepEqual(removeHooks(merged), settings);
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: 'Read', hooks: [] }]);
});
