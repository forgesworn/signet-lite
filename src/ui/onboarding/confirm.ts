/** Pick `count` distinct indices in [0, total). `rand` defaults to Math.random (injectable for tests). */
export function pickConfirmIndices(total: number, count: number, rand: () => number = Math.random): number[] {
  const picks = new Set<number>()
  while (picks.size < count && picks.size < total) picks.add(Math.floor(rand() * total))
  return [...picks]
}

/** True iff every answer matches the word at its picked index (trimmed, lower-cased). */
export function checkConfirm(words: string[], picks: number[], answers: string[]): boolean {
  if (picks.length !== answers.length) return false
  return picks.every((p, i) => (answers[i] ?? '').trim().toLowerCase() === words[p])
}
