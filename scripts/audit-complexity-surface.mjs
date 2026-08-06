/**
 * DEPENDENCIES
 * Consumed by: simplification reviews, CI-ready complexity checks
 * Consumes: repository source files and the scheduler task manifest
 * Risk-sensitive: NO - read-only inventory; writes only with --write-baseline.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EXPECTED_TASKS } from './audit-scheduled-tasks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'docs', 'complexity-surface-baseline.json');
const WRITE_BASELINE = process.argv.includes('--write-baseline');
const JSON_ONLY = process.argv.includes('--json');

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).replaceAll('\\', '/');
}

function findFiles(directory, predicate) {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(entryPath, predicate);
    return predicate(entryPath) ? [toRepoPath(entryPath)] : [];
  });
}

function extractMatches(filePath, pattern, group = 1) {
  const contents = readFileSync(path.join(ROOT, filePath), 'utf8');
  return [...contents.matchAll(pattern)].map((match) => match[group]);
}

function buildInventory() {
  const appRoot = path.join(ROOT, 'src', 'app');
  const sourceRoot = path.join(ROOT, 'src');
  const schemaPath = 'prisma/schema.prisma';
  const flagsPath = 'src/lib/feature-flags.ts';
  const navigationPath = 'src/types/index.ts';

  const pages = findFiles(appRoot, (filePath) => filePath.endsWith(`${path.sep}page.tsx`)).sort();
  const apiRoutes = findFiles(path.join(appRoot, 'api'), (filePath) => filePath.endsWith(`${path.sep}route.ts`)).sort();
  const tests = findFiles(sourceRoot, (filePath) => /\.(?:test|spec)\.(?:ts|tsx)$/.test(filePath)).sort();
  const prismaModels = extractMatches(schemaPath, /^model\s+(\w+)\s*\{/gm).sort();
  const featureFlagBlock = existsSync(path.join(ROOT, flagsPath))
    ? readFileSync(path.join(ROOT, flagsPath), 'utf8').match(/export const FEATURE_FLAGS = \{([\s\S]*?)\n\} as const;/)?.[1] ?? ''
    : '';
  const featureFlags = [...featureFlagBlock.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*(true|false),/gm)]
    .map((match) => ({ name: match[1], enabled: match[2] === 'true' }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const navigationDestinations = [...new Set(extractMatches(navigationPath, /href:\s*['"]([^'"]+)['"]/g))].sort();
  const scheduledTasks = EXPECTED_TASKS.map((task) => ({
    name: task.name,
    target: task.requiredPath,
    registerScript: task.registerScript,
  })).sort((left, right) => left.name.localeCompare(right.name));

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      pages: pages.length,
      apiRoutes: apiRoutes.length,
      prismaModels: prismaModels.length,
      scheduledTasks: scheduledTasks.length,
      featureFlags: featureFlags.length,
      navigationDestinations: navigationDestinations.length,
      tests: tests.length,
    },
    surfaces: {
      pages,
      apiRoutes,
      prismaModels,
      scheduledTasks,
      featureFlags,
      navigationDestinations,
      tests,
    },
  };
}

function compareWithBaseline(current, baseline) {
  const findings = [];
  const additiveSurfaces = ['pages', 'apiRoutes', 'prismaModels', 'scheduledTasks', 'featureFlags', 'navigationDestinations'];

  for (const surface of additiveSurfaces) {
    const delta = current.counts[surface] - baseline.counts[surface];
    if (delta > 0) findings.push(`${surface} increased by ${delta}`);
  }

  const protectedSurfaces = ['scheduledTasks'];
  for (const surface of protectedSurfaces) {
    const currentNames = new Set(current.surfaces[surface].map((entry) => entry.name));
    for (const entry of baseline.surfaces[surface]) {
      if (!currentNames.has(entry.name)) findings.push(`${surface} removed protected entry: ${entry.name}`);
    }
  }

  return findings;
}

const inventory = buildInventory();

if (WRITE_BASELINE) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  console.log(`Wrote complexity baseline: ${toRepoPath(BASELINE_PATH)}`);
  console.log(JSON.stringify(inventory.counts, null, 2));
  process.exit(0);
}

if (JSON_ONLY) {
  console.log(JSON.stringify(inventory, null, 2));
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error('Complexity baseline is missing. Run: npm run complexity:baseline');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const findings = compareWithBaseline(inventory, baseline);

console.log('HybridTurtle complexity surface');
for (const [surface, count] of Object.entries(inventory.counts)) {
  const baselineCount = baseline.counts[surface];
  const delta = count - baselineCount;
  console.log(`  ${surface}: ${count} (${delta >= 0 ? '+' : ''}${delta})`);
}

if (findings.length > 0) {
  console.error('\nComplexity budget findings:');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

console.log('\nComplexity budget: PASS');