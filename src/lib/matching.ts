export type MatchType = 'exact' | 'contains'
export interface RuleLike { id: string; keyword: string; match_type: MatchType }

export function matchRules<T extends RuleLike>(comment: string, rules: T[]): T[] {
  const text = comment.trim().toLowerCase()
  return rules.filter((r) => {
    const kw = r.keyword.trim().toLowerCase()
    return r.match_type === 'exact' ? text === kw : text.includes(kw)
  })
}
