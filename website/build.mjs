import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildJsonLd, buildFaqJsonLd, validateTools, visibleText } from './facts.mjs';
import { pages } from './pages.mjs';
import { content } from './content.mjs';

const origin = 'https://lean-computer-use.aunysillyme.dev';
const repository = 'https://github.com/aunysillyme/lean-computer-use';
import { checkCopyPins } from './check.mjs';
import { assets, media, fontStylesheet, csp } from './resources.mjs';
const read = (root, file) => readFileSync(join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
const requireValue = (ok, message) => { if (!ok) throw Error(message); };
export const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const slug = text => visibleText(text).toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';

function section(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}\n`);
  requireValue(start >= 0, `README section missing: ${heading}`);
  const rest = markdown.slice(start);
  const end = rest.indexOf('\n## ');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function loadSourceFacts(root) {
  const pkg = json(root, 'package.json');
  const about = read(root, 'REPO_SETTINGS.md').split('\n').find(line => /^\| About description \|/.test(line))?.split('|')[2]?.trim();
  requireValue(pkg.description === about, 'Description parity: package.json differs from REPO_SETTINGS.md About description');
  const readme = read(root, 'README.md');
  const faq = section(readme, 'Common questions').split(/^### /m).slice(1).map(block => {
    const [question, ...lines] = block.split('\n');
    const answerMarkdown = lines.join('\n').trim();
    const answer = visibleText(escape(answerMarkdown.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1')));
    return { question, answerMarkdown, answer };
  });
  const proof = json(root, 'proof/results.json');
  requireValue(faq.length === 6, 'README must contain six FAQ questions');
  requireValue(Array.isArray(proof) && proof.length > 0, 'Proof rows missing');
  const ids = new Set();
  for (const row of proof) {
    requireValue(row.id && !ids.has(row.id) && Number.isFinite(row.value), `Invalid proof row: ${row.id}`);
    ids.add(row.id);
    requireValue(Number.isFinite(Date.parse(row.measured_at)) && Date.parse(row.expires_at) >= Date.now(), `Proof expired or invalid: ${row.id}`);
  }
  const tools = json(root, 'website/tools.json');
  validateTools(root, tools);
  const lead = readme.match(/^\*\*([^\n]+)\*\*$/m)?.[1];
  requireValue(lead, 'README lead missing');
  const process = section(readme, 'The process on screen').split('\n').filter(line => /^\| (Frame|Run|Read|Verify) \|/.test(line)).map(line => line.split('|').slice(1, 3).map(cell => cell.trim()));
  return { process, name: pkg.name, description: pkg.description, version: pkg.version, lead, repository, npm: `https://www.npmjs.com/package/${pkg.name}`, url: `${origin}/`, faq, proof, tools };
}

function validatePages(facts) {
  const expected = ['/', '/docs/overview/', '/docs/how-it-works/', '/docs/guides/', '/docs/commands/', '/docs/proof/', '/docs/changelog/', '/docs/install/', '/docs/guarantees/'];
  requireValue(pages.length === expected.length && expected.every(route => pages.some(page => page.route === route)), 'Page routes must match the nine-page map');
  const ids = pages.flatMap(page => page.tools);
  for (const tool of facts.tools) requireValue(ids.filter(id => id === tool.id).length === 1, `Tool page mapping missing or duplicated: ${tool.id}`);
  requireValue(ids.every(id => facts.tools.some(tool => tool.id === id)), 'Unknown tool in page mapping');
  for (const page of pages) {
    requireValue(page.title && page.title.length <= 60 && page.description && page.h1 && Array.isArray(page.sources), `Incomplete page: ${page.route}`);
  }
}

function sourceRoutes() {
  const routes = new Map();
  for (const page of pages.filter(page => page.route !== '/')) {
    for (const source of page.sources) if (!routes.has(source)) routes.set(source, page.route);
  }
  return routes;
}

export function rewriteUrl(href, source, { image = false, routes = sourceRoutes() } = {}) {
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href)) return '';
  if (image) {
    const local = href.startsWith('/assets/') ? href.slice(8) : posix.normalize(posix.join(posix.dirname(source), href)).replace(/^website\/assets\//, '');
    return assets.includes(local) && /\.(?:png|svg)$/.test(local) ? `/assets/${local}` : '';
  }
  if (href.startsWith('#')) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return '';
  const [file, fragment] = href.split('#');
  const normalized = posix.normalize(file.startsWith('/') ? file.slice(1) : posix.join(posix.dirname(source), file));
  if (normalized === '..' || normalized.startsWith('../')) return '';
  const suffix = fragment ? `#${fragment}` : '';
  return routes.has(normalized) ? `${routes.get(normalized)}${suffix}` : `${repository}/blob/main/${normalized}${suffix}`;
}

function uniqueId(text, ids) {
  const base = slug(text);
  let id = base, count = 0;
  while (ids.has(id)) id = `${base}-${++count}`;
  ids.add(id);
  return id;
}

// Source HTML is data. Only tags constructed by this renderer reach the page.
export function renderMarkdown(markdown, { source = 'README.md', ids = new Set(), routes = sourceRoutes() } = {}) {
  const references = new Map();
  markdown = markdown.replace(/^---\n[^]*?\n---\n/, '').replace(/<!--[^]*?-->/g, '');
  markdown = markdown.replace(/^\[([^\]]+)\]:\s*(\S+).*$/gm, (_, label, href) => { references.set(label.toLowerCase(), href); return ''; });
  function inline(value, tokens = []) {
    const save = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
    value = value.replace(/`([^`]+)`/g, (_, code) => save(`<code>${escape(code)}</code>`));
    value = value.replace(/<(script|style|iframe|object|svg)\b[^>]*>[^]*?<\/\1\s*>/gi, '').replace(/<\/?[a-z][^>]*>/gi, '');
    value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, href) => {
      const src = rewriteUrl(href, source, { image: true, routes });
      return save(src ? `<img src="${escape(src)}" alt="${escape(alt)}" loading="lazy">` : '');
    });
    value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const url = rewriteUrl(href, source, { routes });
      const rendered = inline(label, tokens);
      return save(rendered.trim() && url ? `<a href="${escape(url)}">${rendered}</a>` : rendered);
    });
    value = value.replace(/\[([^\]]+)\](?:\[([^\]]*)\])?/g, (whole, label, reference) => {
      const href = references.get((reference || label).toLowerCase());
      if (!href) return whole;
      const url = rewriteUrl(href, source, { routes });
      const rendered = inline(label, tokens);
      return save(rendered.trim() && url ? `<a href="${escape(url)}">${rendered}</a>` : rendered);
    });
    value = escape(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return value.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
  }
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (/^\s*```/.test(line)) {
      const code = [];
      index++;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      index++;
      blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    // Drop active raw HTML blocks before joining their lines into paragraphs.
    if (/^\s*<(script|style|iframe|object|svg)\b/i.test(line)) {
      const tag = line.match(/<(\w+)/)[1];
      const raw = [];
      do { raw.push(lines[index]); if (new RegExp(`</${tag}\\s*>`, 'i').test(lines[index++])) break; } while (index < lines.length);
      const safe = inline(raw.join('\n'));
      if (safe.trim()) blocks.push(`<p>${safe}</p>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const depth = Math.max(2, heading[1].length);
      const text = inline(heading[2]);
      blocks.push(`<h${depth} id="${uniqueId(text, ids)}">${text}</h${depth}>`);
      index++; continue;
    }
    if (/^\|/.test(line) && /^\|\s*:?-{3}/.test(lines[index + 1] || '')) {
      const cells = value => value.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => inline(cell.trim().replace(/\\\|/g, '|')));
      const head = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && /^\|/.test(lines[index])) rows.push(cells(lines[index++]));
      blocks.push(`<div class="table-scroll"><table><thead><tr>${head.map(cell => `<th scope="col">${cell}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line), items = [];
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      while (index < lines.length && pattern.test(lines[index])) items.push(`<li>${inline(lines[index++].replace(pattern, ''))}</li>`);
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push(`<blockquote><p>${inline(quote.join('\n'))}</p></blockquote>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { blocks.push('<hr>'); index++; continue; }
    const paragraph = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,6}\s|\s*```|\||>|\s*[-*]\s|\s*\d+\.\s|\s*<(?:script|style|iframe|object|svg)\b)/i.test(lines[index])) paragraph.push(lines[index++]);
    const rendered = inline(paragraph.join('\n'));
    if (rendered.trim()) blocks.push(`<p>${rendered}</p>`);
  }
  return blocks.join('\n');
}

// Border ray from https://aunysillyme.dev/; decorative on every card.
function cardTrace() {
  return '<svg class="card-trace" aria-hidden="true" focusable="false"><rect class="ray-tail" x=".5" y=".5" pathLength="100"/><rect class="ray-mid" x=".5" y=".5" pathLength="100"/><rect class="ray-tip" x=".5" y=".5" pathLength="100"/></svg>';
}

function proofTable(facts) {
  const labels = content.proof;
  return `<div class="proof-card card">${cardTrace()}<div class="table-scroll"><table class="proof-table"><thead><tr>${[labels.measurement, labels.value, labels.measured, labels.expires].map(label => `<th scope="col">${escape(label)}</th>`).join('')}</tr></thead><tbody>\n${facts.proof.map(row => `<tr data-proof="${escape(row.id)}"><th scope="row">${escape(row.claim)}${row.id === 'measure-fixture' ? ` (${escape(labels.fixture)})` : ''}</th><td data-value>${escape(row.value)} ${escape(row.unit)}</td><td data-measured>${escape(row.measured_at.slice(0, 10))}</td><td data-expires>${escape(row.expires_at.slice(0, 10))}</td></tr>`).join('\n')}\n</tbody></table></div></div>`;
}

function toolBlocks(page, facts, ids) {
  return page.tools.map(id => {
    const tool = facts.tools.find(tool => tool.id === id);
    return `<article data-tool="${escape(id)}" class="tool card">${cardTrace()}<p class="eyebrow">${escape(tool.kind)}</p><h3 id="${uniqueId(`${tool.name}: ${tool.keywords.primary}`, ids)}">${escape(tool.name)}: ${escape(tool.keywords.primary)}</h3><p data-does>${escape(tool.does)}</p>${tool.commands.map(command => `<pre><code>${escape(command)}</code></pre>`).join('')}</article>`;
  }).join('\n');
}

function docsBody(root, page, facts) {
  const ids = new Set(['main', 'page-title']);
  const chunks = [];
  for (const source of page.sources) {
    let markdown;
    if (source === 'proof/results.json') {
      chunks.push(proofTable(facts)); continue;
    }
    markdown = read(root, source);
    if (source === 'README.md') markdown = markdown.replace(/<!-- set:start -->[^]*?<!-- set:end -->/, `## Part of a set\n\n${siblings(root).map(link => `[${link.name}](${link.href})`).join(' · ')}`);
    if (source === 'README.md' && page.route === '/docs/commands/') markdown = ['Install where you work', 'Add native hooks', 'Check your environment', 'Measure your own transcripts', 'Uninstall'].map(heading => section(markdown, heading)).join('\n\n');
    if (source === 'README.md' && page.route === '/docs/proof/') markdown = section(markdown, 'What is measured').replace(/<!-- proof:start -->[^]*?<!-- proof:end -->/, '');
    if (page.route === '/docs/guarantees/' && source !== 'hooks/README.md') {
      if (source === 'agents/desk-runner.md') markdown = markdown.slice(markdown.indexOf('## Boundaries'));
    }
    if (source === 'README.md') markdown = markdown.replace(/<!-- proof:start -->[^]*?<!-- proof:end -->/, '');
    if (source === page.sources[0]) markdown = markdown.replace(/^# [^\n]+\n/, '');
    chunks.push(`<section class="source-section"><p class="source-note">${escape(content.sourceLabel)} <a href="${repository}/blob/main/${escape(source)}">${escape(source)}</a></p>\n${renderMarkdown(markdown, { source, ids })}</section>`);
  }
  return `<article class="markdown">${chunks.join('\n')}${toolBlocks(page, facts, ids)}</article>`;
}

function siblings(root) {
  return [...section(read(root, 'README.md'), 'Part of a set').matchAll(/\[([^\]]+)\]\((https:\/\/github\.com\/aunysillyme\/[^)]+)\)/g)].map(([, name, href]) => ({ name, href }));
}

function flow(facts) {
  return `<div class="routing card" id="flow">${cardTrace()}<div class="routing-head"><span>A MAC APP TASK</span><span>ILLUSTRATIVE FLOW</span></div><div class="task-tabs" role="group" aria-label="App task process">${facts.process.map(([name, caption], index) => `<button class="card" type="button" data-caption="${escape(caption)}" data-task="${name.toLowerCase()}" aria-pressed="${index === 0}">${escape(name)}</button>`).join('')}</div><div class="task" id="task-text" aria-live="polite">${escape(facts.process[0][1])}</div><div class="stem"></div><div class="route-core selected card" data-role="frame">MAIN SESSION · FRAME THE TASK</div><div class="split"></div><div class="route-options"><div class="card" data-role="run"><b>desk-runner</b>Calculator in the background</div><div class="card" data-role="read"><b>Saved read</b>Full evidence in a file</div><div class="card" data-role="verify"><b>Main session</b>Check value and cleanup</div></div><p class="route-foot">A fresh desk-runner handles one native Mac app task.<br>Example from the README: enter a value in Calculator.</p></div>`;
}

function landingBody(root, facts) {
  const heading = (title, id, body, label = '', classes = '') => `<section class="content ${classes}" id="${id}"><div class="section-title"><h2>${escape(title)}</h2>${label ? `<span>${escape(label)}</span>` : ''}</div>${body}</section>`;
  const release = readRelease(root, facts.version);
  const faq = facts.faq.map(row => `<details><summary data-faq-question>${escape(row.question)}</summary><p data-faq-answer>${renderMarkdown(row.answerMarkdown, { source: 'README.md' }).replace(/^<p>|<\/p>$/g, '')}</p></details>`).join('\n');
  return `<div class="crumb"><a href="https://aunysillyme.dev/">Home</a><span>/</span><b>${escape(facts.name)}</b></div>
<section class="hero" id="overview"><div><p class="eyebrow">${escape(content.eyebrow)}</p><h1>${escape(content.headline)}<br><em>${escape(content.headlineAccent)}</em></h1><p class="lede">${escape(content.heroContext)} ${escape(content.headlineSource)}</p><div class="install card">${cardTrace()}<span class="dollar" aria-hidden="true">$</span><code id="install-command">${escape(content.install.command)}</code><button class="copy card" type="button" data-copy="install-command" aria-label="${escape(content.install.copy)}" title="${escape(content.install.copy)}">⧉</button></div><p id="copy-status" role="status" class="sr-only" data-success="${escape(content.install.copySuccess)}" data-fallback="${escape(content.install.copyFallback)}"></p><div class="hero-actions"><a class="primary card" href="#quickstart">Get started ↓</a><a class="card" href="${repository}">Explore the source ↗</a></div></div>${flow(facts)}</section>
<div class="trust">${content.chips.map(chip => `<span>${escape(chip)}</span>`).join('')}</div>
${heading(content.sections.trailer, 'trailer', `<video autoplay muted loop playsinline preload="auto" width="1280" height="720" poster="/assets/trailer-poster.jpg" aria-label="Lean-computer-use trailer" aria-describedby="trailer-note"><source src="/assets/trailer.webm" type="video/webm"><source src="/assets/trailer.mp4" type="video/mp4">Your browser does not support embedded video. <a href="/assets/trailer.mp4">Watch the trailer ↗</a></video><div class="trailer-caption"><p class="note" id="trailer-note">A quick look at lean-computer-use. Silent video.</p><button type="button" class="trailer-toggle" aria-pressed="false" aria-label="Play trailer"><svg class="icon-pause" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><rect x="2" y="1.5" width="3" height="9"/><rect x="7" y="1.5" width="3" height="9"/></svg><svg class="icon-play" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 1.5v9l7.5-4.5z"/></svg><span class="sr-only" data-button-label>Play trailer</span></button></div>`, 'APP ACTIONS & EVIDENCE', 'trailer')}
${heading(content.columnsTitle, 'how-it-works', `<div class="three">${content.columns.map((column, index) => `<article class="card">${cardTrace()}<div class="feature-num">${String(index + 1).padStart(2, '0')} / ${escape(column.label)}</div><h3>${escape(column.title)}</h3><p>${escape(column.text)}</p><a href="${escape(column.href)}">${escape(column.link)} ↗</a></article>`).join('')}</div>`, content.sectionLabels.how)}
${heading(content.install.title, 'quickstart', `<div class="docs-grid"><div>${content.install.steps.map((step, index) => `<div class="step"><b>${String(index + 1).padStart(2, '0')}</b><div>${escape(step.title)}<p>${escape(step.text)}</p></div></div>`).join('')}</div><div><div class="code card">${cardTrace()}<pre><code>${escape(content.install.commands.join('\n\n'))}</code></pre></div><p class="note">${escape(content.install.note)}<br><a href="/docs/install/">${escape(content.install.guide)} ↗</a></p></div></div>`, content.sectionLabels.install)}
${heading(content.deeper.title, 'reference', `<div class="docs-links">${content.deeper.cards.map(card => `<a class="doc-link card" href="${escape(card.href)}">${cardTrace()}${escape(card.title)} ↗<span>${escape(card.text)}</span></a>`).join('')}</div>`, content.sectionLabels.deeper)}
${heading(content.sections.evidence, 'proof', `${proofTable(facts)}<div class="docs-grid"><p class="note">${escape(content.proof.intro)} ${escape(content.proof.note)}</p><div class="hero-actions"><a class="primary card" href="/docs/proof/">${escape(content.proof.details)} ↗</a><a class="card" href="/docs/guarantees/">${escape(content.proof.guarantees)} ↗</a></div></div>`, content.sectionLabels.evidence)}
${heading(content.sections.fresh, 'releases', `<div class="release"><strong>v${escape(release.version)}<small>${release.verified ? '' : escape(content.release.pending)}</small></strong><div class="release-copy"><p>${escape(content.release.text)}</p><a href="/docs/changelog/">${escape(content.release.changelog)} ↗</a></div></div>`, content.sectionLabels.fresh)}
${heading(content.sections.requirements, 'requirements', `<div class="requirements">${content.requirements.map(item => `<article class="card">${cardTrace()}<h3>${escape(item.title)}</h3><p>${escape(item.text)}</p></article>`).join('')}</div>`)}
${heading(content.sections.questions, 'questions', `<div class="faq">${faq}</div>`)}
${heading(content.sections.set, 'set', `<p class="note">${siblings(root).map(link => `<a href="${escape(link.href)}">${escape(link.name)} ↗</a>`).join(' · ')}</p>`)}
<p class="note"><a href="${repository}/blob/main/CREDITS.md">Credits</a> · <a href="https://github.com/trycua/cua">Upstream driver ↗</a></p>`;
}

function readRelease(root, version) {
  if (!existsSync(join(root, 'website/release.json'))) return { version, verified: false };
  const release = json(root, 'website/release.json');
  if (release.verified !== true) return { version, verified: false };
  requireValue(typeof release.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version), 'Invalid verified release version');
  return release;
}

function navLinks(page) {
  return page.route === '/' ? content.nav.map(link => `<a href="${escape(link.href)}"${link.href === '#overview' ? ' class="active" aria-current="location"' : ''}>${escape(link.label)}</a>`).join('\n')
    : pages.filter(item => item.route !== '/').map(item => `<a href="${item.route}"${item.route === page.route ? ' class="active" aria-current="page"' : ''}>${escape(item.h1)}</a>`).join('\n');
}

function sidebar(root, page) {
  return `<p class="side-label">${page.route === '/' ? escape(content.brand.toUpperCase()) : 'DOCUMENTATION'}</p><nav class="side-links" aria-label="Documentation">${navLinks(page)}</nav><p class="side-label">THE REST OF THE SET</p><nav class="side-links" aria-label="Related repositories">${siblings(root).map(link => `<a href="${escape(link.href)}" target="_blank" rel="noopener noreferrer">${escape(link.name)} ↗</a>`).join('')}</nav><div class="side-bottom"><div>Questions or feedback?</div><a class="issue-button" href="${repository}/issues/new/choose" aria-label="File an issue for lean-computer-use on GitHub">File an issue ↗</a><span>Open source · MIT license</span></div>`;
}

function head(page, facts, live, notFound = false) {
  const url = `${origin}${page.route}`;
  const blocks = [];
  if (page.route === '/' && !notFound) blocks.push(buildJsonLd(facts, { live }), buildFaqJsonLd(facts));
  else if (!notFound) blocks.push({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: content.breadcrumbs.home, item: `${origin}/` },
    { '@type': 'ListItem', position: 2, name: content.breadcrumbs.section, item: `${origin}/docs/overview/` },
    { '@type': 'ListItem', position: 3, name: page.h1, item: url },
  ] });
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">
<title>${escape(page.title)}</title>
<meta name="description" content="${escape(page.description)}">
<link rel="canonical" href="${url}">
${!live || notFound ? '<meta name="robots" content="noindex">' : `<link rel="describedby" href="${origin}/llms.txt">
<link rel="alternate" type="text/markdown" href="${url}index.md">
<meta property="og:type" content="website">
<meta property="og:title" content="${escape(page.title)}">
<meta property="og:description" content="${escape(page.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}/assets/social-preview.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escape(content.socialAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(page.title)}">
<meta name="twitter:description" content="${escape(page.description)}">
<meta name="twitter:image" content="${origin}/assets/social-preview.png">
<meta name="twitter:image:alt" content="${escape(content.socialAlt)}">`}
<link rel="icon" href="/assets/avatar.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${escape(fontStylesheet)}" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/site.js" defer></script>
<script type="module" src="/assets/navigation.js"></script>
<script type="module" src="/assets/trailer.js"></script>
${blocks.map(block => `<script type="application/ld+json">${JSON.stringify(block, null, 2).replace(/</g, '\\u003c')}</script>`).join('\n')}`;
}

function footer(commit) {
  return `<footer class="bottom"><span>Built by <a href="https://aunysillyme.dev/">AunySillyMe</a> · ${escape(content.footer.text)}</span><a href="${repository}">${escape(content.footer.repository)} ↗</a><span>${escape(content.footer.source)} <a href="${repository}/commit/${commit}">${commit.slice(0, 7)}</a></span></footer>`;
}

function documentBody(page, body) {
  const sourceNote = body.match(/<p class="source-note">[^]*?<\/p>/)?.[0] || '';
  body = body.replace(sourceNote, '');
  return `<nav class="crumb" aria-label="${escape(content.breadcrumbs.label)}"><a href="/">${escape(content.breadcrumbs.home)}</a><span aria-hidden="true">/</span><a href="/docs/overview/">${escape(content.breadcrumbs.section)}</a><span aria-hidden="true">/</span><span aria-current="page">${escape(page.h1)}</span></nav>${sourceNote}<h1 class="document-title" id="page-title">${escape(page.h1)}</h1>${body}`;
}

function template(root, page, body, facts, live, commit, notFound = false) {
  const file = page.route === '/' && !notFound ? 'landing.template.html' : 'doc.template.html';
  const header = `<a class="skip" href="#main">${escape(content.skip)}</a><header class="top"><a class="brand" href="${page.route === '/' ? 'https://aunysillyme.dev/' : '/'}"><img src="/assets/avatar.png" alt="AunySillyMe"><span>${page.route === '/' ? 'AunySillyMe.dev' : escape(content.brand)}</span>${page.route === '/' ? `<span class="slash">/</span><b>${escape(content.brand)}</b>` : ''}</a><nav class="topnav" aria-label="${escape(content.projectLinks)}">${page.route === '/' ? `<span class="pill"><i class="dot"></i><span>v${escape(facts.version)}</span></span>` : '<a href="/">Home</a>'}<a href="${repository}">GitHub ↗</a>${page.route === '/' ? `<a href="${facts.npm}">npm ↗</a>` : ''}</nav></header>`;
  const mobileNav = `<details class="mobile-nav"><summary>${page.route === '/' ? content.onThisPage : 'Documentation'}</summary><nav aria-label="Mobile documentation">${navLinks(page)}</nav></details>`;
  const values = { head: head(page, facts, live, notFound), header, sidebar: sidebar(root, page), mobileNav, body, footer: footer(commit), pageClass: file.startsWith('doc') ? 'document' : 'landing' };
  return read(root, `website/${file}`).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    requireValue(Object.hasOwn(values, key), `Unknown template slot: ${key}`);
    return values[key];
  });
}

function validateRendered(documents, facts) {
  for (const { page, html } of documents) {
    requireValue((html.match(/<h1\b/g) || []).length === 1, `Expected one H1: ${page.route}`);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    requireValue(ids.length === new Set(ids).size, `Duplicate anchor: ${page.route}`);
    for (const match of html.matchAll(/<h[1-6]\b[^>]*>([^]*?)<\/h[1-6]>/g)) requireValue(!/your agent keeps working/i.test(visibleText(match[1])), `Forbidden headline: ${page.route}`);
  }
  const landing = documents.find(({ page }) => page.route === '/').html;
  const hero = visibleText(landing.split('<section class="hero"')[1]?.split('</section>')[0] || '');
  for (const keyword of ['computer use', 'Mac', 'background', 'native apps', 'Claude Code']) requireValue(hero.includes(keyword), `Hero missing keyword: ${keyword}`);
  for (const tool of facts.tools) {
    const matches = documents.flatMap(({ page, html }) => [...html.matchAll(/<article data-tool="([^"]+)"[^>]*>([^]*?)<\/article>/g)].filter(match => match[1] === tool.id).map(match => ({ page, body: match[2] })));
    requireValue(matches.length === 1, `Rendered tool missing or duplicated: ${tool.id}`);
    const title = visibleText(matches[0].body.match(/<h3\b[^>]*>([^]*?)<\/h3>/)?.[1] || '');
    requireValue(title.toLowerCase().includes(tool.keywords.primary.toLowerCase()), `Tool heading missing primary phrase: ${tool.id}`);
  }
}

function markdownTwin(html, page) {
  let body = html.match(/<main\b[^>]*>([^]*?)<\/main>/)?.[1] || '';
  body = body.replace(/<details class="mobile-nav">[^]*?<\/details>/g, '').replace(/<footer\b[^>]*>[^]*?<\/footer>/g, '').replace(/<nav\b[^>]*>[^]*?<\/nav>/g, '');
  body = body.replace(/<h([1-6])\b[^>]*>([^]*?)<\/h\1>/g, (_, depth, text) => `\n\n${'#'.repeat(Number(depth))} ${visibleText(text)}\n\n`)
    .replace(/<a href="([^"]+)"[^>]*>([^]*?)<\/a>/g, (_, href, text) => `[${visibleText(text)}](${href.startsWith('/') ? origin : ''}${href.replace(/&amp;/g, '&')})`)
    .replace(/<pre><code>([^]*?)<\/code><\/pre>/g, (_, code) => `\n\n\`\`\`\n${decode(code)}\n\`\`\`\n\n`)
    .replace(/<code>([^]*?)<\/code>/g, (_, code) => `\`${decode(code)}\``)
    .replace(/<\/(?:p|div|section|article|details|tr|li|figure|summary)>/g, '\n\n').replace(/<\/(?:th|td)>/g, ' | ')
    .replace(/<[^>]+>/g, '');
  return `Canonical: ${origin}${page.route}\n\n${decode(body).replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);
}

export function buildSite({ root = fileURLToPath(new URL('..', import.meta.url)), outDir = join(root, 'website/dist'), live = false, commit, buildTime = new Date().toISOString() } = {}) {
  // Check all inputs and render in memory before replacing the output directory.
  const facts = loadSourceFacts(root);
  validatePages(facts);
  commit ||= process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  requireValue(/^[a-f0-9]{40}$/i.test(commit), 'Expected a full source commit SHA');
  const documents = pages.map(page => ({ page, html: template(root, page, page.route === '/' ? landingBody(root, facts) : documentBody(page, docsBody(root, page, facts)), facts, live, commit) }));
  validateRendered(documents, facts);
  const pinFailures = checkCopyPins({ root, html: documents[0].html });
  requireValue(pinFailures.length === 0, pinFailures.join('\n'));
  for (const asset of assets) requireValue(existsSync(join(root, 'website/assets', asset)), `Asset missing${live && media.includes(asset) ? " for live build" : ""}: website/assets/${asset}`);
  const output = resolve(outDir);
  requireValue(output !== resolve(root) && output !== resolve(root, 'website') && !resolve(root).startsWith(`${output}/`), 'Output must be a separate build directory');
  rmSync(output, { recursive: true, force: true });
  const write = (file, value) => { mkdirSync(dirname(join(output, file)), { recursive: true }); writeFileSync(join(output, file), value); };
  for (const { page, html } of documents) write(`${page.route.slice(1)}index.html`, html);
  const missing = { route: '/404.html', title: content.notFound.title, description: content.notFound.text, h1: content.notFound.title };
  write('404.html', template(root, missing, `<h1>${escape(missing.h1)}</h1><p>${escape(missing.description)}</p><a href="/">${escape(content.notFound.link)}</a>`, facts, false, commit, true));
  mkdirSync(join(output, 'assets'), { recursive: true });
  for (const asset of assets) copyFileSync(join(root, 'website/assets', asset), join(output, 'assets', asset));
  write('robots.txt', live ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n');
  if (live) {
    write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page => `  <url><loc>${origin}${page.route}</loc></url>`).join('\n')}\n</urlset>\n`);
    const twins = documents.map(({ page, html }) => ({ page, markdown: markdownTwin(html, page) }));
    for (const { page, markdown } of twins) write(`${page.route.slice(1)}index.md`, markdown);
    write('llms.txt', `# ${facts.name}\n\n> ${facts.lead}\n\n${content.discovery.install} \`${content.install.command}\`\n\n## ${content.discovery.pages}\n\n${pages.map(page => `- [${page.h1}](${origin}${page.route}): ${page.description}`).join('\n')}\n\n## ${content.discovery.source}\n\n- [${content.discovery.readme}](${repository}/blob/main/README.md)\n- [${content.discovery.npm}](${facts.npm})\n`);
    write('llms-full.txt', twins.map(twin => twin.markdown).join('\n---\n\n'));
  }
  write('build-info.json', JSON.stringify({ commit, buildTime, packageVersion: facts.version, mode: live ? 'live' : 'default', pageCount: pages.length }, null, 2) + '\n');
  function count(directory) { return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? count(join(directory, entry.name)) : 1), 0); }
  return { pages: documents, files: count(output), outDir: output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.length <= 1 && args.every(arg => arg === '--live'), 'Usage: node website/build.mjs [--live]');
    const result = buildSite({ live: args.includes('--live') });
    console.log(`Built ${result.pages.length} pages and ${result.files} files (${args.includes('--live') ? 'live' : 'default'}).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
