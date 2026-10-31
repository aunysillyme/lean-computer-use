import { existsSync, readFileSync, writeFileSync, lstatSync, chmodSync, unlinkSync, rmdirSync, readdirSync, openSync, closeSync, renameSync, fsyncSync, constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { locations, safePath, safeRelative, ensureDirectory, payloadFiles, digest, packageRoot, shellQuote } from './paths.mjs';
import { mergeHooks, removeHooks } from './hooks-register.mjs';

const manifestName = 'install-manifest.json';
const format = value => `${JSON.stringify(value, null, 2)}\n`;
const hashFile = path => digest(readFileSync(path));
const fail = (message, exitCode = 2) => Object.assign(new Error(message), { exitCode });

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw fail(`Invalid ${label} JSON: ${path}. Repair the file before continuing.`); }
}

function captureAnchors(roots) {
  return Object.fromEntries(Object.entries(roots).map(([root, target]) => {
    let path = target;
    let parents = 0;
    while (!existsSync(path)) { path = dirname(path); parents++; }
    safePath(path);
    const stat = lstatSync(path);
    if (!stat.isDirectory()) throw fail(`Expected a directory: ${path}`);
    return [root, { parents, identity: { dev: stat.dev, ino: stat.ino } }];
  }));
}

export function parseInstallArgs(args) {
  /** @type {Record<string, any>} */
  const options = { yes: false, dryRun: false, withHooks: false, noStopGate: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--dry-run' || arg === '--dry') options.dryRun = true;
    else if (arg === '--with-hooks') options.withHooks = true;
    else if (arg === '--no-stop-gate') options.noStopGate = true;
    else if (arg === '--dir' || arg === '--share') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw fail(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else throw fail(`Unknown option: ${arg}`);
  }
  return options;
}

function validEntry(entry) {
  if (!entry || !['dir', 'share'].includes(entry.root)) throw fail('Invalid manifest root');
  safeRelative(entry.path);
  const allowed = entry.root === 'dir'
    ? entry.path.startsWith('skills/lean-computer-use/') || entry.path === 'agents/desk-runner.md' || entry.path === 'settings.json'
    : entry.path.startsWith('desk/') || entry.path.startsWith('hooks/');
  if (!allowed || !/^[a-f0-9]{64}$/.test(entry.hash)) throw fail('Invalid manifest entry');
  if (entry.priorHash !== undefined && !/^[a-f0-9]{64}$/.test(entry.priorHash)) throw fail('Invalid prior manifest hash');
  if (entry.retainedBackups && !Array.isArray(entry.retainedBackups)) throw fail('Invalid retained backups');
  for (const backup of [entry.backup, ...(entry.retainedBackups || [])].filter(Boolean)) {
    safeRelative(backup.path);
    if (!backup.path.startsWith(`${entry.path}.bak`) || !/^[a-f0-9]{64}$/.test(backup.hash)) throw fail('Invalid manifest backup');
  }
}

function directoryPath(roots, directory) {
  if (!directory.parents) return safePath(roots[directory.root], directory.path);
  if (directory.path || !Number.isInteger(directory.parents) || directory.parents < 1 || directory.parents > 64) throw fail('Invalid manifest parent directory');
  let path = roots[directory.root];
  for (let index = 0; index < directory.parents; index++) {
    const parent = dirname(path);
    if (parent === path || dirname(parent) === parent) throw fail('Filesystem root is not an install directory');
    path = parent;
  }
  return safePath(path);
}

function validStaging(stage) {
  validEntry({ root: stage.root, path: stage.original, hash: stage.hash });
  safeRelative(stage.target);
  safeRelative(stage.path);
  const backup = stage.target === `${stage.original}.bak` || stage.target.startsWith(`${stage.original}.bak.`) && /^\d+$/.test(stage.target.slice(`${stage.original}.bak.`.length));
  const temporary = stage.path.startsWith(stage.target) && /^\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.tmp$/.test(stage.path.slice(stage.target.length));
  if (!temporary || stage.kind !== 'payload' && stage.kind !== 'backup' || stage.kind === 'payload' && stage.target !== stage.original || stage.kind === 'backup' && !backup) throw fail('Invalid install staging entry');
}

export function readManifest(roots) {
  const path = safePath(roots.share, manifestName);
  if (!existsSync(path)) return null;
  const manifest = readJson(path, 'manifest');
  if (manifest.version !== 1 || manifest.roots?.dir !== roots.dir || manifest.roots?.share !== roots.share || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories)) throw fail(`Invalid install manifest: ${path}`);
  if (manifest.state !== undefined && manifest.state !== 'pending') throw fail('Invalid install state');
  for (const root of ['dir', 'share']) {
    const anchor = manifest.anchors?.[root];
    if (!anchor || !Number.isInteger(anchor.parents) || anchor.parents < 0 || anchor.parents > 64 || typeof anchor.identity?.dev !== 'number' || typeof anchor.identity?.ino !== 'number') throw fail('Invalid install anchor');
    let anchorPath = roots[root];
    for (let index = 0; index < anchor.parents; index++) {
      if (dirname(anchorPath) === anchorPath) throw fail('Invalid install anchor depth');
      anchorPath = dirname(anchorPath);
    }
    safePath(anchorPath);
    const stat = lstatSync(anchorPath);
    if (!stat.isDirectory() || stat.dev !== anchor.identity.dev || stat.ino !== anchor.identity.ino) throw fail('Install anchor changed; review the manifest before uninstalling.');
  }
  manifest.files.forEach(validEntry);
  if (manifest.staging !== undefined && (manifest.state !== 'pending' || !Array.isArray(manifest.staging))) throw fail('Invalid install staging');
  const staged = new Set();
  for (const stage of manifest.staging || []) {
    validStaging(stage);
    const owned = manifest.files.some(entry => entry.root === stage.root && entry.path === stage.original && (stage.kind === 'payload' ? entry.hash === stage.hash : entry.backup?.path === stage.target && entry.backup.hash === stage.hash));
    if (!owned) throw fail('Install staging is not owned');
    const id = `${stage.root}:${stage.path}`;
    if (staged.has(id)) throw fail('Duplicate staging entry');
    staged.add(id);
    safePath(roots[stage.root], stage.path);
  }
  const seen = new Set();
  for (const entry of manifest.files) {
    const id = `${entry.root}:${entry.path}`;
    if (seen.has(id)) throw fail('Duplicate manifest entry');
    seen.add(id);
    safePath(roots[entry.root], entry.path);
    if (entry.backup) safePath(roots[entry.root], entry.backup.path);
    for (const backup of entry.retainedBackups || []) safePath(roots[entry.root], backup.path);
  }
  for (const directory of manifest.directories) {
    if (!['dir', 'share'].includes(directory.root)) throw fail('Invalid manifest directory');
    if (!directory.identity || typeof directory.identity.dev !== 'number' || typeof directory.identity.ino !== 'number') throw fail('Invalid manifest directory identity');
    if (directory.parents && directory.parents >= manifest.anchors[directory.root].parents) throw fail('Manifest directory escapes its install anchor');
    if (directory.path) safeRelative(directory.path);
    const resolved = directoryPath(roots, directory);
    const owned = directory.parents || Object.values(roots).some(root => root === resolved || root.startsWith(`${resolved}/`) || root.startsWith(`${resolved}\\`)) || manifest.files.some(entry => {
      const file = join(roots[entry.root], entry.path);
      return file.startsWith(`${resolved}/`) || file.startsWith(`${resolved}\\`);
    });
    if (!owned) throw fail('Manifest directory is not owned');
  }
  return manifest;
}

/** @param {Record<string, any>} options */
function writeChecked(path, content, mode, options = {}) {
  safePath(path);
  if (existsSync(path) && !lstatSync(path).isFile()) throw fail(`Expected a regular file: ${path}`);
  const temporary = options.temporary || `${path}.${randomUUID()}.tmp`;
  safePath(temporary);
  const descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), mode);
  try {
    try {
      const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const split = Math.ceil(bytes.length / 2);
      writeFileSync(descriptor, bytes.subarray(0, split));
      options.afterStage?.(temporary);
      writeFileSync(descriptor, bytes.subarray(split));
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    chmodSync(temporary, mode);
    options.beforeRename?.(temporary);
    safePath(path);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function backupFor(roots, entry) {
  const base = `${entry.path}.bak`;
  let path = base;
  let index = 1;
  while (existsSync(safePath(roots[entry.root], path))) path = `${base}.${index++}`;
  return path;
}

function directoriesInside(roots, created) {
  return created.flatMap(path => {
    const stat = lstatSync(path);
    const identity = { dev: stat.dev, ino: stat.ino };
    for (const root of ['dir', 'share']) {
      const rel = relative(roots[root], path);
      if (!rel.startsWith('..') && !rel.startsWith('/') && !rel.includes(':')) return [{ root, path: rel.split('\\').join('/'), identity }];
      let ancestor = roots[root];
      for (let parents = 1; dirname(ancestor) !== ancestor; parents++) {
        ancestor = dirname(ancestor);
        if (ancestor === path) return [{ root, path: '', parents, identity }];
      }
    }
    return [];
  });
}

function stagingCleanup(manifest, roots, source) {
  let payload;
  return (manifest.staging || []).flatMap(stage => {
    const path = safePath(roots[stage.root], stage.path);
    if (!existsSync(path)) return [];
    try {
      if (!lstatSync(path).isFile()) throw fail('Staging is not a regular file');
      let expected;
      if (stage.kind === 'backup') expected = readFileSync(safePath(roots[stage.root], stage.original));
      else if (stage.original === 'settings.json') {
        const target = safePath(roots.dir, stage.original);
        const current = existsSync(target) ? readJson(target, 'settings') : {};
        expected = Buffer.from(format(mergeHooks(current, join(roots.share, 'hooks'), source, { stopGate: manifest.stopGate !== false })));
      } else {
        payload ||= payloadFiles(roots, source);
        expected = payload.find(file => file.root === stage.root && file.path === stage.original)?.content;
      }
      if (!expected || digest(expected) !== stage.hash) throw fail('Staging source changed');
      const bytes = readFileSync(path);
      if (bytes.length > expected.length || !bytes.equals(expected.subarray(0, bytes.length))) throw fail('Staging content changed');
      return [{ path, expected, stage }];
    } catch (error) {
      throw fail(`Pending staging needs review: ${path}. ${error.message}. Keep the manifest until the staged file is reviewed.`);
    }
  });
}

/** @param {string[]} args @param {Record<string, any>} adapters */
export async function installCommand(args = [], adapters = {}) {
  const options = parseInstallArgs(args);
  const write = adapters.write || console.log;
  const roots = locations(options, adapters.env || process.env);
  Object.values(roots).forEach(path => safePath(path));
  const source = adapters.source || packageRoot;
  const previous = readManifest(roots);
  const recovery = `lean-computer-use uninstall --dir ${shellQuote(roots.dir)} --share ${shellQuote(roots.share)}`;
  if (previous?.state === 'pending') throw fail(`An interrupted install needs recovery. Run ${recovery}, then install again.`);
  const anchors = previous?.anchors || captureAnchors(roots);
  const files = payloadFiles(roots, source);
  if (options.withHooks) {
    const path = safePath(roots.dir, 'settings.json');
    const current = existsSync(path) ? readJson(path, 'settings') : {};
    files.push({ root: 'dir', path: 'settings.json', content: Buffer.from(format(mergeHooks(current, join(roots.share, 'hooks'), source, { stopGate: !options.noStopGate }))), mode: existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600, settings: true });
  }
  const plan = files.map(file => {
    const path = safePath(roots[file.root], file.path);
    if (existsSync(path) && !lstatSync(path).isFile()) throw fail(`Expected a regular file: ${path}`);
    const exists = existsSync(path);
    return { ...file, absolute: path, hash: digest(file.content), action: !exists ? 'create' : hashFile(path) === digest(file.content) ? 'keep' : 'replace' };
  });
  write(`Install plan (${options.dryRun ? 'dry run' : 'preview'}):`);
  for (const file of plan) write(`${file.action}: ${file.absolute}`);
  write(`manifest: ${join(roots.share, manifestName)}`);
  if (options.dryRun) return 0;
  if (!options.yes && plan.some(file => file.action === 'replace')) throw fail('Replacing a differing file requires --yes. Review --dry-run first.');
  if (!options.yes) {
    const input = adapters.input || process.stdin;
    const output = adapters.output || process.stdout;
    if (!input.isTTY) throw fail('Install needs confirmation. Review --dry-run, then pass --yes.');
    const prompt = createInterface({ input, output });
    let answer;
    try { answer = await prompt.question('Install these files? [y/N] '); } finally { prompt.close(); }
    if (!/^y(es)?$/i.test(answer.trim())) { write('Install cancelled.'); return 0; }
  }
  const created = [];
  const records = previous ? [...previous.files] : [];
  const staging = [];
  const persist = pending => {
    const directories = [...(previous?.directories || []), ...directoriesInside(roots, created)];
    const unique = [...new Map(directories.map(value => [`${value.root}:${value.path}:${value.parents || 0}`, value])).values()];
    const files = pending ? records : records.map(({ priorHash, ...record }) => record);
    writeChecked(safePath(roots.share, manifestName), format({ version: 1, packageVersion: JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version, stopGate: !options.noStopGate, roots, anchors, files, directories: unique, ...(pending ? { state: 'pending', staging } : {}) }), 0o600);
    adapters.afterWrite?.(pending ? 'pending' : 'complete', join(roots.share, manifestName));
  };
  const stagedWrite = (file, target, content, mode, kind) => {
    const path = `${target}.${randomUUID()}.tmp`;
    staging.push({ root: file.root, original: file.path, target, path, hash: digest(content), kind });
    persist(true);
    writeChecked(safePath(roots[file.root], target), content, mode, {
      temporary: safePath(roots[file.root], path),
      afterStage: temporary => adapters.afterStage?.(kind, temporary),
      beforeRename: temporary => adapters.beforeRename?.(kind, temporary),
    });
  };
  ensureDirectory(roots.share, created);
  try {
    // Persist ownership before backups or payloads change, so uninstall can recover a stopped install.
    persist(true);
    for (const file of plan) {
      const oldIndex = records.findIndex(entry => entry.root === file.root && entry.path === file.path);
      const old = oldIndex >= 0 ? records[oldIndex] : null;
      if (file.action === 'keep' && !old) continue;
      let backup = old?.backup;
      let replacement;
      const retainedBackups = [...(old?.retainedBackups || [])];
      if (file.action === 'replace') {
        if (!old || hashFile(file.absolute) !== old.hash) {
          const backupPath = backupFor(roots, file);
          const original = readFileSync(safePath(roots[file.root], file.path));
          const mode = lstatSync(file.absolute).mode & 0o777;
          replacement = { path: backupPath, content: original, mode };
          if (backup) retainedBackups.push(backup);
          backup = { path: backupPath, hash: digest(original), mode };
        }
      }
      const record = { root: file.root, path: file.path, hash: file.hash, mode: file.mode, ...(old ? { priorHash: old.hash } : {}), ...(backup ? { backup } : {}), ...(retainedBackups.length ? { retainedBackups } : {}), ...(file.settings ? { settings: true } : {}) };
      if (oldIndex >= 0) records[oldIndex] = record;
      else records.push(record);
      ensureDirectory(dirname(file.absolute), created);
      persist(true);
      if (replacement) {
        const path = safePath(roots[file.root], replacement.path);
        stagedWrite(file, replacement.path, replacement.content, replacement.mode, 'backup');
        adapters.afterWrite?.('backup', path);
      }
      if (file.action !== 'keep') {
        stagedWrite(file, file.path, file.content, file.mode, 'payload');
        adapters.afterWrite?.('payload', file.absolute);
      }
    }
    persist(false);
  } catch (error) {
    write(`Install incomplete. Recover owned changes with: ${recovery}`);
    throw error;
  }
  if (!options.withHooks) {
    write(`Optional hooks: ${join(roots.share, 'hooks/settings-snippet.json')}`);
    write(`Merge hooks into ${join(roots.dir, 'settings.json')} with: lean-computer-use install --dir ${shellQuote(roots.dir)} --share ${shellQuote(roots.share)} --with-hooks --yes`);
  }
  write('Installed. Run lean-computer-use doctor.');
  return 0;
}

/** @param {string[]} args @param {Record<string, any>} adapters */
export async function uninstallCommand(args = [], adapters = {}) {
  const options = parseInstallArgs(args);
  const write = adapters.write || console.log;
  const roots = locations(options, adapters.env || process.env);
  const manifest = readManifest(roots);
  if (!manifest) throw fail(`Install manifest not found: ${join(roots.share, manifestName)}`);
  const staged = stagingCleanup(manifest, roots, adapters.source || packageRoot);
  for (const entry of staged) write(`remove staged file: ${entry.path}`);
  const actions = [];
  for (const entry of manifest.files) {
    for (const backup of entry.retainedBackups || []) write(`keep backup: ${safePath(roots[entry.root], backup.path)} (earlier user contents; restore manually if needed)`);
    const path = safePath(roots[entry.root], entry.path);
    if (!existsSync(path)) {
      if (entry.backup) write(`keep backup: ${safePath(roots[entry.root], entry.backup.path)} (installed file is missing; restore manually if needed)`);
      continue;
    }
    if (!lstatSync(path).isFile()) throw fail(`Expected a regular file: ${path}`);
    const matches = hashFile(path) === entry.hash || manifest.state === 'pending' && hashFile(path) === entry.priorHash;
    if (matches) {
      if (entry.backup) {
        const backup = safePath(roots[entry.root], entry.backup.path);
        if (!existsSync(backup) || hashFile(backup) !== entry.backup.hash) {
          write(`keep: ${path} (backup changed or missing; restore manually)`);
          continue;
        }
        actions.push({ entry, path, kind: 'restore', backup });
      } else actions.push({ entry, path, kind: 'remove' });
    } else if (manifest.state === 'pending' && entry.backup && hashFile(path) === entry.backup.hash) {
      write(`keep: ${path} (original file from interrupted install)`);
      if (existsSync(safePath(roots[entry.root], entry.backup.path))) write(`keep backup: ${safePath(roots[entry.root], entry.backup.path)} (original user contents; restore manually if needed)`);
    } else if (entry.settings) {
      const settings = readJson(path, 'settings');
      const cleaned = removeHooks(settings);
      if (entry.backup) write(`keep backup: ${safePath(roots[entry.root], entry.backup.path)} (settings changed; restore manually if needed)`);
      actions.push({ entry, path, kind: 'unregister', content: format(cleaned) });
    } else {
      write(`keep: ${path} (user-edited file)`);
      if (entry.backup) write(`keep backup: ${safePath(roots[entry.root], entry.backup.path)} (original user contents; restore manually if needed)`);
    }
  }
  for (const action of actions) write(`${action.kind}: ${action.path}`);
  write(`remove manifest: ${join(roots.share, manifestName)}`);
  write('For blocks pasted manually, remove only the entries marked lean-computer-use from your settings.');
  if (options.dryRun) return 0;
  for (const entry of staged) {
    const path = safePath(roots[entry.stage.root], entry.stage.path);
    const bytes = readFileSync(path);
    if (!lstatSync(path).isFile() || bytes.length > entry.expected.length || !bytes.equals(entry.expected.subarray(0, bytes.length))) throw fail(`Staged file changed during recovery: ${path}`);
    unlinkSync(path);
  }
  for (const action of actions) {
    const path = safePath(roots[action.entry.root], action.entry.path);
    if (!existsSync(path)) continue;
    if (action.kind === 'unregister') {
      const current = readJson(path, 'settings');
      writeChecked(path, format(removeHooks(current)), lstatSync(path).mode & 0o777);
      continue;
    }
    if (hashFile(path) !== action.entry.hash && !(manifest.state === 'pending' && hashFile(path) === action.entry.priorHash)) { write(`keep: ${path} (changed during uninstall)`); continue; }
    if (action.kind === 'restore') {
      const backup = safePath(roots[action.entry.root], action.entry.backup.path);
      if (hashFile(backup) !== action.entry.backup.hash) throw fail(`Backup changed: ${backup}`);
      writeChecked(path, readFileSync(backup), action.entry.backup.mode || 0o644);
      safePath(roots[action.entry.root], action.entry.backup.path);
      unlinkSync(backup);
    } else {
      safePath(roots[action.entry.root], action.entry.path);
      unlinkSync(path);
    }
  }
  safePath(roots.share, manifestName);
  unlinkSync(join(roots.share, manifestName));
  for (const directory of manifest.directories.sort((a, b) => directoryPath(roots, b).length - directoryPath(roots, a).length)) {
    const path = directoryPath(roots, directory);
    if (!existsSync(path)) continue;
    const stat = lstatSync(path);
    if (stat.dev !== directory.identity.dev || stat.ino !== directory.identity.ino) { write(`keep directory: ${path} (replaced since install)`); continue; }
    if (stat.isDirectory() && readdirSync(path).length === 0) { directoryPath(roots, directory); rmdirSync(path); }
  }
  write('Uninstalled owned files.');
  return 0;
}
