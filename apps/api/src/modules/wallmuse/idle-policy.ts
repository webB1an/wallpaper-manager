export interface IdleWindow { start: string; end: string }
export interface IdleDecision { allowed: boolean; nextEligibleAt: string | null; timezone: "Asia/Shanghai"; windows: IdleWindow[]; reason: string }
function minute(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

// WallMuse always obeys the configured clock windows, including when old manual-upload bypasses are enabled.
export function idleDecision(windows: IdleWindow[], now = new Date()): IdleDecision {
  const valid = windows.filter((item) => item && minute(item.start) !== null && minute(item.end) !== null && item.start !== item.end);
  const base = { timezone: "Asia/Shanghai" as const, windows: valid };
  if (!valid.length) return { ...base, allowed: false, nextEligibleAt: null, reason: "未配置有效空闲时段，请在 wallpaper-manager 中配置" };
  const shanghai = new Date(now.getTime() + 8 * 3600_000);
  const current = shanghai.getUTCHours() * 60 + shanghai.getUTCMinutes();
  const active = valid.some(({ start, end }) => { const s = minute(start)!; const e = minute(end)!; return s < e ? current >= s && current < e : current >= s || current < e; });
  if (active) return { ...base, allowed: true, nextEligibleAt: null, reason: "当前为空闲时段" };
  const delay = Math.min(...valid.map(({ start }) => (minute(start)! - current + 1440) % 1440));
  const next = new Date(now.getTime() + delay * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
  return { ...base, allowed: false, nextEligibleAt: next.toISOString(), reason: "等待空闲时段" };
}

export class WaitForIdleError extends Error {
  constructor(public decision: IdleDecision) { super(decision.reason); }
}
