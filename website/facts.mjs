import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = 'https://lean-computer-use.aunysillyme.dev/';
const read = (root, file) => readFileSync(join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
const compact = text => text.replace(/\s+/g, ' ').trim();
const requireFact = (ok, message) => { if (!ok) throw Error(message); };
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function visibleText(html) {
  return compact(html.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^]*?<\/\1>/gi, '')
    .replace(/<\/?(?:a|code|strong|em|span|time)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
    })[entity]));
}

function markdownText(text) {
  return compact(text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`([^`]+)`/g, '$1'));
}

function section(readme, heading) {
  const text = readme.split(`## ${heading}\n`)[1]?.split('\n## ')[0];
  requireFact(text, `README section missing: ${heading}`);
  return text.trim();
}

function table(text) {
  return text.split('\n').filter(line => /^\|/.test(line)).slice(2).map(line =>
    line.slice(1, -1).split('|').map(cell => cell.trim()));
}

export function buildJsonLd(facts, { live = false } = {}) {
  return {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', '@id': `${site}#software`,
    name: facts.name, description: facts.description, applicationCategory: 'DeveloperApplication',
    operatingSystem: 'macOS', softwareRequirements: 'Python 3, cua-driver, Node.js 22 or later',
    license: 'https://spdx.org/licenses/MIT.html', isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, url: site,
    author: { '@type': 'Person', '@id': 'https://www.aunysillyme.com/#person', name: 'Auny', url: 'https://www.aunysillyme.com/' },
    publisher: { '@type': 'Organization', '@id': 'https://www.aunysillyme.com/#organization', name: 'AunySillyMe', url: 'https://www.aunysillyme.com/' },
    ...(live ? { sameAs: [facts.repository, facts.npm] } : {}),
  };
}

export function buildFaqJsonLd(facts) {
  return {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: facts.faq.map(({ question, answer }) => ({
      '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

export function validateTools(root, tools) {
  const ids = new Set();
  requireFact(Array.isArray(tools) && tools.length === 11, 'Expected eleven tool entries');
  for (const tool of tools) {
    requireFact(tool.id && !ids.has(tool.id), `Tool id missing or duplicated: ${tool.id}`);
    ids.add(tool.id);
    requireFact(tool.name && tool.kind && tool.does && tool.keywords?.primary, `Incomplete tool: ${tool.id}`);
    requireFact(Array.isArray(tool.keywords.secondary) && tool.keywords.secondary.length <= 3, `Invalid keywords: ${tool.id}`);
    requireFact(tool.source?.length && tool.must_appear?.length && Array.isArray(tool.commands), `Missing tool evidence: ${tool.id}`);
    const sources = tool.source.map(file => {
      requireFact(!file.startsWith('/') && !file.split('/').includes('..'), `Source must be repo relative: ${tool.id}`);
      return read(root, file);
    }).join('\n');
    for (const literal of tool.must_appear) requireFact(literal && sources.includes(literal), `Source evidence missing for ${tool.id}: ${literal}`);
    const documented = sources + '\n' + read(root, 'README.md');
    for (const command of tool.commands) {
      requireFact(/^(?:npx lean-computer-use|desk-read|desk-clean|desk)(?:\s|$)/.test(command), `Invalid command for ${tool.id}: ${command}`);
      validateCommand(command, documented, tool.id);
    }
  }
}

export function validateCommand(command, documented, label = 'code block') {
  if (!/^(?:npx lean-computer-use|desk-read|desk-clean|desk)(?:\s|$)/.test(command)) return;
  const words = command.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g) || [];
  const flags = new Set(documented.match(/(?<![\w-])--?[a-zA-Z][a-zA-Z0-9-]*/g) || []);
  for (const word of words) {
    const flag = word.replace(/^['"]|['"]$/g, '').match(/^(--?[a-zA-Z][^=\s]*)(?:=|$)/)?.[1];
    requireFact(!flag || flags.has(flag), `Undocumented flag for ${label}: ${flag}`);
  }
}

export function commandEvidence(root, tools) {
  const docs = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? docs(file) : entry.isFile() && file.endsWith('.md') ? [file] : [];
  });
  const common = ['README.md', ...docs('docs')].map(file => read(root, file)).join('\n');
  return command => {
    const name = command.match(/^(npx lean-computer-use|desk-read|desk-clean|desk)(?:\s|$)/)?.[1];
    const ids = name === 'npx lean-computer-use' ? ['installer', 'doctor', 'measure']
      : name === 'desk-read' ? ['read'] : name === 'desk-clean' ? ['clean'] : ['desk'];
    return common + '\n' + [...new Set(tools.filter(tool => ids.includes(tool.id)).flatMap(tool => tool.source))]
      .map(file => read(root, file)).join('\n');
  };
}

function elements(html, attribute, tag = '[a-z][a-z0-9]*') {
  return [...html.matchAll(new RegExp(`<(${tag})\\b[^>]*\\b${attribute}(?:="([^"]*)")?[^>]*>([^]*?)<\\/\\1>`, 'gi'))];
}

export function keywordCounts(facts, html) {
  const text = visibleText(html.match(/<body\b[^>]*>([^]*?)<\/body>/i)?.[1] || '');
  const vocabulary = [...facts.keywords, ...facts.faq.map(row => row.question),
    'computer use', 'native Mac apps', 'background', 'Claude Code', 'subagent', 'tokens', 'accessibility', 'cua-driver', 'hooks', 'transcript',
    ...facts.tools.flatMap(tool => [tool.keywords.primary, ...tool.keywords.secondary])];
  return [...new Set(vocabulary.map(word => word.toLowerCase()))].map(keyword => ({ keyword,
    count: [...text.toLowerCase().matchAll(new RegExp(`(?<![a-z0-9-])${escapeRegex(keyword)}(?![a-z0-9-])`, 'g'))].length,
  })).sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));
}

export function validateToolHeading(tool, block) {
  const heading = visibleText(block.match(/<h([2-6])\b[^>]*>([^]*?)<\/h\1>/i)?.[2] || '');
  requireFact(heading.toLowerCase().includes(tool.keywords.primary.toLowerCase()), `Heading missing primary phrase for ${tool.id}`);
}

export function validateKeywords(facts, html) {
  const body = html.match(/<body\b[^>]*>([^]*?)<\/body>/i)?.[1] || '';
  const text = visibleText(body);
  const h1 = [...body.matchAll(/<h1\b[^>]*>([^]*?)<\/h1>/gi)];
  requireFact(h1.length === 1, 'H1 must occur exactly once');
  const first = text.split(/\s+/).slice(0, 100).join(' ');
  for (const phrase of [facts.name, 'computer use', 'Mac', 'Claude Code']) requireFact(first.includes(phrase), `First 100 words missing ${phrase}`);
  requireFact(visibleText(h1[0][1].replace(/<\/span>/gi, '</span> ')) === 'Let your AI use Mac apps. In the background.', 'H1 must contain both approved headline lines');
  const title = visibleText(html.match(/<title>([^]*?)<\/title>/i)?.[1] || '');
  requireFact(title.length > 0 && title.length <= 60, 'Title must contain at most 60 characters');
  requireFact(title.includes(facts.name), 'Title must contain the package name');
  const description = html.match(/<meta name="description" content="([^"]*)"\s*\/?\s*>/i)?.[1];
  requireFact(description === facts.description, 'Meta description must equal package description');
  for (const { keyword, count } of keywordCounts(facts, html)) {
    requireFact(count <= 12, `Keyword occurs more than 12 times: ${keyword} (${count})`);
  }
  for (const [, , id, block] of elements(body, 'data-tool', 'article')) {
    const tool = facts.tools.find(tool => tool.id === id);
    requireFact(tool, `Unknown tool: ${id}`);
    validateToolHeading(tool, block);
  }
}

export function validateMock(facts, html) {
  validateKeywords(facts, html);
  const questions = elements(html, 'data-faq-question', 'summary').map(match => visibleText(match[3]));
  const answers = elements(html, 'data-faq-answer', 'p').map(match => visibleText(match[3]));
  requireFact(JSON.stringify(questions) === JSON.stringify(facts.faq.map(row => row.question)), 'FAQ questions differ from README');
  requireFact(JSON.stringify(answers) === JSON.stringify(facts.faq.map(row => row.answer)), 'FAQ answers differ from README');
  const rows = elements(html, 'data-proof', 'tr');
  requireFact(rows.length === facts.proof.length && new Set(rows.map(row => row[2])).size === rows.length, 'Proof rows missing or duplicated');
  for (const [, , id, cells] of rows) {
    const row = facts.proof.find(item => item.id === id);
    requireFact(row, `Unknown proof row: ${id}`);
    requireFact(Number.isFinite(row.value) && Number.isFinite(Date.parse(row.expires_at)), `Invalid proof row: ${id}`);
    requireFact(Date.parse(row.expires_at) >= Date.now(), `Proof expired: ${id} (${row.expires_at})`);
    const value = visibleText(elements(cells, 'data-value', 'td')[0]?.[3] || '');
    requireFact(value === `${row.value} ${row.unit}`, `Proof value differs for ${id}: ${value}`);
    const measured = visibleText(elements(cells, 'data-measured', 'td')[0]?.[3] || '');
    requireFact(measured === row.measured_at.slice(0, 10), `Proof measure date differs for ${id}`);
    if (id === 'measure-fixture') requireFact(visibleText(cells).includes('test fixture'), 'Fixture proof needs test fixture label');
  }
  for (const [, , id, block] of elements(html, 'data-tool', 'article')) {
    const tool = facts.tools.find(tool => tool.id === id);
    requireFact(visibleText(elements(block, 'data-does', 'p')[0]?.[3] || '') === tool.does, `Tool description differs for ${tool.id}`);
    const commands = [...block.matchAll(/<code>([^]*?)<\/code>/g)].map(match => visibleText(match[1]));
    requireFact(JSON.stringify(commands) === JSON.stringify(tool.commands.map(compact)), `Tool commands differ for ${tool.id}`);
  }
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  requireFact(JSON.stringify(blocks) === JSON.stringify([buildJsonLd(facts, { live: false }), buildFaqJsonLd(facts)]), 'JSON-LD blocks differ from generated facts');
}

export function loadFacts(root) {
  const pkg = json(root, 'package.json');
  const settings = table(read(root, 'REPO_SETTINGS.md')).find(row => row[0] === 'About description');
  requireFact(settings?.[1] === pkg.description, 'Description parity: package.json differs from REPO_SETTINGS.md About description');
  const readme = read(root, 'README.md');
  const faq = section(readme, 'Common questions').split(/^### /m).slice(1).map(block => {
    const [question, ...lines] = block.split('\n');
    const answerMarkdown = lines.join('\n').trim();
    return { question, answer: markdownText(answerMarkdown), answerMarkdown };
  });
  requireFact(faq.length === 6, 'README must contain six FAQ questions');
  const facts = {
    name: pkg.name, description: pkg.description, keywords: pkg.keywords,
    repository: pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
    npm: `https://www.npmjs.com/package/${pkg.name}`, url: site,
    lines: readme.split('\n').filter(line => /^(The problem:|What you get:|What you can do:)/.test(line)),
    process: table(section(readme, 'The process on screen')),
    setup: table(section(readme, 'What it sets up')),
    faq, proof: json(root, 'proof/results.json'), tools: json(root, 'website/tools.json'),
  };
  validateTools(root, facts.tools);
  validateMock(facts, read(root, 'website/mock/index.html'));
  return facts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireFact(args.every(arg => ['--check', '--write'].includes(arg)), 'Usage: node website/facts.mjs [--check] [--write]');
    const root = fileURLToPath(new URL('..', import.meta.url));
    const facts = loadFacts(root);
    if (args.includes('--write')) writeFileSync(join(root, 'website/facts.json'), JSON.stringify(facts, null, 2) + '\n');
    console.log(args.includes('--write') ? 'Wrote website/facts.json; parity checks passed.' : 'Website facts and parity checks passed.');
    console.log('Highest keyword counts: ' + keywordCounts(facts, read(root, 'website/mock/index.html')).slice(0, 3)
      .map(({ keyword, count }) => `${keyword}: ${count}`).join(', '));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
