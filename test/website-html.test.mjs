import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripHtml, stripTags } from '../website/html.mjs';

function repeated(token) {
  return token.repeat(Math.ceil(200_000 / token.length)).slice(0, 200_000);
}

test('HTML scanners finish 200,000-character malformed inputs within one second', () => {
  const inputs = [repeated('<script '), repeated('<a'), repeated('<script>')];
  const start = performance.now();
  for (let round = 0; round < 3; round++) {
    for (const input of inputs) {
      for (const strip of [stripHtml, stripTags]) assert.ok(!strip(input).includes('<'));
    }
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `HTML scanners took ${elapsed.toFixed(1)} ms`);
});

test('HTML block removal keeps nested prefixes and closing tag variants empty', () => {
  for (const payload of ['<scr<script>ipt>alert(1)</script>', '<script>alert(1)</SCRIPT >',
    '<script>alert(1)</script\t\nbar>']) {
    assert.equal(stripHtml(payload), '', payload);
    assert.equal(stripHtml(`Before ${payload} after`), 'Before  after', payload);
  }
  for (const name of ['script', 'style', 'iframe', 'object', 'svg']) {
    assert.equal(stripHtml(`<${name}>hidden</${name}x>still hidden</${name}>tail`), 'tail');
    assert.equal(stripHtml(`<${name}>hidden</${name}`), '');
    assert.equal(stripHtml(`<${name}>İ hidden</${name}>tail`), 'tail');
  }
});

test('HTML scanners emit no element starts across malformed input combinations', () => {
  const pieces = ['<', '>', '/', 'a', ' ', '<script>', '</SCRIPT >', '<!--', '-->', 'İ', '&lt;'];
  for (const a of pieces) for (const b of pieces) for (const c of pieces) {
    const input = `before${a}${b}${c}after`;
    for (const separator of ['', ' ']) {
      assert.ok(!stripHtml(input, separator).includes('<'), input);
      assert.ok(!stripHtml(input, separator, true).includes('<'), input);
      assert.ok(!stripTags(input, separator).includes('<'), input);
    }
  }
});

test('HTML scanners preserve text, separators, comments and inline joins', () => {
  assert.equal(stripTags('before <b>bold</b> after', '|'), 'before |bold| after');
  assert.equal(stripTags('a<broken<ok>b<tail', '|'), 'abroken|btail');
  assert.equal(stripHtml('<p>Keep <strong>inline</strong> text</p>', ' ', true), ' Keep inline text ');
  assert.equal(stripHtml('before <!-- hidden <b> --> after'), 'before  after');
  assert.equal(stripHtml('before <!-- hidden'), 'before ');
  assert.equal(stripHtml('a<script>unclosed'), 'aunclosed');
  assert.equal(stripHtml('a<script>hide</script><script>keep'), 'akeep');
});
