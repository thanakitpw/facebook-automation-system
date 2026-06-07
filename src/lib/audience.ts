const DAY_MS = 24 * 60 * 60 * 1000

export interface ContactLike {
  psid: string
  subscribed: boolean
  last_interaction_at: string | null
  tags: string[]
}

export function resolveAudience<T extends ContactLike>(
  contacts: T[],
  opts: { hasTag: boolean; requireTag?: string },
  now: Date,
): T[] {
  return contacts.filter((c) => {
    if (!c.subscribed) return false
    if (opts.requireTag && !c.tags.includes(opts.requireTag)) return false
    if (opts.hasTag) return true
    if (!c.last_interaction_at) return false
    return now.getTime() - new Date(c.last_interaction_at).getTime() < DAY_MS
  })
}
