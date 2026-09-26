import { loadPrefs, savePrefs } from '../app/db.js'

export type Theme = 'system' | 'light' | 'dark'

/** Apply a theme by setting the data-theme attribute the token CSS keys off. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme
}

/** The effective light/dark a given preference resolves to, given the OS preference. */
export function resolveEffectiveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light'
  return theme
}

/** Read the saved theme preference, apply it, and return it. Defaults to 'system'. */
export async function loadAndApplyTheme(): Promise<Theme> {
  const { theme } = await loadPrefs()
  applyTheme(theme)
  return theme
}

/** Persist a theme preference (preserving relays) and apply it immediately. */
export async function setTheme(theme: Theme): Promise<void> {
  const prefs = await loadPrefs()
  await savePrefs({ ...prefs, theme })
  applyTheme(theme)
}
