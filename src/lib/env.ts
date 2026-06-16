import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NEXTAUTH_SECRET: z.string().min(1, 'NEXTAUTH_SECRET is required'),
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),
  NEXTAUTH_URL: z.string().url('NEXTAUTH_URL must be a valid URL').optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  // Optional but strongly recommended. crypto.ts falls back to NEXTAUTH_SECRET
  // if absent, but that means rotating NEXTAUTH_SECRET will silently brick
  // decryption of T212/Telegram credentials stored in the DB. Setting this
  // explicitly decouples auth-session secrets from at-rest credential keys.
  // See audit 2026-06-16 (HIGH-2) for the cascade.
  ENCRYPTION_SECRET: z.string().min(1).optional(),
});

function formatEnvIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const key = issue.path.join('.') || 'environment';
      return `${key}: ${issue.message}`;
    })
    .join('; ');
}

function validateEnv() {
  const isTest = process.env.NODE_ENV === 'test';
  const isProduction = process.env.NODE_ENV === 'production';
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

  if (isTest) {
    return;
  }

  // Enforce fail-fast secrets at runtime startup, not during static build collection.
  if (!isProduction || isBuildPhase) {
    return;
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const diagnostics = formatEnvIssues(result.error.issues);
    throw new Error(
      `[Startup Env Validation Failed] ${diagnostics}`
    );
  }

  // Soft warning: ENCRYPTION_SECRET is optional but recommended in production.
  // Without it, NEXTAUTH_SECRET doubles as the at-rest credential key, which
  // means rotating auth secrets will break broker decryption.
  if (!process.env.ENCRYPTION_SECRET) {
    console.warn(
      '[env] ENCRYPTION_SECRET is not set — NEXTAUTH_SECRET will be used for ' +
      'credential decryption. Rotating NEXTAUTH_SECRET will silently brick ' +
      'stored T212/Telegram credentials. See docs/SACRED_FILE_CHANGES.md.'
    );
  }
}

validateEnv();

