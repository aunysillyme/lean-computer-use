#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { proofTable } from './proof-data.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' } });
  if (result.error || result.status !== 0) throw Error(`${command} ${args.join(' ')} failed (${result.status ?? result.error?.code}):\n${result.stdout || ''}${result.stderr || ''}`);
  return result.stdout;
}
export function makeRows(version, now = new Date(), values = {}) {
  const measured_at = now.toISOString(), expires_at = new Date(+now + 90 * 86400000).toISOString();
  const items = [
    ['tarball-size', 'Packed package size', values.size ?? 'unverified', 'bytes', 'npm pack --dry-run --json'],
    ['tarball-files', 'Packed file count', values.files ?? 'unverified', 'files', 'npm pack --dry-run --json'],
    ['runtime-dependencies', 'Runtime dependencies', values.dependencies ?? 0, 'packages', 'node -p "Object.keys(require(\'./package.json\').dependencies || {}).length"'],
    ['node-tests', 'Node test cases passed', values.node ?? 'unverified', 'cases', 'node --test'],
    ['python-tests', 'Python test cases passed', values.python ?? 'unverified', 'cases', 'python3 -m pytest -q desk/tests hooks/tests'],
    ['measure-fixture', 'Fixture main median', values.median ?? 200, 'tokens', 'node bin/lean-computer-use.mjs measure --projects-dir test/fixtures/transcripts --json'],
    ['desk-exits', 'Documented desk exits covered', values.exits ?? 'unverified', 'exit codes', 'python3 -m pytest -q desk/tests'],
  ];
  return items.map(([id, claim, value, unit, command]) => ({ id, claim, value, unit, command, measured_at, expires_at, measured: measured_at, expires: expires_at, package_version: version, subject: 'package' }));
}
export function saveRows(rows) {
  mkdirSync(join(ROOT, 'proof'), { recursive: true });
  writeFileSync(join(ROOT, 'proof/results.json'), JSON.stringify(rows, null, 2) + '\n');
  const readme = join(ROOT, 'README.md');
  if (existsSync(readme)) {
    const original = readFileSync(readme, 'utf8');
    const table = proofTable(rows.filter(row => ['runtime-dependencies', 'measure-fixture', 'desk-exits'].includes(row.id)));
    writeFileSync(readme, original.replace(/<!-- proof:start -->[\s\S]*?<!-- proof:end -->/, table));
  }
}
export function packRecord(output) {
  const parsed = JSON.parse(output);
  const pack = Array.isArray(parsed) ? parsed[0] : parsed['lean-computer-use'];
  if (!pack || !Array.isArray(pack.files) || typeof pack.size !== 'number') throw Error('npm pack returned no package record.');
  return pack;
}
export function packMetrics() {
  const parent = join(ROOT, 'test/.scratch');
  mkdirSync(parent, { recursive: true });
  writeFileSync(join(parent, '.gitignore'), '*\n');
  const cache = mkdtempSync(join(parent, 'npm-cache-'));
  try {
    const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--offline', '--cache', cache], { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw Error(`npm pack failed (${result.status}): ${result.stdout}${result.stderr}`);
    const pack = packRecord(result.stdout);
    if (pack.files.some(file => /^\.repo-build\/|(?:^|\/)private\.local\.txt$|^(?:test|proof)\/|(?:^|\/)tests\//.test(file.path))) throw Error('Package allowlist includes a private or test artifact.');
    if (pack.size > 300000 || pack.unpackedSize > 1000000) throw Error('Package byte budget exceeded.');
    return pack;
  } finally { rmSync(cache, { recursive: true, force: true }); }
}
export async function main(args = []) {
  if (args.some(arg => !['--record', '--deterministic', '--node-passes', '--python-passes'].includes(arg) && !/^\d+$|^unverified$/.test(arg))) throw Error('Usage: proof [--deterministic | --record --node-passes N --python-passes N|unverified]');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const arg = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const previousPath = join(ROOT, 'proof/results.json');
  const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : [];
  const values = { dependencies: Object.keys(pkg.dependencies || {}).length };
  // Rows are written only after the suite has run: the suite validates the saved rows, so placeholders must never reach disk first.
  if (args.includes('--deterministic')) {
    values.node = previous.find(row => row.id === 'node-tests')?.value ?? 'unverified';
    values.python = previous.find(row => row.id === 'python-tests')?.value ?? 'unverified';
  } else if (args.includes('--record')) {
    const count = arg('--node-passes');
    if (!/^\d+$/.test(count || '')) throw Error('--record requires an observed --node-passes count.');
    values.node = Number(count);
    const python = arg('--python-passes');
    values.python = /^\d+$/.test(python || '') ? Number(python) : 'unverified';
  } else {
    const output = run(process.execPath, ['--test']);
    const passed = output.match(/# pass (\d+)/);
    if (!passed) throw Error('Node test output did not contain a pass count.');
    values.node = Number(passed[1]);
    const probe = spawnSync('python3', ['-c', 'import pytest'], { encoding: 'utf8' });
    if (probe.status === 0) {
      const pythonOutput = run('python3', ['-m', 'pytest', '-q', 'desk/tests', 'hooks/tests']);
      const pythonPassed = pythonOutput.match(/(\d+) passed/);
      if (!pythonPassed) throw Error('Python test output did not contain a pass count.');
      values.python = Number(pythonPassed[1]);
    } else values.python = 'unverified';
  }
  const result = JSON.parse(run(process.execPath, ['bin/lean-computer-use.mjs', 'measure', '--projects-dir', 'test/fixtures/transcripts', '--json']));
  if (result.main.median !== 200) throw Error('Fixture median differs from the hand-computed expected 200.');
  values.median = result.main.median;
  // Exit rows are receipts only after the Python suite actually passed.
  const exitRows = JSON.parse(readFileSync(join(ROOT, 'desk/exit-codes.json'), 'utf8'));
  const deskTests = readFileSync(join(ROOT, 'desk/tests/test_desk.py'), 'utf8');
  if (!exitRows.every(row => deskTests.includes(`def ${row.test}(`))) throw Error('A documented desk exit has no named test.');
  values.exits = typeof values.python === 'number' ? exitRows.length : 'unverified';
  saveRows(makeRows(pkg.version, new Date(), values));
  const pack = packMetrics(); values.size = pack.size; values.files = pack.files.length;
  const rows = makeRows(pkg.version, new Date(), values);
  if (args.includes('--deterministic')) {
    for (const id of ['node-tests', 'python-tests', 'desk-exits']) {
      const old = previous.find(row => row.id === id);
      const index = rows.findIndex(row => row.id === id);
      if (old) rows[index] = old;
    }
  }
  saveRows(rows);
  console.log(JSON.stringify({ node: values.node, python: values.python, bytes: values.size, files: values.files, median: values.median }));
  return rows;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
