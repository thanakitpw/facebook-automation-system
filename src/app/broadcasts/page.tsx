import { startBroadcast } from './actions'

export default function BroadcastsPage() {
  async function action(form: FormData) {
    'use server'
    await startBroadcast({
      pageId: form.get('pageId') as string,
      templateId: form.get('templateId') as string,
      tag: (form.get('tag') as string) || null,
      requireTag: (form.get('requireTag') as string) || undefined,
    })
  }
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">New Broadcast</h1>
      <form action={action} className="max-w-md space-y-3">
        <input name="pageId" placeholder="page row id" className="w-full rounded border p-2" required />
        <input name="templateId" placeholder="template id" className="w-full rounded border p-2" required />
        <input name="tag" placeholder="message tag (optional, blank = 24h-window only)" className="w-full rounded border p-2" />
        <input name="requireTag" placeholder="only contacts with this tag (optional)" className="w-full rounded border p-2" />
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">Queue broadcast</button>
      </form>
      <p className="mt-3 text-sm text-gray-500">Contacts outside the 24h window are skipped unless a message tag is provided.</p>
    </main>
  )
}
