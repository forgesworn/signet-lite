// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApproveSign } from './ApproveSign'

afterEach(cleanup)

const REQ = {
  identityName: 'magazine',
  clientPubkey: 'abcd1234',
  method: 'sign_event',
  eventPreview: 'gm nostr',
  eventDetails: { kind: 1, createdAt: 0, tags: [['p', 'pubkey']], content: 'gm nostr' },
}

describe('ApproveSign', () => {
  it('Approve passes always-allow when ticked; Deny passes false', async () => {
    const onDecide = vi.fn()
    const { rerender } = render(<ApproveSign explain={false} req={REQ} appName="Highlighter" onDecide={onDecide} />)
    expect(screen.getByText('gm nostr')).toBeInTheDocument()
    expect(screen.getByText('Kind:')).toBeInTheDocument()
    expect(screen.getAllByText('1')).toHaveLength(2)
    await userEvent.click(screen.getByLabelText(/always allow/i))
    await userEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(onDecide).toHaveBeenCalledWith(true, true)

    onDecide.mockClear()
    // The next request (App keys the prompt by the queue's request id) is a fresh instance.
    rerender(<ApproveSign key="next" explain={false} req={REQ} appName="Highlighter" onDecide={onDecide} />)
    await userEvent.click(screen.getByRole('button', { name: /deny/i }))
    expect(onDecide).toHaveBeenCalledWith(false, false)
  })

  it('resets alwaysAllow when the queue advances to a different request', async () => {
    const onDecide = vi.fn()
    const { rerender } = render(<ApproveSign explain={false} req={REQ} appName="Highlighter" onDecide={onDecide} />)
    await userEvent.click(screen.getByLabelText(/always allow/i))
    expect(screen.getByLabelText(/always allow/i)).toBeChecked()

    // Queue advances to a different, unrelated request — the stale tick must not carry over.
    const nextReq = {
      identityName: 'meme',
      clientPubkey: 'ffff9999',
      method: 'sign_event',
      eventPreview: 'different post',
      eventDetails: { kind: 1, createdAt: 1, tags: [], content: 'different post' },
    }
    rerender(<ApproveSign explain={false} req={nextReq} appName="Highlighter" onDecide={onDecide} />)
    expect(screen.getByLabelText(/always allow/i)).not.toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(onDecide).toHaveBeenCalledWith(true, false)
  })

  it('always-allow names the kind for a sign_event (granular grant)', () => {
    render(<ApproveSign explain={false} req={REQ} appName="Highlighter" onDecide={vi.fn()} />)
    expect(screen.getByLabelText(/always allow Highlighter to sign kind-1 events/i)).toBeInTheDocument()
  })

  it('always-allow stays category-wide for a DM request', () => {
    const dmReq = { identityName: 'magazine', clientPubkey: 'abcd1234', method: 'nip44_decrypt', peerPubkey: 'pk' }
    render(<ApproveSign explain={false} req={dmReq} appName="Highlighter" onDecide={vi.fn()} />)
    expect(screen.getByLabelText(/always allow Highlighter to read & write your messages/i)).toBeInTheDocument()
  })

  it('shows a rate-limit warning only when the request was throttled', () => {
    const { rerender } = render(<ApproveSign explain={false} req={REQ} appName="Highlighter" onDecide={vi.fn()} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rerender(<ApproveSign explain={false} req={REQ} appName="Highlighter" rateLimited onDecide={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/signed a lot just now/i)
  })

  it('shows the zap amount and recipient for a zap request', () => {
    const zapReq = {
      identityName: 'magazine',
      clientPubkey: 'abcd1234',
      method: 'sign_event',
      eventPreview: 'great post',
      eventDetails: {
        kind: 9734,
        createdAt: 0,
        tags: [['amount', '21000'], ['p', 'cafebabe00001111']],
        content: 'great post',
        zap: { amountMsat: 21000, amountSat: 21, recipientPubkey: 'cafebabe00001111' },
      },
    }
    render(<ApproveSign explain={false} req={zapReq} appName="Amethyst" onDecide={vi.fn()} />)
    expect(screen.getByText('Lightning zap')).toBeInTheDocument()
    expect(screen.getByText(/21 sats/)).toBeInTheDocument()
    expect(screen.getByLabelText(/always allow Amethyst to send zaps as you/i)).toBeInTheDocument()
  })

  // L6: the zap recipient is rendered from an app-supplied 'p' tag — bidi/zero-width characters
  // there could visually disguise who the zap goes to. The 'p' tag itself is left clean here (it
  // is already sanitised separately) so this isolates the zap-recipient display specifically.
  it('strips bidi and invisible characters from the zap recipient', () => {
    const RLO = '‮', ZW = '​'
    const zapReq = {
      identityName: 'magazine',
      clientPubkey: 'abcd1234',
      method: 'sign_event',
      eventDetails: {
        kind: 9734,
        createdAt: 0,
        tags: [['amount', '21000'], ['p', 'cafebabe00001111']],
        content: '',
        zap: { amountMsat: 21000, amountSat: 21, recipientPubkey: `cafe${RLO}babe${ZW}00001111` },
      },
    }
    const { container } = render(<ApproveSign explain={false} req={zapReq} appName="Amethyst" onDecide={vi.fn()} />)
    expect(container.textContent ?? '').not.toMatch(/[‮​]/)
  })

  it('shows every tag, not just the first three (nothing hides past tag 3)', () => {
    const manyTags = {
      identityName: 'magazine',
      clientPubkey: 'abcd1234',
      method: 'sign_event',
      eventPreview: 'deleting',
      eventDetails: {
        kind: 5,
        createdAt: 0,
        tags: [['e', 'one'], ['e', 'two'], ['e', 'three'], ['e', 'four-hidden'], ['e', 'five-hidden']],
        content: 'deleting',
      },
    }
    render(<ApproveSign explain={false} req={manyTags} appName="Highlighter" onDecide={vi.fn()} />)
    expect(screen.getByText(/four-hidden/)).toBeInTheDocument()
    expect(screen.getByText(/five-hidden/)).toBeInTheDocument()
  })

  // H5: the first tap decides; a second tap (or a tap on the other button) must not send a
  // second decision that could land on the next queued request.
  it('decides once: buttons disable after the first tap', async () => {
    const onDecide = vi.fn()
    render(<ApproveSign explain={false} req={REQ} appName="Highlighter" onDecide={onDecide} />)
    const approve = screen.getByRole('button', { name: /approve/i })
    await userEvent.click(approve)
    await userEvent.click(approve)
    await userEvent.click(screen.getByRole('button', { name: /deny/i }))
    expect(onDecide).toHaveBeenCalledTimes(1)
    expect(approve).toBeDisabled()
    expect(screen.getByRole('button', { name: /deny/i })).toBeDisabled()
  })

  // L2: bidi overrides / zero-width characters can visually disguise what is being signed.
  it('strips bidi and invisible characters from the preview, tags, message and app name', () => {
    const RLO = '\u202E', ZW = '\u200B'
    const req = {
      ...REQ,
      eventPreview: `pay ${RLO}evil${ZW}`,
      eventDetails: { ...REQ.eventDetails, tags: [['p', `ab${RLO}cd`]] },
      method: 'sign_event',
    }
    const { container } = render(<ApproveSign explain={false} req={req} appName={`Nice${RLO}App`} onDecide={vi.fn()} />)
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/[\u202E\u200B]/)
    expect(screen.getByText('pay evil')).toBeInTheDocument()
    expect(screen.getByText('p · abcd')).toBeInTheDocument()
  })

  it('strips bidi characters from a DM plaintext preview but keeps its line breaks', () => {
    const req = { identityName: 'magazine', clientPubkey: 'abcd1234', method: 'nip44_encrypt', plaintextPreview: 'hi\u202E there\nsecond line' }
    const { container } = render(<ApproveSign explain={false} req={req} appName="App" onDecide={vi.fn()} />)
    expect(container.textContent ?? '').not.toMatch(/\u202E/)
    expect(container.textContent).toContain('hi there')
    expect(container.textContent).toContain('second line')
  })
})
