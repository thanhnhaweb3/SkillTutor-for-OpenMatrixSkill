export interface SkillRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export interface SkillRateLimiter {
  take(key: string): SkillRateLimitResult;
}

export class FixedWindowSkillRateLimiter implements SkillRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  private calls = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
      throw new Error("Invalid rate limiter configuration");
    }
  }

  take(key: string): SkillRateLimitResult {
    const currentTime = this.now();
    const current = this.windows.get(key);
    const window = !current || currentTime - current.startedAt >= this.windowMs
      ? { startedAt: currentTime, count: 0 }
      : current;
    window.count += 1;
    this.windows.set(key, window);
    this.calls += 1;
    if (this.calls % 1000 === 0) this.sweep(currentTime);
    const retryAfterSeconds = Math.max(1, Math.ceil((window.startedAt + this.windowMs - currentTime) / 1000));
    return {
      allowed: window.count <= this.limit,
      retryAfterSeconds,
      remaining: Math.max(0, this.limit - window.count)
    };
  }

  private sweep(currentTime: number) {
    for (const [key, window] of this.windows) {
      if (currentTime - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}

function configuredLimit() {
  const value = Number(process.env.DASHBOARD_SKILLS_RATE_LIMIT_PER_MINUTE ?? 20);
  return Number.isInteger(value) && value > 0 ? value : 20;
}

export const skillMutationRateLimiter: SkillRateLimiter = new FixedWindowSkillRateLimiter(configuredLimit(), 60_000);
