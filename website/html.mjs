// Character scanners, not regex replaces: every '<' is either consumed as part of a tag or
// dropped, so the output can never hold the start of an element (CodeQL
// js/incomplete-multi-character-sanitization).
const BLOCKS = new Set(['script', 'style', 'iframe', 'object', 'svg']);
const INLINE = new Set(['a', 'code', 'strong', 'em', 'span', 'time']);
const isNameChar = ch => ch !== undefined && /[a-z0-9]/i.test(ch);

function tagName(tag) {
  let i = tag[0] === '/' ? 1 : 0;
  if (!/[a-z]/i.test(tag[i] ?? '')) return '';
  let name = '';
  while (isNameChar(tag[i])) name += tag[i++];
  return name.toLowerCase();
}

function blockEnd(html, lower, name, from) {
  let at = from;
  for (;;) {
    at = lower.indexOf(`</${name}`, at);
    if (at === -1) return -1;
    if (!isNameChar(lower[at + 2 + name.length])) break;
    at += 2;
  }
  const close = html.indexOf('>', at);
  return close === -1 ? html.length : close + 1;
}

export function stripTags(html, separator = '') {
  let out = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch !== '<') { out += ch; i++; continue; }
    const close = html.indexOf('>', i + 1);
    const next = html.indexOf('<', i + 1);
    if (close === -1 || (next !== -1 && next < close)) { i++; continue; }
    out += separator;
    i = close + 1;
  }
  return out;
}

export function stripHtml(html, separator = '', joinInline = false) {
  const lower = html.toLowerCase();
  let out = '';
  let strayAt = -1;
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch !== '<') { out += ch; i++; continue; }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? html.length : end + 3;
      strayAt = -1;
      continue;
    }
    const close = html.indexOf('>', i + 1);
    const next = html.indexOf('<', i + 1);
    if (close === -1 || (next !== -1 && next < close)) {
      // A '<' that never closes before the next one: drop it, and remember where it was so a
      // script-like block hidden behind it (<scr<script>...) is removed along with its prefix.
      if (strayAt === -1) strayAt = out.length;
      i++;
      continue;
    }
    const tag = html.slice(i + 1, close);
    const name = tagName(tag);
    if (name && tag[0] !== '/' && BLOCKS.has(name)) {
      const end = blockEnd(html, lower, name, close + 1);
      if (end !== -1) {
        if (strayAt !== -1) out = out.slice(0, strayAt);
        strayAt = -1;
        i = end;
        continue;
      }
    }
    strayAt = -1;
    if (name) out += joinInline && INLINE.has(name) ? '' : separator;
    i = close + 1;
  }
  return out;
}
