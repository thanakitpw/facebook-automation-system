export const MAX_ATTEMPTS = 5
const BASE_MS = 60_000
const CAP_MS = 3_600_000

export function nextBackoffMs(attempt: number): number {
  return Math.min(BASE_MS * 2 ** (attempt - 1), CAP_MS)
}
