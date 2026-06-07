import { serviceClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/supabase/auth-server'

export const dynamic = 'force-dynamic'

export default async function LogsPage() {
  const { user } = await requireUser()
  const sb = serviceClient()
  const { data: pages } = await sb.from('pages').select('id').eq('owner_user_id', user.id)
  const ids = (pages ?? []).map((p) => p.id)
  const { data: logs } = ids.length
    ? await sb.from('message_logs').select('*').in('page_id', ids).order('created_at', { ascending: false }).limit(100)
    : { data: [] as Record<string, unknown>[] }
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">Delivery Logs</h1>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500"><th>Time</th><th>Type</th><th>Recipient</th><th>Status</th><th>Detail</th></tr></thead>
        <tbody>
          {(logs ?? []).map((l) => (
            <tr key={l.id} className="border-t">
              <td>{new Date(l.created_at).toLocaleString()}</td><td>{l.job_type}</td><td>{l.recipient_psid}</td>
              <td className={l.status === 'sent' ? 'text-green-600' : 'text-red-600'}>{l.status}</td>
              <td>{l.fb_message_id ?? l.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
