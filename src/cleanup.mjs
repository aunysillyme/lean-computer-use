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
