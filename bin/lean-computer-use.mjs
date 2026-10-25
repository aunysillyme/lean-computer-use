#!/usr/bin/env node
import { main } from '../src/cli.mjs';

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`lean-computer-use: ${error.message}`);
  process.exitCode = error.exitCode || 2;
}
