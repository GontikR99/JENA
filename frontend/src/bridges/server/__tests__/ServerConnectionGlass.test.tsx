// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ServerConnectionGlass } from '../ServerBridge'

describe('ServerConnectionGlass', () => {
  it('shows a force reload button when the client is out of date', () => {
    const replace = vi.fn()
    const originalLocation = window.location

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'https://jena.tools/triggers?view=info',
        replace,
      },
    })

    render(<ServerConnectionGlass status="incompatible" />)
    fireEvent.click(screen.getByRole('button', { name: 'Force reload' }))

    const reloadUrl = replace.mock.calls[0]?.[0]

    expect(reloadUrl).toMatch(
      /^https:\/\/jena\.tools\/triggers\?view=info&jenaReload=\d+$/,
    )

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    })
  })

  it('does not show the glass when the server bridge is open', () => {
    const { container } = render(<ServerConnectionGlass status="open" />)

    expect(container).toBeEmptyDOMElement()
  })
})
