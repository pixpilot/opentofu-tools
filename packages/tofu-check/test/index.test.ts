import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main, MissingToolError, runChecks } from '../src';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

const spawn = vi.mocked(spawnSync);

function ok(stdout = ''): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout, stderr: '', status: 0, signal: null };
}

function missing(): SpawnSyncReturns<string> {
  return { ...ok(), status: null, error: new Error('spawnSync ENOENT') };
}

const validJson = JSON.stringify({ valid: true, diagnostics: [] });
const lintJson = JSON.stringify({ issues: [], errors: [] });

interface Overrides {
  tofu?: boolean;
  tflint?: boolean;
  validate?: string;
}

function respond(overrides: Overrides = {}): void {
  spawn.mockImplementation(((binary: string, args: string[]) => {
    if (binary === 'tofu' && overrides.tofu === false) return missing();
    if (binary === 'tflint' && overrides.tflint === false) return missing();
    if (args.includes('validate')) return ok(overrides.validate ?? validJson);
    if (args.includes('--format=json')) return ok(lintJson);
    return ok();
  }) as unknown as typeof spawnSync);
}

const calledArgs = (): string[][] => spawn.mock.calls.map((call) => call[1] as string[]);

describe('tofu-check', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tofu-check-'));
    fs.mkdirSync(path.join(dir, 'stack'));
    fs.writeFileSync(path.join(dir, 'stack', 'main.tf'), '');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.stubEnv('TOFU_BIN', undefined);
    vi.stubEnv('TFLINT_BIN', undefined);
    vi.stubEnv('TF_PLUGIN_CACHE_DIR', path.join(dir, '.providers'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    spawn.mockReset();
  });

  it('runs fmt, validate and lint by default', () => {
    respond();
    expect(main([dir])).toBe(0);
    const args = calledArgs();
    expect(args.some((a) => a.includes('fmt'))).toBe(true);
    expect(args.some((a) => a.includes('validate'))).toBe(true);
    expect(args.some((a) => a.includes('--format=json'))).toBe(true);
  });

  it('runs only tflint with --lint', () => {
    respond({ tofu: false });
    expect(main(['--lint', dir])).toBe(0);
    expect(spawn.mock.calls.every((call) => call[0] === 'tflint')).toBe(true);
  });

  it('runs only tofu validate with --validate', () => {
    respond({ tflint: false });
    expect(main(['--validate', dir])).toBe(0);
    expect(spawn.mock.calls.every((call) => call[0] === 'tofu')).toBe(true);
    expect(calledArgs().some((a) => a.includes('fmt'))).toBe(false);
  });

  it('throws when tofu is not installed', () => {
    respond({ tofu: false });
    expect(() => runChecks({ cwd: dir })).toThrow(MissingToolError);
    expect(() => runChecks({ cwd: dir })).toThrow(/OpenTofu is not installed/u);
  });

  it('throws when tflint is not installed', () => {
    respond({ tflint: false });
    expect(() => runChecks({ cwd: dir })).toThrow(/TFLint is not installed/u);
  });

  it('reports diagnostics and fails when validation is invalid', () => {
    respond({
      validate: JSON.stringify({
        valid: false,
        diagnostics: [
          {
            severity: 'error',
            summary: 'Bad',
            range: { filename: 'main.tf', start: { line: 2, column: 3 } },
          },
        ],
      }),
    });

    expect(runChecks({ cwd: dir, checks: ['validate'] })).toBe(false);
    expect(process.stdout.write).toHaveBeenCalledWith('stack/main.tf:2:3: error Bad: \n');
  });

  it('prints help without running tools', () => {
    expect(main(['--help'])).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });
});
