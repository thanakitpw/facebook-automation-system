import { handleEvents } from '@/lib/handlers'

function fakeDb() {
  const calls: any[] = []
  return {
    calls,
    upsertContact: async (c: any) => { calls.push(['upsertContact', c]) },
    findPageByFbId: async (fbPageId: string) => ({ id: 'page-uuid', fb_page_id: fbPageId, access_token_enc: 'enc' }),
    rulesForPost: async (fbPostId: string) => fbPostId === 'p1'
      ? [{ id: 'r1', keyword: 'test', match_type: 'contains', template_id: 't1', reply_once: true }] : [],
    templateById: async () => ({ id: 't1', type: 'text', text: 'thank you', media_url: null, buttons: null }),
    alreadyReplied: async () => false,
    enqueue: async (job: any) => { calls.push(['enqueue', job]) },
  }
}

it('enqueues an auto_reply job when a comment matches a rule', async () => {
  const db = fakeDb()
  await handleEvents([
    { type: 'comment', pageId: 'PAGE1', commentId: 'c1', postId: 'p1', fromId: 'u1', fromName: 'Joe', message: 'please TEST' },
  ], db as any)
  const enqueued = db.calls.filter(c => c[0] === 'enqueue')
  expect(enqueued).toHaveLength(1)
  expect(enqueued[0][1].job_type).toBe('auto_reply')
  expect(enqueued[0][1].payload.commentId).toBe('c1')
})

it('does not enqueue when no rule matches', async () => {
  const db = fakeDb()
  await handleEvents([
    { type: 'comment', pageId: 'PAGE1', commentId: 'c2', postId: 'p1', fromId: 'u1', message: 'hello' },
  ], db as any)
  expect(db.calls.filter(c => c[0] === 'enqueue')).toHaveLength(0)
})

it('upserts contact last_interaction_at on inbound message', async () => {
  const db = fakeDb()
  await handleEvents([
    { type: 'message', pageId: 'PAGE1', psid: 'psid-1', text: 'hi', timestamp: 1717761600000 },
  ], db as any)
  const up = db.calls.find(c => c[0] === 'upsertContact')
  expect(up[1].psid).toBe('psid-1')
})
