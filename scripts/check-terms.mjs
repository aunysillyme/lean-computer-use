#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanTerms } from './privacy.mjs';

export function main(args = process.argv.slice(2)) {
  let root = resolve(fileURLToPath(new URL('..', import.meta.url))), historyRange;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) root = resolve(args[++i]);
    else if (args[i] === '--range' && args[i + 1]) historyRange = args[++i];
    else if (args[i] !== '--history') throw Error('Usage: check-terms [--root DIR] [--range REV] [--history]');
  }
  const findings = scanTerms(root, { historyRange });
  if (findings.length) { console.error(findings.join('\n')); return 1; }
  console.log('Privacy checks passed: paths, contents and commit messages.');
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
