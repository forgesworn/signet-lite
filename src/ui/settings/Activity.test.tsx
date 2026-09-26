// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Activity, type ActivityRow } from './Activity'

afterEach(cleanup)

const NOW = 10_000
const rows: ActivityRow[] = [
  { id: 2, ts: NOW - 60, appName: 'noStrudel', identityName: 'magazine', method: 'sign_event', kind: 1, outcome: 'signed', auto: false, rateLimited: false },
  { id: 1, ts: NOW - 3600, appName: 'Primal', identityName: 'meme', method: 'nip44_decrypt', outcome: 'denied', auto: false, rateLimited: false },
]

function noopProps() {
  return { nowSeconds: NOW, explain: false, onClear: vi.fn(), onBack: vi.fn() }
}

describe('Activity', () => {
  it('renders each entry with a friendly description, app, identity and outcome', () => {
    render(<Activity entries={rows} {...noopProps()} />)
    expect(screen.getByText('Signed a note')).toBeInTheDocument()
    expect(screen.getByText('Read a message')).toBeInTheDocument()
    expect(screen.getByText(/noStrudel · magazine/)).toBeInTheDocument()
    expect(screen.getByText('Signed')).toBeInTheDocument()
    expect(screen.getByText('Declined')).toBeInTheDocument()
  })

  it('shows an empty state and no clear button when there is no activity', () => {
    render(<Activity entries={[]} {...noopProps()} />)
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /clear history/i })).not.toBeInTheDocument()
  })

  it('requires a confirm before clearing, then calls onClear', async () => {
    const onClear = vi.fn()
    render(<Activity entries={rows} {...noopProps()} onClear={onClear} />)
    await userEvent.click(screen.getByRole('button', { name: /clear history/i }))
    expect(onClear).not.toHaveBeenCalled() // first tap only reveals the confirm
    await userEvent.click(screen.getByRole('button', { name: /clear history/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows the scope label when viewing one app', () => {
    render(<Activity entries={rows} {...noopProps()} scopeLabel="noStrudel" />)
    expect(screen.getByText(/for noStrudel/i)).toBeInTheDocument()
  })

  it('badges an auto-approved sign, and a rate-limited one', () => {
    const flagged: ActivityRow[] = [
      { id: 3, ts: NOW, appName: 'Auto app', identityName: 'magazine', method: 'sign_event', kind: 1, outcome: 'signed', auto: true, rateLimited: false },
      { id: 4, ts: NOW, appName: 'Busy app', identityName: 'magazine', method: 'sign_event', kind: 1, outcome: 'signed', auto: false, rateLimited: true },
    ]
    render(<Activity entries={flagged} {...noopProps()} />)
    expect(screen.getByText('Auto')).toBeInTheDocument()
    expect(screen.getByText('Rate-limited')).toBeInTheDocument()
  })

  it('does not badge an ordinary prompted sign as Auto', () => {
    render(<Activity entries={rows} {...noopProps()} />)
    expect(screen.queryByText('Auto')).not.toBeInTheDocument()
  })

  it('reads an auto-declined (rule-blocked) request as "Blocked", not "Declined"', () => {
    const blocked: ActivityRow[] = [
      { id: 5, ts: NOW, appName: 'Pushy app', identityName: 'magazine', method: 'sign_event', kind: 0, outcome: 'denied', auto: true, rateLimited: false },
    ]
    render(<Activity entries={blocked} {...noopProps()} />)
    expect(screen.getByText('Blocked')).toBeInTheDocument()
    expect(screen.queryByText('Declined')).not.toBeInTheDocument()
  })

  it('reads an unanswered request as "Timed out" with an explanatory line', () => {
    const timedOut: ActivityRow[] = [
      { id: 7, ts: NOW, appName: 'Slow app', identityName: 'magazine', method: 'sign_event', kind: 1, outcome: 'denied', auto: false, rateLimited: false, timedOut: true },
    ]
    render(<Activity entries={timedOut} {...noopProps()} />)
    expect(screen.getByText('Timed out')).toBeInTheDocument()
    expect(screen.getByText(/no response/i)).toBeInTheDocument()
    expect(screen.queryByText('Declined')).not.toBeInTheDocument()
  })

  it('shows a friendly reason on a failed request', () => {
    const failed: ActivityRow[] = [
      { id: 6, ts: NOW, appName: 'Buggy app', identityName: 'magazine', method: 'sign_event', kind: 1, outcome: 'error', auto: false, rateLimited: false, errorCode: 'invalid event template' },
    ]
    render(<Activity entries={failed} {...noopProps()} />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Invalid request from the app')).toBeInTheDocument()
  })
})
