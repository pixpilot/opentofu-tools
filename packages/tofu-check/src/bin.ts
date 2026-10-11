#!/usr/bin/env node
import process from 'node:process';
import { main } from './cli';

const [, , ...args] = process.argv;

try {
  process.exitCode = main(args);
} catch (error) {
  process.stderr.write(
    `tofu-check: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
