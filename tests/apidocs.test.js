// Keeps docs/api-documentation.md honest: every route must have a one-line description, and no description may
// point at a route that is gone. The generator reads route source text only, so no database is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every endpoint is described in scripts/api-descriptions.mjs', () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ['scripts/generate-api-docs.mjs', '--check'], { cwd: serverDir, stdio: 'pipe' }));
});
