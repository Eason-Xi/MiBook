import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Claude Code's documented statusLine payload. Never persist the full payload:
// it can contain workspace paths, session IDs and transcript locations.
export function normalizeClaude(input, now = Date.now()) {
  const window = (value, minutes) => {
    if (!value || typeof value.used_percentage !== 'number'
      || !Number.isFinite(value.used_percentage) || value.used_percentage < 0 || value.used_percentage > 100) return null;
    return { usedPercent: value.used_percentage, windowDurationMins: minutes,
      resetsAt: Number.isFinite(value.resets_at) && value.resets_at > 0 ? value.resets_at : null };
  };
  const primary = window(input.rate_limits?.five_hour, 300);
  const secondary = window(input.rate_limits?.seven_day, 10080);
  if (!primary && !secondary) return null;
  return { updatedAt: now, primary, secondary };
}

export async function saveClaude(input, stateDir) {
  const value = normalizeClaude(input);
  if (!value) return null; // A missing window is unknown, not 0% used.
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const temp = stateDir + '/claude-usage.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, stateDir + '/claude-usage.json');
  return value;
}

export async function readClaude(stateDir) {
  try {
    const value = JSON.parse(await readFile(stateDir + '/claude-usage.json', 'utf8'));
    if (!Number.isFinite(value.updatedAt) || value.updatedAt <= 0) return null;
    const normalized = normalizeClaude({ rate_limits: {
      five_hour: value.primary && { used_percentage: value.primary.usedPercent, resets_at: value.primary.resetsAt },
      seven_day: value.secondary && { used_percentage: value.secondary.usedPercent, resets_at: value.secondary.resetsAt },
    } }, value.updatedAt);
    return normalized;
  } catch { return null; }
}
