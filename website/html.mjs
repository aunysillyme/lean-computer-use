export function stripTags(html, separator = '') {
  let previous;
  do {
    previous = html;
    html = html.replace(/<[^>]*>/g, separator);
  } while (html !== previous);
  return html.replace(/</g, '');
}

export function stripHtml(html, separator = '', joinInline = false) {
  let previous;
  do {
    previous = html;
    html = html.replace(/<!--[^]*?-->/g, '')
      .replace(/<(?:[^<>]{0,64}<){0,4}(script|style|iframe|object|svg)\b[^>]*>[^]*?<\/\1\b[^>]*>/gi, '');
    if (joinInline) html = html.replace(/<\/?(?:a|code|strong|em|span|time)\b[^>]*>/gi, '');
    html = html.replace(/<\/?[a-z][^>]*>/gi, separator);
  } while (html !== previous);
  return html.replace(/</g, '');
}
