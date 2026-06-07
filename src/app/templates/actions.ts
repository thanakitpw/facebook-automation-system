'use server'
import { serviceClient } from '@/lib/supabase/server'

export async function createTemplate(form: FormData) {
  const sb = serviceClient()
  const pageId = form.get('pageId') as string
  const type = form.get('type') as 'text' | 'image' | 'file' | 'buttons'
  const text = (form.get('text') as string) || null
  let mediaUrl: string | null = null

  const file = form.get('file') as File | null
  if (file && file.size > 0) {
    const path = `${pageId}/${file.name}`
    await sb.storage.from('media').upload(path, file, { upsert: true })
    mediaUrl = sb.storage.from('media').getPublicUrl(path).data.publicUrl
  }

  const buttonsRaw = form.get('buttons') as string | null
  await sb.from('message_templates').insert({
    page_id: pageId, type, text, media_url: mediaUrl,
    buttons: buttonsRaw ? JSON.parse(buttonsRaw) : null,
  })
}
