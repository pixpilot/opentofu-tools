import { defineConfig } from '@internal/tsdown-config';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  dts: true,
  minify: false,
  clean: true,
  platform: 'node',
});
