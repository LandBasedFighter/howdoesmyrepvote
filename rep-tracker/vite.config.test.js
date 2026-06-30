import { describe, expect, it, vi } from 'vitest'

describe('vite config', () => {
  it('defaults to root base path for custom-domain GitHub Pages', async () => {
    vi.resetModules()
    delete process.env.VITE_PUBLIC_BASE_PATH

    const config = (await import('./vite.config.js')).default

    expect(config.base).toBe('/')
  })

  it('allows repository-path Pages deployments through VITE_PUBLIC_BASE_PATH', async () => {
    vi.resetModules()
    process.env.VITE_PUBLIC_BASE_PATH = '/howdoesmyrepvote/'

    const config = (await import('./vite.config.js')).default

    expect(config.base).toBe('/howdoesmyrepvote/')
  })
})
