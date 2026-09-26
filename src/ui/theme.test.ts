// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { applyTheme, resolveEffectiveTheme, loadAndApplyTheme, setTheme } from './theme.js'
import { loadPrefs, __resetDbForTests } from '../app/db.js'
import { deleteDB } from 'idb'

describe('theme', () => {
  beforeEach(async () => { await __resetDbForTests(); await deleteDB('signet-lite'); document.documentElement.removeAttribute('data-theme') })

  it('applyTheme sets the data-theme attribute on the root', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('resolveEffectiveTheme follows the OS only for system', () => {
    expect(resolveEffectiveTheme('system', true)).toBe('dark')
    expect(resolveEffectiveTheme('system', false)).toBe('light')
    expect(resolveEffectiveTheme('dark', false)).toBe('dark')
    expect(resolveEffectiveTheme('light', true)).toBe('light')
  })

  it('loadAndApplyTheme defaults to system and applies it', async () => {
    const t = await loadAndApplyTheme()
    expect(t).toBe('system')
    expect(document.documentElement.dataset.theme).toBe('system')
  })

  it('setTheme persists and applies, preserving relays', async () => {
    await setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect((await loadPrefs()).theme).toBe('dark')
    expect((await loadPrefs()).relays.length).toBeGreaterThan(0) // defaults preserved
  })
})
