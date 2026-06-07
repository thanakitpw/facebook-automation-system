import { createHmac } from 'crypto'
import { verifySignature } from '@/lib/facebook/signature'

const SECRET = 'app-secret'
const body = JSON.stringify({ hello: 'world' })
const good = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')

it('accepts a valid signature', () => {
  expect(verifySignature(body, good, SECRET)).toBe(true)
})
it('rejects a tampered body', () => {
  expect(verifySignature(body + 'x', good, SECRET)).toBe(false)
})
it('rejects a missing header', () => {
  expect(verifySignature(body, null, SECRET)).toBe(false)
})
