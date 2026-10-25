import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const defaultPattern = '^mcp__(computer-use|cua-driver)__';
const usageKeys = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
const number = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

function firstWord(command, start = 0) {
  let value = '';
  let quote = '';
  let index = start;
  while (/\s/.test(command[index] || '') && index < command.length) index++;
  for (; index < command.length; index++) {
    const character = command[index];
    if (character === '\\' && quote !== "'" && index + 1 < command.length) { value += command[++index]; continue; }
    if (quote) {
      if (character === quote) quote = '';
      else value += character;
    } else if (character === '"' || character === "'") quote = character;
    else if (/\s|[;&|<>]/.test(character)) break;
    else value += character;
  }
  return { value, end: index };
}

function commandSegments(command) {
  const segments = [];
  let part = '';
  let quote = '';
  let escaped = false;
  let comment = false;
  let bodies = [];
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (comment && character !== '\n') continue;
    if (character === '\n') comment = false;
    if (escaped) { part += character; escaped = false; continue; }
    if (character === '\\' && quote !== "'") { part += character; escaped = true; continue; }
    if (quote) { part += character; if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; part += character; continue; }
    if (character === '#' && (index === 0 || /\s|[;&|]/.test(command[index - 1]))) { comment = true; continue; }
    if (character === '<' && command[index + 1] === '<' && command[index - 1] !== '<' && command[index + 2] !== '<') {
      const stripTabs = command[index + 2] === '-';
      const marker = firstWord(command, index + (stripTabs ? 3 : 2));
      if (marker.value) bodies.push({ marker: marker.value, stripTabs });
      part += command.slice(index, marker.end);
      index = marker.end - 1;
      continue;
    }
    if (/[;&|\n]/.test(character)) {
      segments.push(part);
      part = '';
      if (character === '\n' && bodies.length) {
        for (const body of bodies) {
          while (index < command.length) {
            const next = command.indexOf('\n', index + 1);
            const end = next < 0 ? command.length : next;
            const line = command.slice(index + 1, end);
            index = end;
            if ((body.stripTabs ? line.replace(/^\t+/, '') : line) === body.marker) break;
          }
        }
        bodies = [];
      }
      continue;
    }
    part += character;
  }
  segments.push(part);
  return segments;
}

export function isDeskCommand(command) {
  if (typeof command !== 'string') return false;
  return commandSegments(command).some(segment => ['desk', 'desk-read', 'desk-clean'].includes(firstWord(segment).value.split('/').pop()));
}

export function transcriptFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (entry.isSymbolicLink() || ['.git', 'node_modules', '.venv', 'dist', 'build'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? transcriptFiles(path) : entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : [];
  });
}

export function groupStats(messages) {
  const totals = messages.map(message => message.total).sort((a, b) => a - b);
  const steps = totals.length;
  const total = totals.reduce((sum, value) => sum + value, 0);
  const reread = messages.reduce((sum, message) => sum + message.reread, 0);
  const middle = Math.floor(steps / 2);
  return {
    steps,
    median: !steps ? 0 : steps % 2 ? totals[middle] : (totals[middle - 1] + totals[middle]) / 2,
    p90: steps ? totals[Math.ceil(steps * 0.9) - 1] : 0,
    mean: steps ? total / steps : 0,
    total,
    rereadShare: total ? reread / total : 0,
  };
}

/** @param {{projectsDir?: string, since?: string, toolPattern?: string}} options */
export function measureTranscripts(options = {}) {
  const directory = resolve(options.projectsDir || join(homedir(), '.claude/projects'));
  const pattern = new RegExp(options.toolPattern || defaultPattern);
  let since = null;
  if (options.since) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.since) || !Number.isFinite(Date.parse(options.since)) || new Date(options.since).toISOString().slice(0, 10) !== options.since) throw new Error('--since needs a date in YYYY-MM-DD form');
    since = Date.parse(options.since);
  }
  const files = transcriptFiles(directory);
  const messages = new Map();
  let malformedLines = 0;
  for (const path of files) {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { malformedLines++; continue; }
      if (!entry || typeof entry !== 'object') continue;
      const message = entry.message;
      if (entry.type !== 'assistant' && message?.role !== 'assistant') continue;
      if (!message || !Array.isArray(message.content)) continue;
      if (since !== null) {
        const timestamp = Date.parse(entry.timestamp || message.timestamp || '');
        if (!Number.isFinite(timestamp) || timestamp < since) continue;
      }
      const native = message.content.some(block => {
        if (block?.type !== 'tool_use') return false;
        pattern.lastIndex = 0;
        return typeof block.name === 'string' && (pattern.test(block.name) || block.name === 'Bash' && isDeskCommand(block.input?.command));
      });
      const usage = message.usage || {};
      const total = usageKeys.reduce((sum, key) => sum + number(usage[key]), 0);
      const reread = number(usage.cache_creation_input_tokens) + number(usage.cache_read_input_tokens);
      const id = typeof message.id === 'string' && message.id ? message.id : `${path}:${lineIndex}`;
      const current = messages.get(id);
      const value = { total, reread, native: native || current?.native || false, sidechain: Boolean(entry.isSidechain) };
      if (!current || total > current.total) messages.set(id, value);
      else if (native) current.native = true;
    }
  }
  const values = [...messages.values()].filter(message => message.native);
  return {
    files: files.length,
    malformedLines,
    main: groupStats(values.filter(message => !message.sidechain)),
    subagent: groupStats(values.filter(message => message.sidechain)),
  };
}

export function parseMeasureArgs(args) {
  /** @type {Record<string, any>} */
  const options = { json: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') options.json = true;
    else if (['--projects-dir', '--since', '--tool-pattern'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw Object.assign(new Error(`Missing value for ${arg}`), { exitCode: 2 });
      options[{ '--projects-dir': 'projectsDir', '--since': 'since', '--tool-pattern': 'toolPattern' }[arg]] = value;
    } else throw Object.assign(new Error(`Unknown option: ${arg}`), { exitCode: 2 });
  }
  return options;
}

/** @param {string[]} args @param {{write?: (line: string) => void}} adapters */
export function measureCommand(args = [], adapters = {}) {
  const options = parseMeasureArgs(args);
  const write = adapters.write || console.log;
  const result = measureTranscripts(options);
  if (options.json) { write(JSON.stringify(result, null, 2)); return 0; }
  if (result.main.steps + result.subagent.steps === 0) { write(`0 native-app steps found in ${result.files} files`); return 0; }
  write('Group     Steps  Median  P90  Mean  Total  Re-read');
  for (const group of ['main', 'subagent']) {
    const value = result[group];
    write(`${group.padEnd(9)} ${value.steps}      ${value.median}     ${value.p90}  ${Number(value.mean.toFixed(1))}   ${value.total}    ${(value.rereadShare * 100).toFixed(1)}%`);
  }
  write(`Files: ${result.files}; malformed lines skipped: ${result.malformedLines}`);
  return 0;
}
