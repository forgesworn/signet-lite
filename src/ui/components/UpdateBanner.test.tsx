// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateBanner } from './UpdateBanner'

it('shows nothing when no update is pending', () => {
  const { container } = render(<UpdateBanner show={false} onReload={() => {}} onDismiss={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})
it('calls onReload when Reload is tapped', async () => {
  const onReload = vi.fn()
  render(<UpdateBanner show onReload={onReload} onDismiss={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: /reload/i }))
  expect(onReload).toHaveBeenCalledTimes(1)
})
