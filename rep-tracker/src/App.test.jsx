import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from './App.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('asks for an address before searching', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    expect(screen.getByText(/try a full address/i)).toBeInTheDocument()
  })

  it('surfaces local API connection failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<App />)

    fireEvent.change(screen.getByLabelText(/your address/i), {
      target: { value: '350 5th Ave New York, NY 10001' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    await waitFor(() => {
      expect(screen.getByText(/could not reach the local api/i)).toBeInTheDocument()
    })
  })

  it('renders representatives from the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        state: 'NY',
        district: '12',
        districtDescription: 'NY-12 includes the area around this address in New York County, NY.',
        districtLabel: 'NY-12',
        representative: {
          bioguideId: 'R000000',
          name: 'Johnson, Henry C. "Hank"',
          partyName: 'Democratic',
          terms: { item: [{ chamber: 'House of Representatives' }] },
        },
        senators: [
          {
            bioguideId: 'S000001',
            name: 'Warnock, Raphael G.',
            partyName: 'Democratic',
            terms: { item: [{ chamber: 'Senate' }] },
          },
          {
            bioguideId: 'S000002',
            name: 'Senator Two',
            partyName: 'Republican',
            terms: { item: [{ chamber: 'Senate' }] },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.change(screen.getByLabelText(/your address/i), {
      target: { value: '350 5th Ave New York, NY 10001' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    expect(await screen.findByText('Henry C. "Hank" Johnson')).toBeInTheDocument()
    expect(screen.getByText('Raphael G. Warnock')).toBeInTheDocument()
    expect(screen.getByText('Senator Two')).toBeInTheDocument()
    expect(screen.getByText('NY-12')).toBeInTheDocument()
    expect(screen.getByText('NY-12 includes the area around this address in New York County, NY.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '350 5th Ave New York, NY 10001' }),
    })
  })

  it('searches by congressional district without an address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        state: 'NY',
        district: '12',
        districtDescription: 'Covers much of Manhattan.',
        districtLabel: 'NY-12',
        representative: {
          bioguideId: 'R000000',
          name: 'Nadler, Jerrold',
          partyName: 'Democratic',
          terms: { item: [{ chamber: 'House of Representatives' }] },
        },
        senators: [],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: /district/i }))
    fireEvent.change(screen.getByLabelText(/congressional district/i), {
      target: { value: 'New York 12' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    expect(await screen.findByText('Jerrold Nadler')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/reps?state=NY&district=12')
  })

  it('searches by representative name', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        state: 'NY',
        district: '14',
        districtDescription: 'Covers parts of New York City.',
        districtLabel: 'NY-14',
        representative: {
          bioguideId: 'O000172',
          name: 'Ocasio-Cortez, Alexandria',
          partyName: 'Democratic',
          terms: { item: [{ chamber: 'House of Representatives' }] },
        },
        senators: [],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: /representative/i }))
    fireEvent.change(screen.getByLabelText(/representative name/i), {
      target: { value: 'Alexandria Ocasio-Cortez' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    expect(await screen.findByText('Alexandria Ocasio-Cortez')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/reps?representative=Alexandria%20Ocasio-Cortez')
  })

  it('shows representative autocomplete suggestions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        representatives: [{
          bioguideId: 'O000172',
          display: 'Alexandria Ocasio-Cortez (NY-14)',
          label: 'Alexandria Ocasio-Cortez',
          search: 'Ocasio-Cortez, Alexandria',
        }],
      }),
    }))
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: /representative/i }))
    fireEvent.change(screen.getByLabelText(/representative name/i), {
      target: { value: 'Alexandria' },
    })

    await waitFor(() => {
      expect(document.querySelector('option[value="Alexandria Ocasio-Cortez"]')).not.toBeNull()
    })
  })

  it('searches automatically when a representative suggestion is selected', async () => {
    const fetchMock = vi.fn(url => {
      if (String(url).endsWith('/representatives')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            representatives: [{
              bioguideId: 'O000172',
              display: 'Alexandria Ocasio-Cortez (NY-14)',
              label: 'Alexandria Ocasio-Cortez',
              search: 'Ocasio-Cortez, Alexandria',
            }],
          }),
        })
      }
      return Promise.resolve({
        json: () => Promise.resolve({
          state: 'NY',
          district: '14',
          districtDescription: 'Covers parts of New York City.',
          districtLabel: 'NY-14',
          representative: {
            bioguideId: 'O000172',
            name: 'Ocasio-Cortez, Alexandria',
            partyName: 'Democratic',
            terms: { item: [{ chamber: 'House of Representatives' }] },
          },
          senators: [],
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: /representative/i }))
    fireEvent.change(screen.getByLabelText(/representative name/i), {
      target: { value: 'Alex' },
    })
    await waitFor(() => {
      expect(document.querySelector('option[value="Alexandria Ocasio-Cortez"]')).not.toBeNull()
    })
    fireEvent.change(screen.getByLabelText(/representative name/i), {
      target: { value: 'Alexandria Ocasio-Cortez' },
    })

    expect(await screen.findByText('Alexandria Ocasio-Cortez')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/reps?representative=Alexandria%20Ocasio-Cortez')
  })

  it('explains why ZIP-only address searches are ambiguous', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/your address/i), {
      target: { value: '10001' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    expect(screen.getByText(/may overlap multiple districts/i)).toBeInTheDocument()
  })

  it('rejects district-looking text in address search', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.change(screen.getByLabelText(/your address/i), {
      target: { value: 'GA-4' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))

    expect(screen.getByText(/looks like a congressional district/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
