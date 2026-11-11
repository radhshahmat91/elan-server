// Route loader. Every file in this folder named *.routes.js is mounted automatically, so teams can
// add endpoints without editing a central list. Each file must export:
//   export const basePath = '/menu';     // mounted at /api/menu
//   export default router;                // an express.Router()
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export async function loadRouteModules() {
  const files = readdirSync(here).filter((f) => f.endsWith('.routes.js'));
  const modules = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(here, file)).href);
    if (typeof mod.basePath !== 'string' || !mod.basePath.startsWith('/')) {
      throw new Error(`${file} must export basePath (a string starting with "/").`);
    }
    if (typeof mod.default !== 'function') {
      throw new Error(`${file} must default-export an express.Router().`);
    }
    modules.push({ file, basePath: mod.basePath, router: mod.default });
  }
  // Longer (more specific) base paths first so '/admin/menu' is tried before '/admin'.
  modules.sort((a, b) => b.basePath.length - a.basePath.length || a.file.localeCompare(b.file));
  return modules;
}

export async function mountRoutes(app) {
  const modules = await loadRouteModules();
  for (const { basePath, router } of modules) app.use(`/api${basePath}`, router);
  return modules.map((m) => `/api${m.basePath}`);
}
