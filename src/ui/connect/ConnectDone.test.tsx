// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectDone } from './ConnectDone'

afterEach(cleanup)

describe('ConnectDone', () => {
  it('shows the connected app name', () => {
    render(<ConnectDone appName="noStrudel" onManageApps={() => {}} onDone={() => {}} />)
    expect(screen.getByText(/connected to noStrudel/i)).toBeInTheDocument()
  })

  it('falls back to a generic Connected when no app name is given', () => {
    render(<ConnectDone onManageApps={() => {}} onDone={() => {}} />)
    expect(screen.getByText(/^connected$/i)).toBeInTheDocument()
  })

  it('calls onManageApps and onDone from their buttons', async () => {
    const onManageApps = vi.fn()
    const onDone = vi.fn()
    render(<ConnectDone appName="noStrudel" onManageApps={onManageApps} onDone={onDone} />)
    await userEvent.click(screen.getByRole('button', { name: /manage connected apps/i }))
    await userEvent.click(screen.getByRole('button', { name: /^done$/i }))
    expect(onManageApps).toHaveBeenCalledOnce()
    expect(onDone).toHaveBeenCalledOnce()
  })
})
