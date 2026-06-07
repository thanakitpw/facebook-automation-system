import { encryptToken, decryptToken } from '@/lib/crypto'

const KEY = 'a'.repeat(64) // 32 bytes hex
beforeAll(() => { process.env.TOKEN_ENCRYPTION_KEY = KEY })

it('round-trips a token', () => {
  const enc = encryptToken('secret-page-token')
  expect(enc).not.toContain('secret-page-token')
  expect(decryptToken(enc)).toBe('secret-page-token')
})

it('produces different ciphertext each call (random IV)', () => {
  expect(encryptToken('x')).not.toBe(encryptToken('x'))
})
