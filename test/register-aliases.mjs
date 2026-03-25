import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();

function resolveAliasPath(specifier) {
  const basePath = path.join(projectRoot, specifier.slice(2));
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.mjs'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return nextResolve(new URL('./server-only-stub.mjs', import.meta.url).href, context);
    }

    if (specifier.startsWith('@/')) {
      const resolvedPath = resolveAliasPath(specifier);

      if (!resolvedPath) {
        throw new Error(`Unable to resolve alias import: ${specifier}`);
      }

      return nextResolve(pathToFileURL(resolvedPath).href, context);
    }

    return nextResolve(specifier, context);
  },
});
