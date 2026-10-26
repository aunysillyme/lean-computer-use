import { homedir } from 'node:os';
import { dirname, resolve, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstatSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const shellQuote = value => "'" + value.split("'").join("'\\''") + "'";

/** @param {{dir?: string, share?: string}} options @param {NodeJS.ProcessEnv} env */
export function locations(options = {}, env = process.env) {
  return {
    dir: resolve(options.dir || join(env.HOME || homedir(), '.claude')),
    share: resolve(options.share || env.LEAN_COMPUTER_USE_HOME || join(env.HOME || homedir(), '.local/share/lean-computer-use')),
  };
}

export function safeRelative(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe relative path: ${String(value)}`);
  }
  return value;
}

export function safePath(root, name = '') {
  const absolute = name ? resolve(root, safeRelative(name)) : resolve(root);
  const fromRoot = relative(resolve(root), absolute);
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('Path escapes its root');
  let current = absolute;
  while (true) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${current}`);
      if (current !== absolute && !stat.isDirectory()) throw new Error(`Parent is not a directory: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return absolute;
}

export function ensureDirectory(path, created) {
  safePath(path);
  if (existsSync(path)) {
    if (!lstatSync(path).isDirectory()) throw new Error(`Expected a directory: ${path}`);
    return;
  }
  ensureDirectory(dirname(path), created);
  mkdirSync(path, { mode: 0o755 });
  created.push(path);
}

export function publicFiles(root, prefix = '') {
  if (!existsSync(root)) throw new Error(`Package files missing: ${root}`);
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (['tests', '__pycache__', '.pytest_cache'].includes(entry.name) || entry.name.endsWith('.pyc')) return [];
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Package symlink refused: ${name}`);
    return entry.isDirectory() ? publicFiles(join(root, entry.name), name) : [name];
  });
}

export function payloadFiles(roots, source = packageRoot) {
  const files = [];
  for (const [folder, root, destination] of [
    ['skills/lean-computer-use', 'dir', 'skills/lean-computer-use'],
    ['desk', 'share', 'desk'], ['hooks', 'share', 'hooks'],
  ]) {
    for (const name of publicFiles(join(source, folder))) {
      files.push({ root, path: `${destination}/${name}`, content: readFileSync(join(source, folder, name)), mode: folder === 'desk' && ['desk', 'desk-read', 'desk-clean', 'desk-reap', '_resolve.py', '_lease.py'].includes(name) || name.endsWith('.sh') ? 0o755 : 0o644 });
    }
  }
  files.push({ root: 'dir', path: 'skills/lean-computer-use/desk-brief.md', content: readFileSync(join(source, 'briefs/desk-brief.md')), mode: 0o644 });
  const agent = readFileSync(join(source, 'agents/desk-runner.md'), 'utf8').replaceAll('__DESK_DIR__', shellQuote(join(roots.share, 'desk')));
  files.push({ root: 'dir', path: 'agents/desk-runner.md', content: Buffer.from(agent), mode: 0o644 });
  return files;
}
