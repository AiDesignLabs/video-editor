import { createGenerator } from 'unocss'
import { describe, expect, it } from 'vitest'
import config from '../unocss.config'

describe('exported UnoCSS specificity', () => {
  it('keeps global library utilities below host utility selectors', async () => {
    const uno = await createGenerator(config)
    const { css } = await uno.generate('i-creatly-element h-10 w-10 flex')

    expect(css).toContain(':where(.i-creatly-element)')
    expect(css).toContain(':where(.h-10)')
    expect(css).toContain(':where(.w-10)')
    expect(css).toContain(':where(.flex)')
    expect(css).not.toContain(':where(@property')
    expect(css).toContain('@layer icons')
    expect(css).toContain('@layer default')
    expect(css.indexOf('@layer icons')).toBeLessThan(css.indexOf('@layer default'))
    expect(css).not.toContain('.i-creatly-element{')
    expect(css).not.toContain('.h-10{')
    expect(css).not.toContain('.w-10{')
    expect(css).not.toContain('.flex{')
  })
})
