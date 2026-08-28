/**
 * Minimal pixi.js test double covering the filter surface the renderer uses:
 * `Filter.from` (GL-only programs), uniform resource bags, `defaultFilterVert`,
 * BlurFilter.strength and ColorMatrixFilter presets.
 */

export interface MockUniformDeclaration {
  value: number | number[] | Float32Array
  type: string
  size?: number
}

export class MockFilter {
  public destroyed = false
  public destroyCalls: unknown[] = []
  public resources: Record<string, { uniforms: Record<string, unknown> }> = {}
  public glProgram?: { vertex?: string, fragment?: string }
  public options?: Record<string, unknown>

  static from(options: {
    gl?: { vertex?: string, fragment?: string }
    resources?: Record<string, Record<string, MockUniformDeclaration>>
  } & Record<string, unknown>): MockFilter {
    const filter = new MockFilter()
    filter.glProgram = options.gl
    filter.options = options
    for (const [group, declarations] of Object.entries(options.resources ?? {})) {
      const uniforms: Record<string, unknown> = {}
      for (const [name, declaration] of Object.entries(declarations))
        uniforms[name] = declaration.value
      filter.resources[group] = { uniforms }
    }
    return filter
  }

  destroy(...args: unknown[]) {
    this.destroyed = true
    this.destroyCalls.push(args[0])
  }
}

export class MockBlurFilter extends MockFilter {
  public strength = 8
  public quality = 1

  constructor(options?: { strength?: number, quality?: number }) {
    super()
    if (typeof options?.strength === 'number')
      this.strength = options.strength
    if (typeof options?.quality === 'number')
      this.quality = options.quality
  }
}

export class MockColorMatrixFilter extends MockFilter {
  public matrix: number[] = []
  public calls: Array<[string, number | undefined]> = []

  reset() {
    this.matrix = []
    this.calls.push(['reset', undefined])
  }

  grayscale(scale?: number) { this.calls.push(['grayscale', scale]) }
  sepia() { this.calls.push(['sepia', undefined]) }
  negative() { this.calls.push(['negative', undefined]) }
  vintage() { this.calls.push(['vintage', undefined]) }
  contrast(amount?: number) { this.calls.push(['contrast', amount]) }
  brightness(amount?: number) { this.calls.push(['brightness', amount]) }
  saturate(amount?: number) { this.calls.push(['saturate', amount]) }
  hue(amount?: number) { this.calls.push(['hue', amount]) }
}

export const MOCK_DEFAULT_FILTER_VERT = 'mock-default-filter-vert'

export function createPixiMock() {
  return {
    Filter: MockFilter,
    BlurFilter: MockBlurFilter,
    ColorMatrixFilter: MockColorMatrixFilter,
    defaultFilterVert: MOCK_DEFAULT_FILTER_VERT,
  }
}
