import 'dotenv/config';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { decryptField } from '../src/lib/crypto';
import { Trading212Client, Trading212Error, type T212HistoricalOrder } from '../src/lib/trading212';

const pageSchema = z.object({ items: z.array(z.unknown()), nextPagePath: z.string().nullish() });
const configSchema = z.object({
  t212Environment: z.literal('live'), t212IsaConnected: z.literal(1),
  t212IsaApiKey: z.string().min(1), t212IsaApiSecret: z.string().nullable(),
  t212IsaAccountId: z.string().min(1),
});

export function makeReadOnlyBrokerFetch(transport: typeof fetch, requestBudget = 19) {
  let requests = 0;
  const pages: Array<z.infer<typeof pageSchema>> = [];
  const guardedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.origin !== 'https://live.trading212.com' || url.username || url.password
      || !['/api/v0/equity/account/summary', '/api/v0/equity/history/orders'].includes(url.pathname)
      || method !== 'GET' || init?.body != null) throw new Error('READ_ONLY_ENDPOINT_REQUIRED');
    if (requests >= requestBudget) throw new Error('REQUEST_BUDGET_EXHAUSTED');
    requests++;
    const response = await transport(input, {
      ...init, method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (response.ok && url.pathname.endsWith('/history/orders')) {
      pages.push(pageSchema.parse(await response.clone().json()));
    }
    return response;
  };
  return { fetch: guardedFetch, pages, get requests() { return requests; } };
}

async function collect() {
  const sourcePath = process.argv[2];
  const destination = process.argv[3];
  if (!sourcePath || !destination) throw new Error('SOURCE_AND_IGNORED_OUTPUT_REQUIRED');
  const relativeOutput = path.relative(path.resolve('prisma/backups'), path.resolve(destination));
  if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
    throw new Error('OUTPUT_MUST_BE_UNDER_PRISMA_BACKUPS');
  }
  if (existsSync(destination)) throw new Error('OUTPUT_ALREADY_EXISTS');
  const database = new Database(sourcePath, { readonly: true, fileMustExist: true });
  let config: z.infer<typeof configSchema>;
  try {
    database.pragma('query_only = ON');
    config = configSchema.parse(database.prepare(`SELECT t212Environment,t212IsaConnected,
      t212IsaApiKey,t212IsaApiSecret,t212IsaAccountId FROM User WHERE id=?`).get('default-user'));
  } finally {
    database.close();
  }
  const client = new Trading212Client(decryptField(config.t212IsaApiKey),
    decryptField(config.t212IsaApiSecret ?? ''), config.t212Environment);
  const originalFetch = globalThis.fetch;
  const guard = makeReadOnlyBrokerFetch(originalFetch);
  let accountMatches = false;
  let orders: T212HistoricalOrder[] = [];
  let failure: { errorType: string; statusCode: number | null } | null = null;
  globalThis.fetch = guard.fetch;
  try {
    const summary = await client.getAccountSummary();
    accountMatches = String(summary.id) === config.t212IsaAccountId && summary.currency === 'GBP';
    if (!accountMatches) throw new Error('ACCOUNT_IDENTITY_MISMATCH');
    orders = await client.getOrderHistory(50, { maxPages: 16 });
  } catch (error) {
    failure = { errorType: error instanceof Error ? error.name : 'UnknownError',
      statusCode: error instanceof Trading212Error ? error.statusCode : null };
  } finally {
    globalThis.fetch = originalFetch;
  }
  const lastPage = guard.pages.at(-1);
  const historyComplete = accountMatches && failure == null && lastPage != null && !lastPage.nextPagePath;
  const evidence = {
    fetchedAt: new Date().toISOString(), kind: 'READ_ONLY_BROKER_RECONCILIATION',
    accountType: 'isa', environment: 'live', accountMatches,
    accountIdHash: createHash('sha256').update(config.t212IsaAccountId).digest('hex'),
    sourceOpenedReadOnly: true, requests: guard.requests, maxPages: 16,
    historyComplete, failure, orders, rawPages: guard.pages,
  };
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ accountMatches, historyComplete, requests: guard.requests,
    pages: guard.pages.length, orders: orders.length, failure, destination }));
}

if (process.argv.includes('--fetch-history')) {
  collect().catch(error => {
    console.error(JSON.stringify({ blocked: true,
      errorType: error instanceof Error ? error.name : 'UnknownError' }));
    process.exitCode = 1;
  });
}