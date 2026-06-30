import { expect, test } from '@playwright/test'

const repsPayload = {
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
  senators: [
    {
      bioguideId: 'S000001',
      name: 'Schumer, Charles E.',
      partyName: 'Democratic',
      terms: { item: [{ chamber: 'Senate' }] },
    },
  ],
}

const representativeOptions = {
  representatives: [{
    bioguideId: 'O000172',
    display: 'Alexandria Ocasio-Cortez (NY-14)',
    districtLabel: 'NY-14',
    label: 'Alexandria Ocasio-Cortez',
    search: 'Ocasio-Cortez, Alexandria',
  }],
}

async function mockApi(page, requests = []) {
  await page.route('**/representatives', route => route.fulfill({ json: representativeOptions }))
  await page.route('**/reps**', async route => {
    const request = route.request()
    requests.push({
      method: request.method(),
      postData: request.postDataJSON(),
      url: request.url(),
    })

    if (request.url().includes('representative=Missing')) {
      await route.fulfill({
        status: 404,
        json: { error: 'Could not find a current House representative by that name.' },
      })
      return
    }
    if (request.url().includes('state=CA&district=99')) {
      await route.fulfill({
        status: 404,
        json: { error: 'No current House representative found for CA-99.' },
      })
      return
    }

    await route.fulfill({ json: repsPayload })
  })
}

test('address lookup posts address privately and renders results', async ({ page }) => {
  const requests = []
  await mockApi(page, requests)
  await page.goto('/')

  await page.getByLabel('Your address').fill('350 5th Ave New York, NY 10001')
  await page.getByRole('button', { name: 'Search' }).click()

  await expect(page.getByRole('heading', { name: 'NY-14' })).toBeVisible()
  await expect(page.getByText('Alexandria Ocasio-Cortez')).toBeVisible()
  expect(requests[0]).toMatchObject({
    method: 'POST',
    postData: { address: '350 5th Ave New York, NY 10001' },
  })
  expect(requests[0].url).toBe('http://127.0.0.1:5000/reps')
})

test('district lookup uses query params and renders results', async ({ page }) => {
  const requests = []
  await mockApi(page, requests)
  await page.goto('/')

  await page.getByRole('tab', { name: 'District' }).click()
  await page.getByLabel('Congressional district').fill('New York 14')
  await page.getByRole('button', { name: 'Search' }).click()

  await expect(page.getByText('Alexandria Ocasio-Cortez')).toBeVisible()
  expect(requests[0]).toMatchObject({
    method: 'GET',
    postData: null,
    url: 'http://127.0.0.1:5000/reps?state=NY&district=14',
  })
})

test('representative autocomplete selection searches immediately', async ({ page }) => {
  const requests = []
  await mockApi(page, requests)
  await page.goto('/')

  await page.getByRole('tab', { name: 'Representative' }).click()
  await page.getByLabel('Representative name').fill('Alex')
  await expect(page.locator('datalist#representative-options option')).toHaveAttribute(
    'value',
    'Alexandria Ocasio-Cortez',
  )
  await page.getByLabel('Representative name').fill('Alexandria Ocasio-Cortez')

  await expect(page.getByText('Alexandria Ocasio-Cortez')).toBeVisible()
  expect(requests.at(-1)).toMatchObject({
    method: 'GET',
    postData: null,
    url: 'http://127.0.0.1:5000/reps?representative=Alexandria%20Ocasio-Cortez',
  })
})

test('address mode rejects district-looking, zip-only, and generic text without API calls', async ({ page }) => {
  const requests = []
  await mockApi(page, requests)
  await page.goto('/')

  await page.getByLabel('Your address').fill('GA-4')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText('That looks like a congressional district.')).toBeVisible()

  await page.getByLabel('Your address').fill('10001')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText(/may overlap multiple districts/)).toBeVisible()

  await page.getByLabel('Your address').fill('not an address')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(page.getByText(/Enter a complete street address/)).toBeVisible()
  expect(requests).toEqual([])
})

test('representative lookup shows capitalized not-found errors', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')

  await page.getByRole('tab', { name: 'Representative' }).click()
  await page.getByLabel('Representative name').fill('Missing')
  await page.getByRole('button', { name: 'Search' }).click()

  await expect(page.getByText('Could not find a current House representative by that name.')).toBeVisible()
})

test('district lookup surfaces out-of-range district errors', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')

  await page.getByRole('tab', { name: 'District' }).click()
  await page.getByLabel('Congressional district').fill('CA-99')
  await page.getByRole('button', { name: 'Search' }).click()

  await expect(page.getByText('No current House representative found for CA-99.')).toBeVisible()
})
