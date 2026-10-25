import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const tokens = value => value.toLowerCase().split(/[^a-z0-9_.@~\/\p{L}\p{N}\p{S}-]+/u).map(part => part.replace(/^\.+|\.+$/g, '')).filter(Boolean);
const gitArgs = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false'];
export function git(root, args) {
  return execFileSync('git', [...gitArgs, '-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function publicFiles(root) {
  return [...new Set(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort();
}
export function readText(root, file) {
  const full = join(root, file);
  if (!lstatSync(full).isFile()) return '';
  const bytes = readFileSync(full);
  return bytes.includes(0) ? '' : bytes.toString('utf8');
}
export function compileTerms(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  return {
    plain: lines.filter(line => !/^(re:|allow:)/.test(line)),
    regex: lines.filter(line => line.startsWith('re:')).map(line => new RegExp(line.slice(3), 'i')),
    allow: lines.filter(line => line.startsWith('allow:')).map(line => line.slice(6).toLowerCase()),
  };
}
export function termHashes(text) {
  return [...new Set(compileTerms(text).plain.map(line => digest(tokens(line).join(' '))))].sort();
}
export function hashMatches(text, hashes) {
  const parts = tokens(text);
  for (let i = 0; i < parts.length; i++) {
    for (let size = 1; size <= 4 && i + size <= parts.length; size++) {
      if (hashes.has(digest(parts.slice(i, i + size).join(' ')))) return true;
    }
  }
  return false;
}
export function scanTerms(root, options = {}) {
  const hashPath = options.hashPath || 'test/terms.private.sha256';
  const termsPath = options.termsPath || '.repo-build/private.local.txt';
  const raw = readFileSync(join(root, hashPath), 'utf8').trim();
  if (!/^[a-f0-9]{64}(?:\n[a-f0-9]{64})*$/.test(raw)) throw Error('Vocabulary hashes must be nonempty, sorted SHA-256 hex lines.');
  const list = raw.split('\n');
  if (list.join('\n') !== [...new Set(list)].sort().join('\n')) throw Error('Vocabulary hashes must be sorted and unique.');
  const hashes = new Set(list);
  const plaintext = existsSync(join(root, termsPath)) ? compileTerms(readFileSync(join(root, termsPath), 'utf8')) : null;
  const findings = [];
  const check = (label, text) => {
    if (hashMatches(text, hashes)) findings.push(`${label}: private vocabulary`);
    let local = text.toLowerCase();
    for (const allow of plaintext?.allow || []) local = local.split(allow).join('');
    if (plaintext && (plaintext.plain.some(term => local.includes(term.toLowerCase())) || plaintext.regex.some(re => re.test(local)))) findings.push(`${label}: local vocabulary`);
    if (/\/(?:Us[e]rs|ho[m]e)\/[\w.-]+|[A-Za-z]:\\Us[e]rs\\[^\s\\]+/.test(text)) findings.push(`${label}: personal path`);
    if (/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(text.replace(/https?:\/\/\S+|\bnoreply@(?:anthropic|openai)\.com\b|\b[\w.+-]+@(?:example\.(?:com|org|net)|[^\s@]+\.(?:mjs|md|py|json|yml))\b/gi, ''))) findings.push(`${label}: address`);
    if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-[A-Za-z0-9]{24,}|AKIA[A-Z0-9]{16})\b/.test(text)) findings.push(`${label}: credential shape`);
    if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text)) findings.push(`${label}: network address`);
  };
  for (const file of publicFiles(root)) {
    if (file === hashPath) continue;
    if (file === termsPath) throw Error('The local vocabulary file must be ignored.');
    check(file, file + '\n' + readText(root, file));
  }
  const args = ['log', '--format=%B%x00'];
  if (options.historyRange) args.push(options.historyRange);
  check('commit messages', git(root, args));
  return [...new Set(findings)];
}
