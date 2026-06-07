import { matchRules } from '@/lib/matching'

type Rule = { id: string; keyword: string; match_type: 'exact' | 'contains' }
const rules: Rule[] = [
  { id: 'r1', keyword: 'test', match_type: 'contains' },
  { id: 'r2', keyword: 'รับ', match_type: 'exact' },
]

it('matches contains case-insensitively', () => {
  expect(matchRules('I want to TEST this', rules).map(r => r.id)).toEqual(['r1'])
})
it('matches exact only when whole text equals keyword (trimmed)', () => {
  expect(matchRules('  รับ ', rules).map(r => r.id)).toEqual(['r2'])
  expect(matchRules('รับของหน่อย', rules).map(r => r.id)).toEqual([])
})
it('returns empty when nothing matches', () => {
  expect(matchRules('hello', rules)).toEqual([])
})
