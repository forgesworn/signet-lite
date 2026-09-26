// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Home } from './Home'

afterEach(cleanup)

const IDS = [{ name: 'magazine', npub: 'npub1mag' }, { name: 'meme', npub: 'npub1meme' }]

describe('Home', () => {
  it('lists identities with their npub and fires connect/lock', async () => {
    const onConnect = vi.fn(), onLock = vi.fn()
    render(<Home explain={false} onEditProfile={() => {}} identities={IDS} onAddIdentity={async () => {}} onDeleteIdentity={() => {}} onConnect={onConnect} onSettings={() => {}} onLock={onLock} />)
    expect(screen.getAllByTestId('identity-npub').map(e => e.textContent)).toEqual(['npub1mag', 'npub1meme'])
    await userEvent.click(screen.getByRole('button', { name: /connect an app/i }))
    expect(onConnect).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /lock now/i }))
    expect(onLock).toHaveBeenCalled()
  })

  it('copies the npub (never an nsec) and confirms with feedback', async () => {
    const writeText = vi.fn()
    Object.assign(navigator, { clipboard: { writeText } })
    render(<Home explain={false} onEditProfile={() => {}} identities={[{ name: 'magazine', npub: 'npub1mag' }]} onAddIdentity={async () => {}} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)
    // Guard: no secret key is ever rendered.
    expect(document.body.textContent).not.toMatch(/nsec1/)
    await userEvent.click(screen.getByRole('button', { name: /^copy$/i }))
    // Only the public npub reaches the clipboard — never an nsec.
    expect(writeText).toHaveBeenCalledWith('npub1mag')
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('nsec'))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('opens the profile editor for an identity', async () => {
    const onEditProfile = vi.fn()
    render(<Home explain={false} onEditProfile={onEditProfile} identities={[{ name: 'magazine', npub: 'npub1mag' }]} onAddIdentity={async () => {}} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /edit profile/i }))
    expect(onEditProfile).toHaveBeenCalledWith('magazine')
  })

  it('adds an identity by name', async () => {
    const onAddIdentity = vi.fn()
    render(<Home explain={false} onEditProfile={() => {}} identities={IDS} onAddIdentity={onAddIdentity} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add identity/i }))
    await userEvent.type(screen.getByLabelText('New identity name'), 'work')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(onAddIdentity).toHaveBeenCalledWith('work')
  })

  it('shows a clear inline error for a duplicate identity name, and keeps the form open', async () => {
    const onAddIdentity = vi.fn().mockRejectedValue(new Error('You already have an identity called "magazine"'))
    render(<Home explain={false} onEditProfile={() => {}} identities={IDS} onAddIdentity={onAddIdentity} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add identity/i }))
    await userEvent.type(screen.getByLabelText('New identity name'), 'magazine')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    expect(await screen.findByText('You already have an identity called "magazine"')).toBeInTheDocument()
    // The form stays open with the name preserved, so the user can correct it — no silent failure.
    expect(screen.getByLabelText('New identity name')).toHaveValue('magazine')
  })

  it('clears the inline add-identity error on cancel', async () => {
    const onAddIdentity = vi.fn().mockRejectedValue(new Error('You already have an identity called "magazine"'))
    render(<Home explain={false} onEditProfile={() => {}} identities={IDS} onAddIdentity={onAddIdentity} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add identity/i }))
    await userEvent.type(screen.getByLabelText('New identity name'), 'magazine')
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText('You already have an identity called "magazine"')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    await userEvent.click(screen.getByRole('button', { name: /add identity/i }))
    expect(screen.queryByText('You already have an identity called "magazine"')).toBeNull()
  })

  it('fires onSettings from the gear', async () => {
    const onSettings = vi.fn()
    render(<Home explain={false} onEditProfile={() => {}} identities={IDS} onAddIdentity={async () => {}} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={onSettings} onLock={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(onSettings).toHaveBeenCalled()
  })

  it('does not show Delete button when only one identity', () => {
    render(<Home explain={false} onEditProfile={() => {}} identities={[IDS[0]]} onAddIdentity={async () => {}} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
  })

  it('clicking Delete then Remove calls onDeleteIdentity with the correct name', async () => {
    const onDeleteIdentity = vi.fn()
    render(<Home explain={false} onEditProfile={() => {}} identities={IDS} onAddIdentity={async () => {}} onDeleteIdentity={onDeleteIdentity} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)

    // Both identities get a Delete button
    const deleteBtns = screen.getAllByRole('button', { name: /^delete$/i })
    expect(deleteBtns).toHaveLength(2)

    // Click Delete on magazine (first row)
    await userEvent.click(deleteBtns[0])

    // Confirm prompt appears
    expect(screen.getByText(/Remove magazine\?/i)).toBeTruthy()

    // Click Remove
    await userEvent.click(screen.getByRole('button', { name: /^remove$/i }))
    expect(onDeleteIdentity).toHaveBeenCalledWith('magazine')
  })

  it('cancel on the delete confirm hides the prompt', async () => {
    const onDeleteIdentity = vi.fn()
    render(<Home explain={false} onEditProfile={() => {}} identities={IDS} onAddIdentity={async () => {}} onDeleteIdentity={onDeleteIdentity} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)

    const deleteBtns = screen.getAllByRole('button', { name: /^delete$/i })
    await userEvent.click(deleteBtns[0])
    expect(screen.getByText(/Remove magazine\?/i)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onDeleteIdentity).not.toHaveBeenCalled()
    // Prompt gone, Delete buttons back
    expect(screen.queryByText(/Remove magazine\?/i)).toBeNull()
    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(2)
  })

  it('shows the keep-awake note only when keepAwake is set', () => {
    const props = { explain: false, onEditProfile: () => {}, identities: IDS, onAddIdentity: async () => {}, onDeleteIdentity: () => {}, onConnect: () => {}, onSettings: () => {}, onLock: () => {} }
    const { rerender } = render(<Home {...props} />)
    expect(screen.queryByText(/keeping the screen awake/i)).toBeNull()
    rerender(<Home {...props} keepAwake />)
    expect(screen.getByText(/keeping the screen awake/i)).toBeInTheDocument()
  })

  it('hides Delete for the nsec root identity but keeps it for derived ones', () => {
    render(<Home explain={false} onEditProfile={() => {}} identities={IDS} rootIdentityName="magazine" onAddIdentity={async () => {}} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}} />)
    // Two identities, but only the derived one (meme) gets a Delete control.
    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(1)
  })

  it('shows the kind 0 display name as the heading, with the local label as fallback', () => {
    render(<Home explain={false} onEditProfile={() => {}} onAddIdentity={async () => {}} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}}
      identities={[{ name: 'default', npub: 'npub1mag', displayName: 'TheCryptoDonkey' }, { name: 'meme', npub: 'npub1meme' }]} />)
    expect(screen.getByText('TheCryptoDonkey')).toBeInTheDocument()
    // The identity with no display name still shows its local label.
    expect(screen.getByText('meme')).toBeInTheDocument()
    // The label behind the display name is not shown when a display name is present.
    expect(screen.queryByText('default')).toBeNull()
  })

  it('renders the avatar image when an avatarUrl is given', () => {
    render(<Home explain={false} onEditProfile={() => {}} onAddIdentity={async () => {}} onDeleteIdentity={() => {}} onConnect={() => {}} onSettings={() => {}} onLock={() => {}}
      identities={[{ name: 'default', npub: 'npub1mag', avatarUrl: 'https://x/p.png' }]} />)
    expect(document.querySelector('img[src="https://x/p.png"]')).not.toBeNull()
  })
})
