import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export function temp(t) {
  const parent = join(ROOT, 'test/.scratch');
  mkdirSync(parent, { recursive: true });
  writeFileSync(join(parent, '.gitignore'), '*\n');
  const root = mkdtempSync(join(parent, 'case-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
export function write(root, file, content) {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}
