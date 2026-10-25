import { existsSync, readFileSync, writeFileSync, lstatSync, chmodSync, unlinkSync, rmdirSync, readdirSync, openSync, closeSync, constants } from 'node:fs';
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
  const options = { yes: false, dryRun: false, withHooks: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--yes') options.yes = true;
    else if (arg === '--dry-run' || arg === '--dry') options.dryRun = true;
    else if (arg === '--with-hooks') options.withHooks = true;
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

export function readManifest(roots) {
  const path = safePath(roots.share, manifestName);
  if (!existsSync(path)) return null;
  const manifest = readJson(path, 'manifest');
  if (manifest.version !== 1 || manifest.roots?.dir !== roots.dir || manifest.roots?.share !== roots.share || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories)) throw fail(`Invalid install manifest: ${path}`);
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
    const owned = directory.parents || resolved === roots[directory.root] || manifest.files.some(entry => {
      const file = join(roots[entry.root], entry.path);
      return file.startsWith(`${resolved}/`) || file.startsWith(`${resolved}\\`);
    });
    if (!owned) throw fail('Manifest directory is not owned');
  }
  return manifest;
}

function writeChecked(path, content, mode) {
  safePath(path);
  if (existsSync(path) && !lstatSync(path).isFile()) throw fail(`Expected a regular file: ${path}`);
  const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW || 0), mode);
  try { writeFileSync(descriptor, content); } finally { closeSync(descriptor); }
  chmodSync(path, mode);
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

/** @param {string[]} args @param {Record<string, any>} adapters */
export async function installCommand(args = [], adapters = {}) {
  const options = parseInstallArgs(args);
  const write = adapters.write || console.log;
  const roots = locations(options, adapters.env || process.env);
  Object.values(roots).forEach(path => safePath(path));
  const source = adapters.source || packageRoot;
  const previous = readManifest(roots);
  const anchors = previous?.anchors || captureAnchors(roots);
  const files = payloadFiles(roots, source);
  if (options.withHooks) {
    const path = safePath(roots.dir, 'settings.json');
    const current = existsSync(path) ? readJson(path, 'settings') : {};
    files.push({ root: 'dir', path: 'settings.json', content: Buffer.from(format(mergeHooks(current, join(roots.share, 'hooks'), source))), mode: existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600, settings: true });
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
  for (const file of plan) {
    const oldIndex = records.findIndex(entry => entry.root === file.root && entry.path === file.path);
    const old = oldIndex >= 0 ? records[oldIndex] : null;
    if (file.action === 'keep' && !old) continue;
    let backup = old?.backup;
    const retainedBackups = [...(old?.retainedBackups || [])];
    if (file.action === 'replace') {
      if (!backup || hashFile(file.absolute) !== old?.hash) {
        const backupPath = backupFor(roots, file);
        const original = readFileSync(safePath(roots[file.root], file.path));
        const mode = lstatSync(file.absolute).mode & 0o777;
        writeChecked(safePath(roots[file.root], backupPath), original, mode);
        if (backup) retainedBackups.push(backup);
        backup = { path: backupPath, hash: digest(original), mode };
      }
    }
    if (file.action !== 'keep') {
      ensureDirectory(dirname(file.absolute), created);
      writeChecked(safePath(roots[file.root], file.path), file.content, file.mode);
    }
    const record = { root: file.root, path: file.path, hash: file.hash, mode: file.mode, ...(backup ? { backup } : {}), ...(retainedBackups.length ? { retainedBackups } : {}), ...(file.settings ? { settings: true } : {}) };
    if (oldIndex >= 0) records[oldIndex] = record;
    else records.push(record);
  }
  ensureDirectory(roots.share, created);
  const directories = [...(previous?.directories || []), ...directoriesInside(roots, created)];
  const unique = [...new Map(directories.map(value => [`${value.root}:${value.path}:${value.parents || 0}`, value])).values()];
  writeChecked(safePath(roots.share, manifestName), format({ version: 1, packageVersion: '0.1.0', roots, anchors, files: records, directories: unique }), 0o600);
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
  const actions = [];
  for (const entry of manifest.files) {
    for (const backup of entry.retainedBackups || []) write(`keep backup: ${safePath(roots[entry.root], backup.path)} (earlier user contents; restore manually if needed)`);
    const path = safePath(roots[entry.root], entry.path);
    if (!existsSync(path)) {
      if (entry.backup) write(`keep backup: ${safePath(roots[entry.root], entry.backup.path)} (installed file is missing; restore manually if needed)`);
      continue;
    }
    if (!lstatSync(path).isFile()) throw fail(`Expected a regular file: ${path}`);
    const matches = hashFile(path) === entry.hash;
    if (matches) {
      if (entry.backup) {
        const backup = safePath(roots[entry.root], entry.backup.path);
        if (!existsSync(backup) || hashFile(backup) !== entry.backup.hash) {
          write(`keep: ${path} (backup changed or missing; restore manually)`);
          continue;
        }
        actions.push({ entry, path, kind: 'restore', backup });
      } else actions.push({ entry, path, kind: 'remove' });
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
  for (const action of actions) {
    const path = safePath(roots[action.entry.root], action.entry.path);
    if (!existsSync(path)) continue;
    if (action.kind === 'unregister') {
      const current = readJson(path, 'settings');
      writeChecked(path, format(removeHooks(current)), lstatSync(path).mode & 0o777);
      continue;
    }
    if (hashFile(path) !== action.entry.hash) { write(`keep: ${path} (changed during uninstall)`); continue; }
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
