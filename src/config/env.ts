export type Env = Record<string, string | undefined>;

/** Reads a non-negative integer env var; records a message in `errors` when invalid. */
export function readInteger(
  env: Env,
  errors: string[],
  name: string,
  fallback: string,
  min: number,
  max: number,
): number {
  const raw = (env[name] ?? fallback).trim();
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < min || n > max) {
    errors.push(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
  }
  return n;
}

/** Reads a boolean env var (true/false, case-insensitive). */
export function readBoolean(env: Env, errors: string[], name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  errors.push(`${name} must be "true" or "false" (got "${env[name]}")`);
  return fallback;
}
