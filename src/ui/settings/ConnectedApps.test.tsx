// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectedApps } from './ConnectedApps'

afterEach(cleanup)

const trusted = { clientPubkey: 'pk1', displayName: 'noStrudel', identityName: 'magazine', policies: { sign: 'always', dm: 'always', profile: 'decline' } as const, kindPolicies: {} }
const asks = { clientPubkey: 'pk2', displayName: 'Primal', identityName: 'meme', policies: { sign: 'ask', dm: 'ask', profile: 'ask' } as const, kindPolicies: {} }

function noopProps() {
  return { explain: false, onRename: vi.fn(), onSetPolicy: vi.fn(), onResetKind: vi.fn(), onRevoke: vi.fn(), onCopyBunker: vi.fn(() => 'bunker://stub'), onViewActivity: vi.fn(), onBack: vi.fn() }
}

describe('ConnectedApps', () => {
  it('calls onAddConnection when Connect an app is clicked', async () => {
    const onAddConnection = vi.fn()
    render(<ConnectedApps apps={[]} onAddConnection={onAddConnection} {...noopProps()} />)
    await userEvent.click(screen.getByRole('button', { name: /connect an app/i }))
    expect(onAddConnection).toHaveBeenCalled()
  })

  it('reads out the trust state for each app', () => {
    render(<ConnectedApps apps={[trusted, asks]} onAddConnection={vi.fn()} {...noopProps()} />)
    expect(screen.getByText(/trusted\. {2}no prompts\./i, { normalizer: s => s })).toBeInTheDocument()
    expect(screen.getByText(/asks before actions\./i)).toBeInTheDocument()
  })

  it('shows the profile control and sets profile policy on click', async () => {
    const onSetPolicy = vi.fn()
    render(<ConnectedApps apps={[trusted]} onAddConnection={vi.fn()} {...noopProps()} onSetPolicy={onSetPolicy} />)
    expect(screen.getByText(/profile \(kind 0\) writes/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /profile.*allow/i }))
    expect(onSetPolicy).toHaveBeenCalledWith('magazine', 'pk1', 'profile', 'always')
  })

  it('clicking Rename reveals the input; saving calls onRename with identity, pubkey, and new label', async () => {
    const onRename = vi.fn()
    render(<ConnectedApps apps={[trusted]} onAddConnection={vi.fn()} {...noopProps()} onRename={onRename} />)
    await userEvent.click(screen.getByRole('button', { name: /rename nostrudel/i }))
    const input = screen.getByLabelText('App name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Highlighter')
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onRename).toHaveBeenCalledWith('magazine', 'pk1', 'Highlighter')
  })

  it('clicking Revoke calls onRevoke with identity and pubkey', async () => {
    const onRevoke = vi.fn()
    render(<ConnectedApps apps={[trusted]} onAddConnection={vi.fn()} {...noopProps()} onRevoke={onRevoke} />)
    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }))
    expect(onRevoke).toHaveBeenCalledWith('magazine', 'pk1')
  })

  it('lists per-kind exceptions and resets one on click', async () => {
    const onResetKind = vi.fn()
    const withKinds = { ...asks, kindPolicies: { '1': 'always', '7': 'always' } as Record<string, 'ask' | 'always'> }
    render(<ConnectedApps apps={[withKinds]} onAddConnection={vi.fn()} {...noopProps()} onResetKind={onResetKind} />)
    expect(screen.getByText(/per-kind exceptions/i)).toBeInTheDocument()
    expect(screen.getByText(/kind 1: always/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /reset kind 7 for primal/i }))
    expect(onResetKind).toHaveBeenCalledWith('meme', 'pk2', 7)
  })

  it('shows no per-kind section when there are no exceptions', () => {
    render(<ConnectedApps apps={[trusted]} onAddConnection={vi.fn()} {...noopProps()} />)
    expect(screen.queryByText(/per-kind exceptions/i)).not.toBeInTheDocument()
  })

  it('Copy bunker link builds the link via onCopyBunker, copies it, and flashes Copied!', async () => {
    const onCopyBunker = vi.fn(() => 'bunker://abc?relay=wss%3A%2F%2Fr&secret=s')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ConnectedApps apps={[trusted]} onAddConnection={vi.fn()} {...noopProps()} onCopyBunker={onCopyBunker} />)
    await userEvent.click(screen.getByRole('button', { name: /copy bunker link for nostrudel/i }))
    expect(onCopyBunker).toHaveBeenCalledWith('magazine', 'pk1')
    expect(writeText).toHaveBeenCalledWith('bunker://abc?relay=wss%3A%2F%2Fr&secret=s')
    expect(await screen.findByText('Copied!')).toBeInTheDocument()
  })

  it('surfaces a visible error when the clipboard write fails, instead of silently claiming success', async () => {
    const onCopyBunker = vi.fn(() => 'bunker://abc?relay=wss%3A%2F%2Fr&secret=s')
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ConnectedApps apps={[trusted]} onAddConnection={vi.fn()} {...noopProps()} onCopyBunker={onCopyBunker} />)
    await userEvent.click(screen.getByRole('button', { name: /copy bunker link for nostrudel/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not copy/i)
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument()
  })
})
