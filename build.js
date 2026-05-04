import * as esbuild from 'esbuild';
import { resolve } from 'path';

async function build() {
  // Build Node.js backend files
  await esbuild.build({
    entryPoints: [
      'src/websocket-server.ts',
      'src/server.ts',
      'src/config.ts',
      'src/tokens.ts'
    ],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    outdir: 'dist',
    external: ['@modelcontextprotocol/sdk', 'ws', 'dotenv', 'env-paths'],
  });

  // Build browser widget file (webmcp.js)
  await esbuild.build({
    entryPoints: ['src/webmcp.ts'],
    bundle: true,
    platform: 'browser',
    target: 'es2020',
    format: 'iife',
    globalName: 'WebMCP',
    outfile: 'dist/webmcp.js',
  });

  console.log('Build completed successfully.');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
