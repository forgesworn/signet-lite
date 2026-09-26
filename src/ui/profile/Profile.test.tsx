// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profile } from './Profile'

afterEach(cleanup)

function renderProfile(over: Partial<Parameters<typeof Profile>[0]> = {}) {
  return render(
    <Profile
      identityName="magazine" explain={false}
      initialMetadata={{ name: 'Mag', lud16: 'a@b.com' }}
      loading={false} saving={false}
      onSave={vi.fn()} onBack={() => {}}
      {...over}
    />,
  )
}

describe('Profile', () => {
  it('pre-fills fields and saves the edited metadata', async () => {
    const onSave = vi.fn()
    renderProfile({ onSave })
    expect(screen.getByLabelText('Name')).toHaveValue('Mag')
    expect(screen.getByLabelText('Lightning address')).toHaveValue('a@b.com')

    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'Magazine')
    await userEvent.type(screen.getByLabelText('Bio'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: /save & publish/i }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const [metadata, newAvatar] = onSave.mock.calls[0]
    expect(metadata).toMatchObject({ name: 'Magazine', about: 'hello', lud16: 'a@b.com' })
    expect(newAvatar).toBeUndefined()
  })

  it('shows a loading state and hides the form while fetching', () => {
    renderProfile({ loading: true })
    expect(screen.getByText(/loading your profile/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).toBeNull()
  })

  it('disables the button and shows progress while saving', () => {
    renderProfile({ saving: true })
    expect(screen.getByRole('button', { name: /publishing/i })).toBeDisabled()
  })
})
