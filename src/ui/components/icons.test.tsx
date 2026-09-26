// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CameraIcon, LinkIcon, PlusIcon, GlobeIcon } from './icons'

afterEach(cleanup)

describe('icons', () => {
  it('each icon renders an svg with currentColor stroke', () => {
    for (const Icon of [CameraIcon, LinkIcon, PlusIcon, GlobeIcon]) {
      const { container } = render(<Icon />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute('stroke')).toBe('currentColor')
      cleanup()
    }
  })
})
