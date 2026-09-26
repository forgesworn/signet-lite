import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SRC = fileURLToPath(new URL('.', import.meta.url))
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return walk(p)
    if (!/\.(ts|tsx)$/.test(p)) return []
    if (/\.(test|spec)\.(ts|tsx)$/.test(p)) return []
    return [p]
  })
}
describe('no console.* in production source', () => {
  it('has zero console calls', () => {
    const offenders = walk(SRC).filter(f => /\bconsole\.(log|warn|error|debug|info)\s*\(/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
