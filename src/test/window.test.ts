import { canSend } from '@/lib/window'

const now = new Date('2026-06-07T12:00:00Z')

it('allows RESPONSE within 24h', () => {
  const last = new Date('2026-06-07T00:00:00Z')
  expect(canSend({ lastInteractionAt: last, tag: null, now })).toEqual({ ok: true, messagingType: 'RESPONSE' })
})
it('blocks RESPONSE outside 24h without a tag', () => {
  const last = new Date('2026-06-05T00:00:00Z')
  expect(canSend({ lastInteractionAt: last, tag: null, now })).toEqual({ ok: false, reason: 'outside_window_no_tag' })
})
it('allows MESSAGE_TAG outside 24h when a tag is provided', () => {
  const last = new Date('2026-06-05T00:00:00Z')
  expect(canSend({ lastInteractionAt: last, tag: 'CONFIRMED_EVENT_UPDATE', now }))
    .toEqual({ ok: true, messagingType: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' })
})
it('blocks when there is no prior interaction and no tag', () => {
  expect(canSend({ lastInteractionAt: null, tag: null, now })).toEqual({ ok: false, reason: 'outside_window_no_tag' })
})
