import type { Check } from './check';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { ALL_CHECKS, runChecks } from './check';

const HELP = `Usage: tofu-check [options] [dir]

Runs OpenTofu fmt, validate and TFLint checks. Runs all checks when no check flag is given.

Options:
  --fmt                 Check formatting (tofu fmt -check)
  --validate            Validate configuration (tofu init + validate)
  --lint                Lint with TFLint
  -c, --config <file>   TFLint config (default: <dir>/.tflint.hcl if present)
  -i, --ignore <glob>   Extra glob to ignore (repeatable)
  -h, --help            Show help

Environment:
  TOFU_BIN              OpenTofu binary (default: tofu)
  TFLINT_BIN            TFLint binary (default: tflint)
`;

export function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      fmt: { type: 'boolean' },
      validate: { type: 'boolean' },
      lint: { type: 'boolean' },
      config: { type: 'string', short: 'c' },
      ignore: { type: 'string', short: 'i', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help === true) {
    process.stdout.write(HELP);
    return 0;
  }
  if (positionals.length > 1) throw new Error('Only one directory may be given.');

  const selected = ALL_CHECKS.filter((check: Check) => values[check] === true);

  return runChecks({
    cwd: positionals[0],
    checks: selected.length > 0 ? selected : ALL_CHECKS,
    tflintConfig: values.config,
    ignore: values.ignore,
  })
    ? 0
    : 1;
}
