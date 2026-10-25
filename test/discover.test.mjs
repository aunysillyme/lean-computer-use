import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './support.mjs';

const read = path => readFileSync(ROOT + '/' + path, 'utf8');
const facts = JSON.parse(read('.repo-build/facts.json'));
const pkg = JSON.parse(read('package.json'));
const settings = read('REPO_SETTINGS.md');
const readme = read('README.md');
const setting = name => settings.split('\n').find(line => line.startsWith(`| ${name} |`))?.split('|')[2].trim();
const topics = ['agent-skills', 'claude-code', 'computer-use', 'native-apps', 'macos', 'cua-driver', 'cua', 'token-efficiency', 'subagents', 'accessibility', 'cli', 'npm', 'developer-tools', 'ai-agents', 'macos-automation'];

test('discovery description and homepage agree across public metadata', () => {
  assert.equal(facts.description, 'Background Mac computer control for AI agents: desk tools, a fresh runner subagent, retry guards and a transcript token meter, installed with one command');
  assert.ok(facts.description.length <= 160);
  assert.equal(pkg.description, facts.description);
  assert.equal(setting('About description'), facts.description);
  assert.ok(readme.includes(`| **lean-computer-use** | ${facts.description} |`));
  assert.equal(facts.homepage, 'https://www.npmjs.com/package/lean-computer-use');
  assert.equal(pkg.homepage, facts.homepage);
  assert.equal(setting('Website'), facts.homepage);
});

test('discovery topics and keywords share the search terms', () => {
  assert.deepEqual(facts.topics, topics);
  assert.ok(facts.topics.length <= 20);
  for (const topic of facts.topics) {
    assert.ok(topic.length <= 50, topic);
    assert.match(topic, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(pkg.keywords.includes(topic), topic);
  }
  assert.deepEqual(facts.keywords, [...topics, 'mac-automation', 'background-computer-use']);
  assert.deepEqual(pkg.keywords, facts.keywords);
  assert.deepEqual(setting('Topics').split(', '), facts.topics);
});

test('discovery lead and early install agree for people and answer engines', () => {
  assert.equal(facts.lead, 'Background Mac computer control for AI agents: chain actions, read once with a filter, and verify cleanup.');
  const lines = readme.split('\n');
  assert.ok(lines.slice(0, 10).includes(`**${facts.lead}**`));
  assert.equal(read('llms.txt').split('\n').find(line => line.startsWith('> ')), `> ${facts.lead}`);
  assert.ok(lines.slice(0, 40).includes('npx lean-computer-use'));
  assert.ok(lines.length >= 150 && lines.length <= 300);
  const opening = lines.filter(line => /^(The problem|What you get|What you can do):/.test(line)).join('\n');
  assert.match(opening, /computer use/);
  assert.match(opening, /Claude Code/);
});

test('discovery FAQ answers the six requested searches with commands or files', () => {
  const faq = readme.split('## Common questions\n')[1]?.split('\n## ')[0] || '';
  const questions = [...faq.matchAll(/^### (.+)$/gm)].map(match => match[1]);
  assert.ok(questions.length >= 4 && questions.length <= 6);
  assert.deepEqual(questions, [
    'How do I use computer use on a Mac in the background?',
    'What is cua-driver and how do I check its permissions?',
    'How do I reduce tokens when an AI agent controls Mac apps?',
    'How do I measure main-session and subagent tokens?',
    'How do I install the optional retry hook for native app errors?',
    'How do I keep my edited skill when uninstalling?',
  ]);
  const answers = faq.split(/^### .+$/m).slice(1);
  for (const answer of answers) assert.match(answer, /`[^`]+`/);
  assert.match(answers[0], /background keys/);
  assert.match(answers[0], /&&.*desk-read/);
  assert.match(answers[0], /desk-clean/);
  assert.match(answers[1], /upstream.*docs\/cua-driver-install\.md/s);
  assert.match(answers[2], /fresh.*one chained.*one filtered/s);
  assert.doesNotMatch(answers[2], /\d/);
  assert.match(answers[3], /measure --json/);
  assert.match(answers[4], /install --with-hooks/);
  assert.match(answers[4], /third identical error/);
  assert.match(answers[5], /uninstall --dry-run/);
});
