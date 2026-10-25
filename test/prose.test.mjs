import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './support.mjs';
import { publicFiles, readText } from '../scripts/privacy.mjs';

test('public text follows punctuation and home path rules', () => {
  const hits = publicFiles(ROOT).filter(file => readText(ROOT, file).includes(String.fromCharCode(0x2014)));
  assert.deepEqual(hits, []);
});
test('front page has short examples and searchable common questions', () => {
  const text = readFileSync(ROOT + '/README.md', 'utf8');
  let fence = false, lines = 0;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) { if (fence) assert.ok(lines <= 8, `Example has ${lines} lines`); fence = !fence; lines = 0; }
    else if (fence) lines++;
  }
  const faq = text.split('## Common questions')[1]?.split('\n## ')[0] || '';
  const count = (faq.match(/^### /gm) || []).length;
  assert.ok(count >= 4 && count <= 6);
  assert.match(faq, /^### How do I use computer use on a Mac in the background\?$/m);
  assert.match(faq, /^### What is cua-driver and how do I check its permissions\?$/m);
  assert.match(faq, /^### How do I reduce tokens when an AI agent controls Mac apps\?$/m);
});
