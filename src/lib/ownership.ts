import { serviceClient } from './supabase/server'

// Pure check used by tests and callers.
export function isOwner(pageOwnerId: string | null | undefined, userId: string): boolean {
  return !!pageOwnerId && pageOwnerId === userId
}

// Throws unless `userId` owns `pageId`. Uses service client to read ownership.
export async function assertPageOwner(pageId: string, userId: string): Promise<void> {
  const sb = serviceClient()
  const { data } = await sb.from('pages').select('owner_user_id').eq('id', pageId).maybeSingle()
  if (!isOwner(data?.owner_user_id, userId)) throw new Error('FORBIDDEN')
}
