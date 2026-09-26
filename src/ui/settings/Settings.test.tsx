// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Settings } from './Settings'

afterEach(cleanup)

const noop = () => {}
function renderSettings(over: Partial<Parameters<typeof Settings>[0]> = {}) {
  return render(<Settings theme="system" onSetTheme={noop} explain={true} onToggleExplain={noop} onBackup={noop} onMoveToMySignet={noop} onConnectedApps={noop} onActivity={noop} onRelays={noop} onLock={noop} onDeleteSignet={noop} onBack={noop} {...over} />)
}

describe('Settings', () => {
  it('changes theme and navigates', async () => {
    const onSetTheme = vi.fn(), onBackup = vi.fn(), onMoveToMySignet = vi.fn(), onLock = vi.fn()
    renderSettings({ onSetTheme, onBackup, onMoveToMySignet, onLock })
    await userEvent.click(screen.getByRole('button', { name: /^dark$/i }))
    expect(onSetTheme).toHaveBeenCalledWith('dark')
    await userEvent.click(screen.getByRole('button', { name: /backup phrase/i }))
    expect(onBackup).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /move to my signet/i }))
    expect(onMoveToMySignet).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /lock now/i }))
    expect(onLock).toHaveBeenCalled()
  })

  it('toggles helpful explanations off', async () => {
    const onToggleExplain = vi.fn()
    renderSettings({ explain: true, onToggleExplain })
    await userEvent.click(screen.getByRole('switch', { name: /show helpful explanations/i }))
    expect(onToggleExplain).toHaveBeenCalledWith(false)
  })

  it('opens the delete-signet flow from the danger zone', async () => {
    const onDeleteSignet = vi.fn()
    renderSettings({ onDeleteSignet })
    await userEvent.click(screen.getByRole('button', { name: /delete signet/i }))
    expect(onDeleteSignet).toHaveBeenCalled()
  })

  it('shows the secure quick unlock upgrade when available', async () => {
    const onUpgradeQuickUnlock = vi.fn()
    renderSettings({ canUpgradeQuickUnlock: true, onUpgradeQuickUnlock })
    await userEvent.click(screen.getByRole('button', { name: /secure quick unlock/i }))
    expect(onUpgradeQuickUnlock).toHaveBeenCalled()
  })
})
