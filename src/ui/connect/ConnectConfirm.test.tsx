// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectConfirm } from './ConnectConfirm'

afterEach(cleanup)

const sampleApp = { name: 'noStrudel', url: 'https://nostrudel.ninja' }

describe('ConnectConfirm', () => {
  it('shows the app name and origin', () => {
    render(<ConnectConfirm app={sampleApp} explain={false} identities={[{ name: 'magazine' }]} onConnect={vi.fn()} onCancel={() => {}} />)
    expect(screen.getByText('noStrudel')).toBeInTheDocument()
    expect(screen.getByText('https://nostrudel.ninja')).toBeInTheDocument()
  })

  it('connects with the chosen persona and ask-each-time true by default', async () => {
    const onConnect = vi.fn()
    render(<ConnectConfirm app={sampleApp} explain={false} identities={[{ name: 'magazine' }]} onConnect={onConnect} onCancel={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /connect as magazine/i }))
    expect(onConnect).toHaveBeenCalledWith('magazine', true)
  })

  it('passes ask-each-time false when the box is unticked', async () => {
    const onConnect = vi.fn()
    render(<ConnectConfirm app={sampleApp} explain={false} identities={[{ name: 'magazine' }]} onConnect={onConnect} onCancel={() => {}} />)
    await userEvent.click(screen.getByLabelText(/ask before each action/i))
    await userEvent.click(screen.getByRole('button', { name: /connect as magazine/i }))
    expect(onConnect).toHaveBeenCalledWith('magazine', false)
  })

  it('reflects the selected persona in the button label', async () => {
    render(<ConnectConfirm app={sampleApp} explain={false} identities={[{ name: 'magazine' }, { name: 'meme' }]} onConnect={vi.fn()} onCancel={() => {}} />)
    await userEvent.selectOptions(screen.getByLabelText(/sign in as/i), 'meme')
    expect(screen.getByRole('button', { name: /connect as meme/i })).toBeInTheDocument()
  })

  it('renders the error message when error prop is provided', () => {
    render(<ConnectConfirm app={sampleApp} explain={false} identities={[{ name: 'magazine' }]} onConnect={vi.fn()} onCancel={() => {}} error="Relay connection failed." />)
    expect(screen.getByText('Relay connection failed.')).toBeInTheDocument()
  })

  it('renders no error when error prop is omitted', () => {
    render(<ConnectConfirm app={sampleApp} explain={false} identities={[{ name: 'magazine' }]} onConnect={vi.fn()} onCancel={() => {}} />)
    expect(screen.queryByText(/relay connection failed/i)).not.toBeInTheDocument()
  })
})
