import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { globSync } from 'glob';

export type Check = 'fmt' | 'validate' | 'lint';

export const ALL_CHECKS: readonly Check[] = ['fmt', 'validate', 'lint'];

export interface CheckOptions {
  /** Directory scanned for `.tf` files. Defaults to `process.cwd()`. */
  cwd?: string | undefined;
  /** Checks to run. Defaults to all checks. */
  checks?: readonly Check[] | undefined;
  /** TFLint config file. Defaults to `<cwd>/.tflint.hcl` when present. */
  tflintConfig?: string | undefined;
  /** Extra glob patterns excluded from the scan. */
  ignore?: readonly string[] | undefined;
  /** OpenTofu binary. Defaults to `$TOFU_BIN` or `tofu`. */
  tofuBin?: string | undefined;
  /** TFLint binary. Defaults to `$TFLINT_BIN` or `tflint`. */
  tflintBin?: string | undefined;
}

export class MissingToolError extends Error {
  override name = 'MissingToolError';
}

interface Range {
  filename: string;
  start: { line: number; column: number };
}

interface Diagnostic {
  range?: Range | undefined;
  severity: string;
  summary: string;
  detail?: string;
}

interface ValidateReport {
  valid: boolean;
  diagnostics: Diagnostic[];
}

interface TflintReport {
  issues: Array<{
    message: string;
    range?: Range;
    rule: { name: string; severity: string };
  }>;
  errors: unknown[];
}

// Only `.tf` files are scanned, so file-only patterns (lockfiles, LICENSE, ...) are unnecessary.
const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/.terraform/**',
  '**/.git/**',
  '**/dist/**',

  '**/output/**',
  '**/coverage/**',
  '**/temp/**',
  '**/.temp/**',
  '**/tmp/**',
  '**/.tmp/**',
  '**/.history/**',
  '**/.vitepress/cache/**',
  '**/.nuxt/**',
  '**/.next/**',
  '**/.svelte-kit/**',
  '**/.vercel/**',
  '**/.changeset/**',
  '**/.idea/**',
  '**/.cache/**',
  '**/.output/**',
  '**/.vite-inspect/**',
  '**/.yarn/**',
  '**/__snapshots__/**',

  // AI related
  '**/.context/**',
  '**/.claude/**',
  '**/.agents/**',
  '**/.*/skills/**',
];
const MAX_OUTPUT_BYTES = 10_485_760;

function ensureInstalled(
  binary: string,
  args: string[],
  name: string,
  envVar: string,
): void {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) {
    throw new MissingToolError(
      `${name} is not installed or not on PATH (tried "${binary}"). Install it or set ${envVar}.`,
    );
  }
  if (result.status !== 0) {
    throw new MissingToolError(
      `${name} ("${binary}") failed to report its version:\n${result.stderr}`,
    );
  }
}

function resolveTflintConfig(root: string, config?: string): string | undefined {
  if (config != null) {
    const resolved = path.resolve(root, config);
    if (!fs.existsSync(resolved)) throw new Error(`TFLint config not found: ${resolved}`);
    return resolved;
  }
  const fallback = path.join(root, '.tflint.hcl');
  return fs.existsSync(fallback) ? fallback : undefined;
}

/**
 * Runs `tofu fmt`, `tofu validate` and `tflint` across every OpenTofu directory.
 * @returns `true` when every selected check passed.
 * @throws {MissingToolError} When a binary required by the selected checks is unavailable.
 */
export function runChecks(options: CheckOptions = {}): boolean {
  const root = path.resolve(options.cwd ?? process.cwd());
  const checks = new Set(options.checks ?? ALL_CHECKS);
  const tofu = options.tofuBin ?? process.env['TOFU_BIN'] ?? 'tofu';
  const tflint = options.tflintBin ?? process.env['TFLINT_BIN'] ?? 'tflint';

  if (checks.has('fmt') || checks.has('validate'))
    ensureInstalled(tofu, ['version'], 'OpenTofu', 'TOFU_BIN');
  if (checks.has('lint')) ensureInstalled(tflint, ['--version'], 'TFLint', 'TFLINT_BIN');

  const tflintConfig = checks.has('lint')
    ? resolveTflintConfig(root, options.tflintConfig)
    : undefined;

  const files = globSync('**/*.tf', {
    cwd: root,
    dot: true,
    ignore: [...DEFAULT_IGNORE, ...(options.ignore ?? [])],
  })
    .map((file) => file.replaceAll('\\', '/'))
    .sort();
  const directories = [...new Set(files.map((file) => path.posix.dirname(file)))];

  if (files.length === 0) {
    process.stdout.write(`No OpenTofu files found in ${root}.\n`);
    return true;
  }

  const providerCache =
    process.env['TF_PLUGIN_CACHE_DIR'] ?? path.join(root, '.cache', 'tofu', 'providers');
  fs.mkdirSync(providerCache, { recursive: true });
  const env = {
    ...process.env,
    TF_IN_AUTOMATION: '1',
    TF_PLUGIN_CACHE_DIR: providerCache,
  };

  let passed = true;
  const run = (binary: string, args: string[], cwd: string): SpawnSyncReturns<string> => {
    const result = spawnSync(binary, args, {
      cwd,
      env,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    if (result.error || result.status !== 0) {
      process.stderr.write(result.error ? `${result.error.message}\n` : result.stderr);
      passed = false;
    }
    return result;
  };

  process.stdout.write(
    `Checking ${files.length} OpenTofu files in ${directories.length} directories.\n`,
  );

  if (checks.has('fmt')) {
    const format = run(tofu, ['fmt', '-check', '-list=true', ...files], root);
    for (const file of format.stdout.split(/\r?\n/u).filter(Boolean))
      process.stdout.write(`${file}: not formatted (run tofu fmt)\n`);
  }

  if (!checks.has('validate') && !checks.has('lint')) return passed;

  for (const directory of directories) {
    process.stdout.write(`Checking ${directory}\n`);
    const target = path.join(root, directory);
    const diagnostics: Diagnostic[] = [];

    if (checks.has('validate')) {
      const init = run(
        tofu,
        ['init', '-backend=false', '-input=false', '-no-color'],
        target,
      );
      if (init.status === 0) {
        const result = run(tofu, ['validate', '-json', '-lint=all'], target);
        try {
          const report = JSON.parse(result.stdout) as ValidateReport;
          diagnostics.push(...report.diagnostics);
          if (!report.valid) passed = false;
        } catch {
          process.stderr.write(result.stdout || 'No validation report returned.\n');
          passed = false;
        }
      } else {
        process.stderr.write(init.stdout);
      }
    }

    if (checks.has('lint')) {
      const args = ['--format=json'];
      if (tflintConfig != null) args.unshift(`--config=${tflintConfig}`);
      const lint = run(tflint, args, target);
      try {
        const report = JSON.parse(lint.stdout) as TflintReport;
        diagnostics.push(
          ...report.issues.map((issue) => ({
            range: issue.range,
            severity: issue.rule.severity,
            summary: issue.message,
            detail: issue.rule.name,
          })),
        );
        if (report.errors.length > 0)
          process.stderr.write(`${JSON.stringify(report.errors)}\n`);
      } catch {
        process.stderr.write(lint.stdout || 'No lint report returned.\n');
        passed = false;
      }
    }

    for (const diagnostic of diagnostics) {
      const location = diagnostic.range;
      const filename = location
        ? path
            .relative(root, path.resolve(target, location.filename))
            .replaceAll('\\', '/')
        : directory;
      const line = location?.start.line ?? 1;
      const column = location?.start.column ?? 1;
      const detail = `${diagnostic.summary}: ${diagnostic.detail ?? ''}`.replace(
        /\s+/gu,
        ' ',
      );
      process.stdout.write(
        `${filename}:${line}:${column}: ${diagnostic.severity} ${detail}\n`,
      );
    }
  }

  return passed;
}
