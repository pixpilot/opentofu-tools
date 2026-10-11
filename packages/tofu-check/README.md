# tofu-check

CLI that runs `tofu fmt -check`, `tofu validate` and `tflint` across every OpenTofu directory. Requires [OpenTofu](https://opentofu.org) and [TFLint](https://github.com/terraform-linters/tflint) on `PATH`; it exits with an error when a tool needed by the selected checks is missing.

```sh
tofu-check [dir]             # fmt + validate + lint (default)
tofu-check --validate        # only tofu init + validate
tofu-check --lint            # only tflint
tofu-check --fmt --lint      # combine flags
tofu-check -c .tflint.hcl -i "examples/**"
```

Set `TOFU_BIN` / `TFLINT_BIN` to use custom binaries.
