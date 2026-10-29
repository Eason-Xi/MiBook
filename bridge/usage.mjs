export function normalize(result, now = Date.now()) {
  const bucket = result.rateLimitsByLimitId?.codex ?? result.rateLimits;
  if (!bucket || (bucket.limitId && bucket.limitId !== 'codex')) {
    throw new Error('Codex quota bucket unavailable');
  }
  const window = value => {
    if (!value || typeof value.usedPercent !== 'number' || !Number.isFinite(value.usedPercent)) return null;
    return {
      usedPercent: Math.max(0, Math.min(100, value.usedPercent)),
      windowDurationMins: Number.isFinite(value.windowDurationMins) ? value.windowDurationMins : null,
      resetsAt: Number.isFinite(value.resetsAt) ? value.resetsAt : null,
    };
  };
  return {
    schemaVersion: 1,
    updatedAt: now,
    plan: bucket.planType ?? null,
    ordinaryUsageAllowed: typeof result.ordinaryUsageAllowed === 'boolean' ? result.ordinaryUsageAllowed : null,
    primary: window(bucket.primary),
    secondary: window(bucket.secondary),
  };
}
