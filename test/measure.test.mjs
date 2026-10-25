import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { measureTranscripts, measureCommand, isDeskCommand } from '../src/measure.mjs';
import { temp, write, ROOT } from './support.mjs';

const fixture = join(ROOT, 'test/fixtures/transcripts');

test('measure counts a message id once and keeps the largest usage', () => {
  const result = measureTranscripts({ projectsDir: fixture });
  assert.deepEqual(result.main, { steps: 3, median: 200, p90: 300, mean: 200, total: 600, rereadShare: 0.6 });
  assert.equal(result.files, 2);
  assert.equal(result.malformedLines, 1);
});

test('measure splits main from subagent', () => {
  assert.deepEqual(measureTranscripts({ projectsDir: fixture }).subagent,
    { steps: 2, median: 100, p90: 150, mean: 100, total: 200, rereadShare: 0.5 });
});

test('measure supports date and tool filters and validates them', () => {
  const result = measureTranscripts({ projectsDir: fixture, since: '2026-10-03', toolPattern: '^custom__' });
  assert.equal(result.main.steps, 1);
  assert.equal(result.subagent.steps, 1);
  assert.throws(() => measureTranscripts({ projectsDir: fixture, since: '2026-02-30' }));
  assert.throws(() => measureTranscripts({ projectsDir: fixture, toolPattern: '[' }));
});

test('measure prints the same result as JSON and a short human table', () => {
  const lines = [];
  assert.equal(measureCommand(['--projects-dir', fixture, '--json'], { write: value => lines.push(value) }), 0);
  assert.deepEqual(JSON.parse(lines.pop()), measureTranscripts({ projectsDir: fixture }));
  measureCommand(['--projects-dir', fixture], { write: value => lines.push(value) });
  assert.match(lines[0], /Group.*Median.*Re-read/);
  assert.match(lines.join('\n'), /60.0%/);
});

test('measure zero steps has one clear line and malformed input is counted', t => {
  const root = temp(t);
  write(root, 'empty.jsonl', 'invalid\n{"type":"user"}\n');
  const lines = [];
  assert.equal(measureCommand(['--projects-dir', root], { write: value => lines.push(value) }), 0);
  assert.deepEqual(lines, ['0 native-app steps found in 1 files']);
  assert.equal(measureTranscripts({ projectsDir: root }).malformedLines, 1);
  assert.equal(measureTranscripts({ projectsDir: join(root, 'missing') }).files, 0);
});

test('desk command matching recognizes command segments and rejects mentions', () => {
  for (const value of ['desk example.app click {}', 'desk-read example.app', 'desk-clean example.app', 'true && desk example.app click {}', '"/tools/desk" example.app click {}']) assert.equal(isDeskCommand(value), true, value);
  for (const value of ['echo desk example.app', 'desktop example.app', 'deskish', 'cat desk-read']) assert.equal(isDeskCommand(value), false, value);
});

test('measure ignores quoted desk text, comments and here-document bodies', () => {
  for (const command of [
    "echo '; desk example.app click {}'",
    'echo "ready && desk-read example.app"',
    'echo ready # ; desk example.app click {}',
    'cat <<END\ndesk example.app click {}\nEND\n',
    "cat <<-'END'\n\tdesk-read example.app\n\tEND\n",
  ]) assert.equal(isDeskCommand(command), false, command);
});

test('measure counts real native segments after quoted text and here-documents', () => {
  for (const command of [
    "echo '; desk-text' && desk example.app click '{}'",
    "'/tools with spaces/desk-read' example.app",
    'cat <<END\nexample\nEND\ndesk-clean example.app',
    'echo ready; "desk" example.app click {}',
  ]) assert.equal(isDeskCommand(command), true, command);
});

test('measure unifies split native content and handles absent usage', t => {
  const root = temp(t);
  const values = [
    { type: 'assistant', message: { id: 'split', content: [], usage: { input_tokens: 50 } } },
    { type: 'assistant', message: { id: 'split', content: [{ type: 'tool_use', name: 'mcp__cua-driver__click' }], usage: {} } },
    { type: 'assistant', message: { id: 'zero', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'desk-read example.app' } }] } },
  ];
  write(root, 'split.jsonl', values.map(value => JSON.stringify(value)).join('\n'));
  assert.equal(measureTranscripts({ projectsDir: root }).main.steps, 2);
  assert.equal(measureTranscripts({ projectsDir: root }).main.total, 50);
});
