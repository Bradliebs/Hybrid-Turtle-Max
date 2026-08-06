/**
 * DEPENDENCIES
 * Consumed by: simplification reviews, CI-ready policy checks
 * Consumes: feature flags, navigation configuration, decision ledger
 * Risk-sensitive: NO - read-only policy validation.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_DISPOSITIONS = new Set(['KEEP', 'CONSOLIDATE', 'QUARANTINE', 'RETIRE', 'UNKNOWN']);
const PRIMARY_NAVIGATION_COUNT = 5;

function readRepoFile(filePath) {
  return readFileSync(path.join(ROOT, filePath), 'utf8');
}

function getFeatureFlagIds() {
  if (!existsSync(path.join(ROOT, 'src/lib/feature-flags.ts'))) return [];
  const source = readRepoFile('src/lib/feature-flags.ts');
  const block = source.match(/export const FEATURE_FLAGS = \{([\s\S]*?)\n\} as const;/)?.[1];
  if (!block) throw new Error('Could not parse FEATURE_FLAGS');

  return [...block.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):\s*(?:true|false),/gm)]
    .map((match) => `flag:${match[1]}`)
    .sort();
}

function getSecondaryNavigationIds() {
  const source = readRepoFile('src/types/index.ts');
  const block = source.match(/export const MAIN_NAV_ITEMS: NavEntry\[\] = \[([\s\S]*?)\n\];/)?.[1];
  if (!block) throw new Error('Could not parse MAIN_NAV_ITEMS');

  return [...block.matchAll(/href:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .slice(PRIMARY_NAVIGATION_COUNT)
    .map((href) => `nav:${href}`)
    .sort();
}

function symmetricDifference(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: expected.filter((entry) => !actualSet.has(entry)),
    unexpected: actual.filter((entry) => !expectedSet.has(entry)),
  };
}

const ledger = JSON.parse(readRepoFile('docs/simplification-decision-ledger.json'));
const entries = ledger.entries ?? [];
const entryIds = entries.map((entry) => entry.id);
const uniqueIds = new Set(entryIds);
const liveEntryIds = entries.filter((entry) => entry.status !== 'RETIRED').map((entry) => entry.id);
const expectedIds = [...getFeatureFlagIds(), ...getSecondaryNavigationIds()].sort();
const differences = symmetricDifference(expectedIds, liveEntryIds.sort());
const invalidDispositions = entries
  .filter((entry) => !ALLOWED_DISPOSITIONS.has(entry.disposition))
  .map((entry) => entry.id);
const incompleteEntries = entries
  .filter((entry) => !entry.label || !entry.systemJob || !entry.confidence || !entry.risk || !entry.operatorEvidence || !Array.isArray(entry.evidence) || entry.evidence.length === 0 || !entry.nextGate)
  .map((entry) => entry.id);

const findings = [];
if (uniqueIds.size !== entryIds.length) findings.push('Ledger contains duplicate entry IDs.');
if (differences.missing.length > 0) findings.push(`Missing entries: ${differences.missing.join(', ')}`);
if (differences.unexpected.length > 0) findings.push(`Unexpected entries: ${differences.unexpected.join(', ')}`);
if (invalidDispositions.length > 0) findings.push(`Invalid dispositions: ${invalidDispositions.join(', ')}`);
if (incompleteEntries.length > 0) findings.push(`Incomplete entries: ${incompleteEntries.join(', ')}`);
if (ledger.scope?.totalEntries !== entries.length) findings.push('scope.totalEntries does not match the entry count.');
if (ledger.scope?.featureFlags !== getFeatureFlagIds().length) findings.push('scope.featureFlags does not match source.');
if (ledger.scope?.secondaryNavigationDestinations !== getSecondaryNavigationIds().length) findings.push('scope.secondaryNavigationDestinations does not match source.');

if (findings.length > 0) {
  console.error('Simplification ledger: FAIL');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}

const dispositions = entries.reduce((counts, entry) => {
  counts[entry.disposition] = (counts[entry.disposition] ?? 0) + 1;
  return counts;
}, {});

console.log(`Simplification ledger: PASS (${entries.length} entries)`);
for (const [disposition, count] of Object.entries(dispositions).sort()) {
  console.log(`  ${disposition}: ${count}`);
}