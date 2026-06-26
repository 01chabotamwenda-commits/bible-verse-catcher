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
cpSync(distSrc, destDir, { recursive: true });

const nmSrc = join(apiServerDir, 'node_modules');
if (!existsSync(nmSrc)) {
  console.error(`ERROR: API server node_modules not found at ${nmSrc}`);
  process.exit(1);
}
cpSync(nmSrc, join(destDir, 'node_modules'), { recursive: true });

console.log('API server copied to dist/api-server');
