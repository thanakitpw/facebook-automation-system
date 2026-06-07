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
    catch (e) { await deps.markFailed((job as any).id, String(e)) }
  }
  return Response.json({ processed: jobs?.length ?? 0 })
}
