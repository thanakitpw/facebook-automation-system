import { NextRequest } from 'next/server'
import { serviceClient } from '@/lib/supabase/server'
import { makeProcessDeps } from '@/lib/process-db'
import { processJob } from '@/lib/queue'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const sb = serviceClient()
  const { data: jobs } = await sb.rpc('claim_jobs', { batch: 25 })
  const deps = makeProcessDeps(new Date())
  for (const job of jobs ?? []) {
    try { await processJob(job as any, deps) }
    catch (e) {
      const j = job as any
      const attempt = (j.attempts ?? 0) + 1
      if (attempt < 5) {
        const delayMs = Math.min(60_000 * 2 ** (attempt - 1), 3_600_000)
        await deps.markRetry(j.id, new Date(Date.now() + delayMs), String(e))
      } else {
        await deps.markFailed(j.id, String(e))
      }
    }
  }
  return Response.json({ processed: jobs?.length ?? 0 })
}
