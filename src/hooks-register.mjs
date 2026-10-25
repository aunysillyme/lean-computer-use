import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot, shellQuote, safeRelative } from './paths.mjs';

export const hookMarker = 'lean-computer-use';
const ours = entry => entry?.marker === hookMarker;

export function registrations(hooksDir, source = packageRoot) {
  const template = readFileSync(join(source, 'hooks/settings-snippet.json'), 'utf8');
  const result = JSON.parse(template);
  const events = result.hooks || result;
  for (const entries of Object.values(events)) {
    for (const entry of entries) {
      for (const hook of entry.hooks || []) {
        if (!hook.command?.includes('__HOOKS_DIR__')) continue;
        const match = /^(?:["'])?__HOOKS_DIR__\/([^"']+)(?:["'])?$/.exec(hook.command);
        if (!match) throw new Error('Hook template must name one local shim');
        hook.command = shellQuote(join(hooksDir, safeRelative(match[1])));
      }
    }
  }
  return events;
}

export function mergeHooks(settings, hooksDir, source = packageRoot) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Settings must be a JSON object');
  const result = structuredClone(settings);
  result.hooks ??= {};
  if (!result.hooks || typeof result.hooks !== 'object' || Array.isArray(result.hooks)) throw new Error('Settings hooks must be an object');
  for (const [event, entries] of Object.entries(registrations(hooksDir, source))) {
    const current = result.hooks[event] || [];
    if (!Array.isArray(current)) throw new Error(`Settings ${event} hooks must be an array`);
    result.hooks[event] = [...current.filter(entry => !ours(entry)), ...entries.map(entry => ({ ...entry, marker: hookMarker }))];
  }
  return result;
}

export function removeHooks(settings) {
  const result = structuredClone(settings);
  if (!result?.hooks || typeof result.hooks !== 'object' || Array.isArray(result.hooks)) return result;
  for (const [event, entries] of Object.entries(result.hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter(entry => !ours(entry));
    if (kept.length) result.hooks[event] = kept;
    else delete result.hooks[event];
  }
  if (!Object.keys(result.hooks).length) delete result.hooks;
  return result;
}

export function hooksRegistered(settings, hooksDir, source = packageRoot) {
  const expected = registrations(hooksDir, source);
  return Object.entries(expected).every(([event, entries]) => entries.every(entry =>
    (settings?.hooks?.[event] || []).some(actual => ours(actual) && actual.matcher === entry.matcher &&
      JSON.stringify(actual.hooks) === JSON.stringify(entry.hooks))));
}
