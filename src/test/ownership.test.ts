import { isOwner } from '@/lib/ownership'
it('true only when ids match and present', () => {
  expect(isOwner('u1', 'u1')).toBe(true)
  expect(isOwner('u1', 'u2')).toBe(false)
  expect(isOwner(null, 'u1')).toBe(false)
  expect(isOwner(undefined, 'u1')).toBe(false)
})
