import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from './paths.mjs';

export const help = `lean-computer-use: native Mac app control

Usage:
  lean-computer-use [install] [--dir PATH] [--share DIR] [--with-hooks] [--dry-run] [--yes]
  lean-computer-use uninstall [--dir PATH] [--share DIR] [--dry-run]
  lean-computer-use doctor [--dir PATH] [--share DIR] [--json]
  lean-computer-use measure [--projects-dir DIR] [--since YYYY-MM-DD] [--tool-pattern REGEX] [--json]
  lean-computer-use cleanup [--apply] [--all] [--session ID] [--run NAME] [--json]
  lean-computer-use spawn [--session ID] [--run NAME] -- COMMAND [ARGS...]

Aliases: --uninstall = uninstall; --dry = --dry-run
Options: --help, --version
Cleanup is a dry run unless --apply is given: SIGTERM, a 3 second wait, then SIGKILL for the same leased process only.
Native app control needs macOS, Python 3 and cua-driver. The installer adds package files only.`;

/** @param {string[]} args @param {Record<string, any>} adapters */
export async function main(args = process.argv.slice(2), adapters = {}) {
  const write = adapters.write || console.log;
  if (args.length === 1 && args[0] === '--help') { write(help); return 0; }
  if (args.length === 1 && args[0] === '--version') { write(JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version); return 0; }
  let command = args[0] || 'install';
  let rest = args.slice(1);
  if (command === '--uninstall') command = 'uninstall';
  else if (command.startsWith('--')) { command = 'install'; rest = args; }
  if (command === 'install' || command === 'uninstall') {
    const module = await import('./install.mjs');
    return module[`${command}Command`](rest, { write, ...adapters.install });
  }
  if (command === 'cleanup' || command === 'spawn') return (await import('./cleanup.mjs')).reapCommand(command, rest, adapters.cleanup || {});
  if (command === 'doctor') return (await import('./doctor.mjs')).doctorCommand(rest, { write, ...adapters.doctor });
  if (command === 'measure') return (await import('./measure.mjs')).measureCommand(rest, { write, ...adapters.measure });
  throw Object.assign(new Error(`Unknown command: ${command}. Run lean-computer-use --help.`), { exitCode: 2 });
}
