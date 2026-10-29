import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { packageRoot } from './paths.mjs';

/**
 * `cleanup` and `spawn` run the same Python tool the runner calls, so one implementation
 * decides what is provably ours.
 * @param {'cleanup' | 'spawn'} command
 * @param {string[]} args
 * @param {Record<string, any>} adapters
 */
export function reapCommand(command, args = [], adapters = {}) {
  const source = adapters.source || packageRoot;
  const run = adapters.run || ((program, programArgs) => spawnSync(program, programArgs, { stdio: 'inherit', env: adapters.env || process.env }));
  const result = run('python3', [join(source, 'desk/desk-reap'), command, ...args]);
  if (result.error) throw Object.assign(new Error('python3 is required for cleanup and spawn.'), { exitCode: 2 });
  return typeof result.status === 'number' ? result.status : 1;
}

/**
 * `keep` holds the session's recorded desktop control through the stop gate's own state module.
 * @param {string[]} args
 * @param {Record<string, any>} adapters
 */
export function keepCommand(args = [], adapters = {}) {
  const fail = message => Object.assign(new Error(message), { exitCode: 2 });
  const forwarded = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg !== '--reason' && arg !== '--session') throw fail(`Unknown option: ${arg}`);
    const value = args[++index];
    if (value === undefined || value.startsWith('--')) throw fail(`Missing value for ${arg}`);
    forwarded.push(arg, value);
  }
  if (!forwarded.includes('--reason')) throw fail('keep requires --reason TEXT.');
  const source = adapters.source || packageRoot;
  const run = adapters.run || ((program, programArgs) => spawnSync(program, programArgs, { stdio: 'inherit', env: adapters.env || process.env }));
  const result = run('python3', [join(source, 'hooks/_surfaces.py'), 'keep', ...forwarded]);
  if (result.error) throw fail('python3 is required for keep.');
  return typeof result.status === 'number' ? result.status : 1;
}
