import { resolveAudience } from '@/lib/audience'

type Contact = { psid: string; subscribed: boolean; last_interaction_at: string | null; tags: string[] }
const contacts: Contact[] = [
  { psid: 'a', subscribed: true, last_interaction_at: '2026-06-07T11:00:00Z', tags: ['vip'] },
  { psid: 'b', subscribed: false, last_interaction_at: '2026-06-07T11:00:00Z', tags: [] },
  { psid: 'c', subscribed: true, last_interaction_at: '2026-06-01T00:00:00Z', tags: [] },
]
const now = new Date('2026-06-07T12:00:00Z')

it('excludes unsubscribed contacts', () => {
  const r = resolveAudience(contacts, { hasTag: false }, now)
  expect(r.map(c => c.psid)).not.toContain('b')
})
it('without a message tag, includes only in-window contacts', () => {
  const r = resolveAudience(contacts, { hasTag: false }, now)
  expect(r.map(c => c.psid)).toEqual(['a'])
})
it('with a message tag, includes out-of-window contacts too', () => {
  const r = resolveAudience(contacts, { hasTag: true }, now)
  expect(r.map(c => c.psid).sort()).toEqual(['a', 'c'])
})
it('filters by required tag when given', () => {
  const r = resolveAudience(contacts, { hasTag: true, requireTag: 'vip' }, now)
  expect(r.map(c => c.psid)).toEqual(['a'])
})
