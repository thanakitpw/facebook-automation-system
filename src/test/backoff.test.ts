import { nextBackoffMs, MAX_ATTEMPTS } from '@/lib/queue'

it('grows exponentially per attempt', () => {
  expect(nextBackoffMs(1)).toBe(60_000)
  expect(nextBackoffMs(2)).toBe(120_000)
  expect(nextBackoffMs(3)).toBe(240_000)
})
it('caps at 60 minutes', () => {
  expect(nextBackoffMs(20)).toBe(3_600_000)
})
it('exposes a max-attempts ceiling', () => {
  expect(MAX_ATTEMPTS).toBe(5)
})
