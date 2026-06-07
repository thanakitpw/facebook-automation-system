import { parseWebhook } from '@/lib/facebook/parse'

it('extracts inbound messages', () => {
  const body = { object: 'page', entry: [{ id: 'PAGE1', messaging: [
    { sender: { id: 'psid-1' }, recipient: { id: 'PAGE1' }, timestamp: 1717761600000, message: { text: 'hello' } },
  ] }] }
  expect(parseWebhook(body)).toEqual([
    { type: 'message', pageId: 'PAGE1', psid: 'psid-1', text: 'hello', timestamp: 1717761600000 },
  ])
})

it('extracts comment-add feed events', () => {
  const body = { object: 'page', entry: [{ id: 'PAGE1', changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'p1', from: { id: 'u1', name: 'Joe' }, message: 'test' } },
  ] }] }
  expect(parseWebhook(body)).toEqual([
    { type: 'comment', pageId: 'PAGE1', commentId: 'c1', postId: 'p1', fromId: 'u1', fromName: 'Joe', message: 'test' },
  ])
})

it('ignores non-comment feed events (likes, edits)', () => {
  const body = { object: 'page', entry: [{ id: 'PAGE1', changes: [
    { field: 'feed', value: { item: 'like', verb: 'add' } },
    { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'c1', post_id: 'p1', from: { id: 'u1' }, message: 'x' } },
  ] }] }
  expect(parseWebhook(body)).toEqual([])
})
