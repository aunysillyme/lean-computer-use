// Every '<' is consumed as part of a tag or dropped, so the output cannot hold
// an element start (CodeQL js/incomplete-multi-character-sanitization).
const BLOCKS = new Set(['script', 'style', 'iframe', 'object', 'svg']);
const INLINE = new Set(['a', 'code', 'strong', 'em', 'span', 'time']);

function tagName(tag) {
  return tag.match(/^\/?([a-z][a-z0-9]*)/i)?.[1].toLowerCase() || '';
}

// Keep closing positions even inside malformed tags, as the block filter did.
// Both the match cursor and the next '>' cursor only move forward.
function blockEnds(html) {
  const ends = new Map();
  let close = -1;
  for (const match of html.matchAll(/<\/(script|style|iframe|object|svg)(?![a-z0-9])/gi)) {
    if (close < match.index) {
      close = html.indexOf('>', match.index);
      if (close === -1) close = html.length;
    }
    const name = match[1].toLowerCase();
    if (!ends.has(name)) ends.set(name, []);
    ends.get(name).push({ at: match.index, end: Math.min(close + 1, html.length) });
  }
  for (const positions of ends.values()) positions.reverse();
  return ends;
}

function blockEnd(ends, name, from) {
  const positions = ends.get(name);
  while (positions?.length && positions.at(-1).at < from) positions.pop();
  return positions?.at(-1)?.end ?? -1;
}

// Stop at either delimiter so an unterminated tag never rescans the suffix.
function tagEnd(html, from) {
  let i = from;
  while (i < html.length && html[i] !== '<' && html[i] !== '>') i++;
  return i;
}

export function stripTags(html, separator = '') {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) { out.push(html.slice(i)); break; }
    out.push(html.slice(i, open));
    const end = tagEnd(html, open + 1);
    if (html[end] === '>') out.push(separator);
    else out.push(html.slice(open + 1, end));
    i = html[end] === '>' ? end + 1 : end;
  }
  return out.join('');
}

export function stripHtml(html, separator = '', joinInline = false) {
  const ends = blockEnds(html);
  const out = [];
  let strayAt = -1;
  let i = 0;
  while (i < html.length) {
    const open = html.indexOf('<', i);
    if (open === -1) { out.push(html.slice(i)); break; }
    out.push(html.slice(i, open));
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      i = end === -1 ? html.length : end + 3;
      strayAt = -1;
      continue;
    }
    const close = tagEnd(html, open + 1);
    if (html[close] !== '>') {
      // Remember the output boundary before a malformed prefix such as <scr<script>.
      if (strayAt === -1) strayAt = out.length;
      out.push(html.slice(open + 1, close));
      i = close;
      continue;
    }
    const tag = html.slice(open + 1, close);
    const name = tagName(tag);
    if (name && tag[0] !== '/' && BLOCKS.has(name)) {
      const end = blockEnd(ends, name, close + 1);
      if (end !== -1) {
        if (strayAt !== -1) out.length = strayAt;
        strayAt = -1;
        i = end;
        continue;
      }
    }
    strayAt = -1;
    if (name) out.push(joinInline && INLINE.has(name) ? '' : separator);
    i = close + 1;
  }
  return out.join('');
}
