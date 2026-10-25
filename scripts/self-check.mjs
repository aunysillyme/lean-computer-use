#!/usr/bin/env node
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicFiles, readText, scanTerms } from './privacy.mjs';
import { build } from './build.mjs';
import { validateProof } from './proof-data.mjs';

export async function selfCheck(root) {
  const errors = [];
  const read = name => readFileSync(join(root, name), 'utf8');
  const pkg = JSON.parse(read('package.json')), facts = JSON.parse(read('.repo-build/facts.json'));
  if (pkg.name !== facts.name || pkg.description !== facts.description) errors.push('Metadata differs.');
  if (pkg.description.length > 160) errors.push('Description exceeds its budget.');
  if (Object.keys(pkg.dependencies || {}).length) errors.push('Runtime dependencies must be zero.');
  if (!facts.topics.every(topic => pkg.keywords.includes(topic))) errors.push('Topics must appear in keywords.');
  if (facts.topics.length > 20 || facts.topics.some(topic => topic.length > 50 || !/^[a-z0-9-]+$/.test(topic))) errors.push('Topic budget or shape failed.');
  const readme = read('README.md');
  if (!readme.split('\n').slice(0, 10).includes(`**${facts.lead}**`)) errors.push('First-screen lead differs.');
  if (!readme.split('\n').slice(0, 40).join('\n').includes('npx lean-computer-use')) errors.push('First-screen install missing.');
  if (!read('CLAUDE.md').split('\n').includes('@AGENTS.md')) errors.push('Agent import missing.');
  if (read('AGENTS.md').split('\n').length >= 200) errors.push('Agent instruction line budget exceeded.');
  const skill = read('skills/lean-computer-use/SKILL.md');
  if (Buffer.byteLength(skill) > 6144 || skill.split('\n').length > 120) errors.push('Skill entry budget exceeded.');
  let skillBytes = Buffer.byteLength(skill);
  for (const name of readdirSync(join(root, 'skills/lean-computer-use/methods'))) {
    const size = statSync(join(root, 'skills/lean-computer-use/methods', name)).size;
    skillBytes += size;
    if (size > 8192) errors.push(`Method budget exceeded: ${name}`);
  }
  if (skillBytes > 204800) errors.push('Skill folder budget exceeded.');
  for (const file of publicFiles(root)) {
    if (readText(root, file).includes(String.fromCharCode(0x2014))) errors.push(`${file}: punctuation rule`);
  }
  errors.push(...scanTerms(root));
  errors.push(...validateProof(JSON.parse(read('proof/results.json'))));
  try { await build(root, ['--check']); } catch (error) { errors.push(error.message); }
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const errors = await selfCheck(resolve(fileURLToPath(new URL('..', import.meta.url))));
    if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
    else console.log('Repository checks passed.');
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
