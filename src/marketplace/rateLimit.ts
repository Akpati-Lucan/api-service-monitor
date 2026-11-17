const buckets = new Map<string, { count: number; resetAt: number }>();

export function resetRateLimits(): void {
  buckets.clear();
}

export function consumeRateLimit(key: string, limit: number, now = Date.now()): boolean {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
