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

  it('lets voters select issue priorities before searching', () => {
    render(<App />)

    expect(screen.getByText('choose what matters to you')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /healthcare/i })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: /healthcare/i }))
    fireEvent.click(screen.getByRole('button', { name: /housing/i }))

    expect(screen.getByRole('button', { name: /healthcare/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /housing/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('your briefing will prioritize healthcare and housing & homeownership.')).toBeInTheDocument()
  })

  it('includes middle-of-the-road public safety and gun policy priorities', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /crime & public safety/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /second amendment & gun policy/i })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: /crime & public safety/i }))
    fireEvent.click(screen.getByRole('button', { name: /second amendment & gun policy/i }))

    expect(screen.getByText('your briefing will prioritize crime & public safety and second amendment & gun policy.')).toBeInTheDocument()
  })

  it('includes neutral hot-button policy priorities', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /border security/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /more issues/i }))

    expect(screen.getByRole('button', { name: /abortion & reproductive policy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /election rules/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /free speech & online safety/i })).toBeInTheDocument()
  })

  it('shows six front-page issue pills and expands more issues on request', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: /healthcare/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /housing/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /crime & public safety/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /second amendment & gun policy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /border security/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /taxes & spending/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /education/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /more issues/i }))

    expect(screen.getByRole('button', { name: /education/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fewer issues/i })).toBeInTheDocument()
    expect(screen.getByText('think an issue is missing?')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /suggest one/i })).toHaveAttribute(
      'href',
      'mailto:moguinyard@gmail.com?subject=Issue%20suggestion%20for%20How%20Did%20Your%20Rep%20Vote',
    )
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

  it('preloads representative options before the representative tab is opened', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        representatives: [{
          bioguideId: 'O000172',
          display: 'Alexandria Ocasio-Cortez (NY-14)',
          label: 'Alexandria Ocasio-Cortez',
          search: 'Ocasio-Cortez, Alexandria',
        }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:5000/representatives')
    })
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
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/reps'))).toBe(false)
  })

  it('renders voter-facing recent vote context when available', async () => {
    const fetchMock = vi.fn(url => {
      if (String(url).includes('/member/R000000/votes')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            votes: [{
              bill: { number: '6329', title: 'Veterans Health Care Improvement Act', type: 'HR' },
              date: '2026-01-01T12:00:00-05:00',
              description: 'Veterans Health Care Improvement Act',
              position: 'Yea',
              result: 'Passed',
              rollCall: '74',
              source: 'congress.gov',
              voterContext: {
                contextNote: '',
                contextSource: 'congress.gov bill summary',
                headline: 'Veterans Health Care Improvement Act',
                impact: 'This bill would expand care access for veterans and patients.',
                issue: 'Healthcare',
                kind: 'policy',
                positionLabel: 'Voted Yea',
                resultLabel: 'Passed',
                sourceSummary: 'This bill would expand care access for veterans and patients.',
              },
            }],
          }),
        })
      }
      return Promise.resolve({
        json: () => Promise.resolve({
          state: 'GA',
          district: '4',
          districtLabel: 'GA-4',
          representative: {
            bioguideId: 'R000000',
            name: 'Johnson, Henry C. "Hank"',
            partyName: 'Democratic',
            terms: { item: [{ chamber: 'House of Representatives' }] },
          },
          senators: [],
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.change(screen.getByLabelText(/your address/i), {
      target: { value: '123 Main St Decatur, GA 30030' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    fireEvent.click(await screen.findByRole('button', { name: /recent votes/i }))

    expect(await screen.findByText('Veterans Health Care Improvement Act')).toBeInTheDocument()
    expect(screen.getByText(/This bill would expand care access for veterans and patients/)).toBeInTheDocument()
    expect(screen.getByText('Henry C. "Hank" Johnson Voted Yea')).toBeInTheDocument()
    expect(screen.getByText('Passed')).toBeInTheDocument()
    expect(screen.getByText('Healthcare · Policy vote · Roll call 74 · HR 6329')).toBeInTheDocument()
    expect(screen.queryByText('Policy vote')).not.toBeInTheDocument()

    // Verify DOM order: title, impact, position/result, metadata
    const voteCard = screen.getByText('Veterans Health Care Improvement Act').closest('li')
    const cardText = voteCard.textContent
    const titleIndex = cardText.indexOf('Veterans Health Care Improvement Act')
    const impactIndex = cardText.indexOf('This bill would expand care access for veterans and patients')
    const positionIndex = cardText.indexOf('Henry C. "Hank" Johnson Voted Yea')
    const metadataIndex = cardText.indexOf('Healthcare · Policy vote · Roll call 74 · HR 6329')
    expect(titleIndex).toBeLessThan(impactIndex)
    expect(impactIndex).toBeLessThan(positionIndex)
    expect(positionIndex).toBeLessThan(metadataIndex)
  })

  it('falls back for recent votes without voter context', async () => {
    const fetchMock = vi.fn(url => {
      if (String(url).includes('/member/R000000/votes')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            votes: [{
              bill: { number: '2', title: 'Example Act', type: 'HR' },
              date: '2026-01-02T12:00:00-05:00',
              description: 'Example Act',
              interpretation: { kind: 'policy', summary: 'Substantive policy vote related to Example Act.' },
              position: 'Nay',
              result: 'Failed',
              rollCall: '75',
            }],
          }),
        })
      }
      return Promise.resolve({
        json: () => Promise.resolve({
          state: 'GA',
          district: '4',
          districtLabel: 'GA-4',
          representative: {
            bioguideId: 'R000000',
            name: 'Johnson, Henry C. "Hank"',
            partyName: 'Democratic',
            terms: { item: [{ chamber: 'House of Representatives' }] },
          },
          senators: [],
        }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.change(screen.getByLabelText(/your address/i), {
      target: { value: '123 Main St Decatur, GA 30030' },
    })
    fireEvent.click(screen.getByRole('button', { name: /search/i }))
    fireEvent.click(await screen.findByRole('button', { name: /recent votes/i }))

    expect(await screen.findByText('Example Act')).toBeInTheDocument()
    expect(screen.getByText('Substantive policy vote related to Example Act.')).toBeInTheDocument()
    expect(screen.getByText('Nay')).toBeInTheDocument()
  })

  it('renders the site footer with lowercase Morgan Guinyard contact links', () => {
    render(<App />)

    expect(screen.getByText('© 2026 morgan guinyard')).toBeInTheDocument()
    expect(screen.getByText('powered by:')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Congress.gov' })).toHaveAttribute('href', 'https://www.congress.gov')
    expect(screen.getByRole('link', { name: 'Census Geocoder' })).toHaveAttribute('href', 'https://geocoding.geo.census.gov')
    expect(screen.getByRole('link', { name: 'Senate.gov' })).toHaveAttribute('href', 'https://www.senate.gov')
    expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute('href', 'https://www.wikipedia.org')
    expect(screen.getByRole('link', { name: 'Google Gemini' })).toHaveAttribute('href', 'https://ai.google.dev')
    expect(screen.getByRole('link', { name: 'email' })).toHaveAttribute('href', 'mailto:moguinyard@gmail.com')
    expect(screen.getByRole('link', { name: 'github' })).toHaveAttribute('href', 'https://github.com/LandBasedFighter')
    expect(screen.getByRole('link', { name: 'linkedin' })).toHaveAttribute('href', 'https://www.linkedin.com/in/morgan-guinyard-6304a1284/')
    expect(screen.getByRole('link', { name: 'register to vote' })).toHaveAttribute('href', 'https://vote.gov')
  })
})
