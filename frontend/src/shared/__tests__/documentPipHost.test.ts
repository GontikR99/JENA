// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { mirrorDocumentStyles } from '../documentPipHost'

describe('mirrorDocumentStyles', () => {
  it('copies existing style and stylesheet nodes', () => {
    const source = document.implementation.createHTMLDocument('source')
    const target = document.implementation.createHTMLDocument('target')
    const style = source.createElement('style')
    const link = source.createElement('link')

    style.textContent = '.example { color: red; }'
    link.rel = 'stylesheet'
    link.href = '/assets/app.css'
    source.head.append(style, link)

    const stopMirroring = mirrorDocumentStyles(source, target)

    expect(target.head.querySelectorAll('style')).toHaveLength(1)
    expect(target.head.querySelector('style')?.textContent).toBe(
      '.example { color: red; }',
    )
    expect(target.head.querySelector('link')?.getAttribute('href')).toBe(
      '/assets/app.css',
    )

    stopMirroring()
  })

  it('syncs style nodes added after mirroring starts', async () => {
    const source = document.implementation.createHTMLDocument('source')
    const target = document.implementation.createHTMLDocument('target')
    const stopMirroring = mirrorDocumentStyles(source, target)
    const style = source.createElement('style')

    style.textContent = '.late { color: blue; }'
    source.head.append(style)
    await Promise.resolve()

    expect(target.head.querySelector('style')?.textContent).toBe(
      '.late { color: blue; }',
    )

    stopMirroring()
  })
})
