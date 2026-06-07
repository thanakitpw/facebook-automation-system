import { processJob } from '@/lib/queue'

function deps(over: Partial<any> = {}) {
  const calls: any[] = []
  return {
    calls,
    deps: {
      loadContext: async () => ({ pageToken: 'tok', lastInteractionAt: new Date('2026-06-07T11:00:00Z') }),
      loadTemplate: async () => ({ type: 'text', text: 'thanks', media_url: null, buttons: null }),
      send: async (a: any) => { calls.push(['send', a]); return { ok: true, messageId: 'mid.1' } },
      privateReply: async (a: any) => { calls.push(['privateReply', a]); return { ok: true, recipientPsid: 'psid-x' } },
      markSent: async (id: string, mid: string) => { calls.push(['markSent', id, mid]) },
      markRetry: async (id: string, when: Date, err: string) => { calls.push(['markRetry', id, when, err]) },
      markFailed: async (id: string, err: string) => { calls.push(['markFailed', id, err]) },
      now: new Date('2026-06-07T12:00:00Z'),
      graphVersion: 'v21.0',
      ...over,
    },
  }
}

it('auto_reply job uses private reply then marks sent', async () => {
  const { calls, deps: d } = deps()
  await processJob(
    { id: 'j1', job_type: 'auto_reply', recipient_psid: 'u1', attempts: 0,
      payload: { commentId: 'c1', templateId: 't1', ruleId: 'r1' } } as any, d as any)
  expect(calls.find(c => c[0] === 'privateReply')).toBeTruthy()
  expect(calls.find(c => c[0] === 'markSent')?.[2]).toBe('private_reply')
})

it('broadcast job blocked outside window without tag → markFailed', async () => {
  const { calls, deps: d } = deps({
    loadContext: async () => ({ pageToken: 'tok', lastInteractionAt: new Date('2026-06-01T00:00:00Z') }),
  })
  await processJob(
    { id: 'j2', job_type: 'broadcast', recipient_psid: 'u2', attempts: 0,
      payload: { templateId: 't1', tag: null } } as any, d as any)
  const failed = calls.find(c => c[0] === 'markFailed')
  expect(failed?.[2]).toContain('outside_window')
  expect(calls.find(c => c[0] === 'send')).toBeUndefined()
})

it('send failure under max attempts schedules a retry', async () => {
  const { calls, deps: d } = deps({
    send: async () => ({ ok: false, error: 'temporary' }),
  })
  await processJob(
    { id: 'j3', job_type: 'broadcast', recipient_psid: 'u3', attempts: 1,
      payload: { templateId: 't1', tag: null } } as any, d as any)
  expect(calls.find(c => c[0] === 'markRetry')).toBeTruthy()
})
