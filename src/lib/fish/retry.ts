export class RetryableError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? `Retryable HTTP ${status}`);
    this.name = "RetryableError";
  }
}

export class FatalFishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalFishError";
  }
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * 200);
}

export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: { attempts: number; baseMs?: number },
): Promise<T> {
  const base = options.baseMs ?? 500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof RetryableError) || attempt === options.attempts) {
        throw err;
      }
      const delay = jitter(base * 2 ** (attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
