import { mkdirSync, cpSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiServerDir = join(__dirname, '..', 'api-server');
const destDir = join(__dirname, 'dist', 'api-server');

mkdirSync(destDir, { recursive: true });

const distSrc = join(apiServerDir, 'dist');
if (!existsSync(distSrc)) {
  console.error(`ERROR: API server dist not found at ${distSrc}`);
  process.exit(1);
}

// Copy only the esbuild output — NOT node_modules.
// esbuild fully bundles all dependencies into index.mjs and the pino worker
// files, so no node_modules are required at runtime. Copying node_modules
// would add hundreds of MB and can include platform-mismatched native binaries
// that crash the server on the user's machine.
cpSync(distSrc, destDir, { recursive: true });

console.log('API server dist copied to dist/api-server');
