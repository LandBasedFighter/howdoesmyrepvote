import { useEffect, useRef, useState } from "react"

const ITEMS_PER_PAGE = 5
const DEFAULT_API_HOST = typeof window === "undefined" ? "localhost" : window.location.hostname || "localhost"
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? `http://${DEFAULT_API_HOST}:5000`
const SEARCH_MODES = {
  address: {
    label: "Address",
    inputLabel: "Your address",
    placeholder: "350 5th Ave, New York",
    helper: "We only use your address to identify your district. Complete addresses work best.",
  },
  district: {
    label: "District",
    inputLabel: "Congressional district",
    placeholder: "NY-12 or New York 12",
    helper: "Search directly by district name or code, such as NY-12, New York 12, California 30, or Vermont at-large.",
  },
  representative: {
    label: "Representative",
    inputLabel: "Representative name",
    placeholder: "Alexandria Ocasio-Cortez",
    helper: "Search by a current House member's name if you do not know their district.",
  },
}
const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
}
const STATE_ABBREVIATIONS = Object.fromEntries(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]))
const HOUSE_DISTRICT_COUNTS = {
  AL: 7, AK: 1, AZ: 9, AR: 4, CA: 52, CO: 8, CT: 5, DE: 1, FL: 28, GA: 14,
  HI: 2, ID: 2, IL: 17, IN: 9, IA: 4, KS: 4, KY: 6, LA: 6, ME: 2, MD: 8,
  MA: 9, MI: 13, MN: 8, MS: 4, MO: 8, MT: 2, NE: 3, NV: 4, NH: 2, NJ: 12,
  NM: 3, NY: 26, NC: 14, ND: 1, OH: 15, OK: 5, OR: 6, PA: 17, RI: 2, SC: 7,
  SD: 1, TN: 9, TX: 38, UT: 4, VT: 1, VA: 11, WA: 10, WV: 2, WI: 8, WY: 1,
}
const AT_LARGE_STATES = new Set(["AK", "DE", "ND", "SD", "VT", "WY"])
const DISTRICT_OPTIONS = Object.entries(HOUSE_DISTRICT_COUNTS).flatMap(([state, count]) => {
  if (AT_LARGE_STATES.has(state)) {
    return [{
      state,
      district: "AL",
      label: `${state}-AL`,
      display: `${STATE_NAMES[state]}'s at-large congressional district`,
    }]
  }
  return Array.from({ length: count }, (_, index) => {
    const district = String(index + 1)
    return {
      state,
      district,
      label: `${state}-${district}`,
      display: `${STATE_NAMES[state]}'s ${ordinal(district)} congressional district`,
    }
  })
})

function ordinal(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  if (number % 100 >= 11 && number % 100 <= 13) return `${number}th`
  return `${number}${{ 1: "st", 2: "nd", 3: "rd" }[number % 10] ?? "th"}`
}

function normalizeDistrictNumber(value) {
  const normalized = String(value || "").trim().toLowerCase()
  if (/\bat[- ]?large\b/.test(normalized)) return "AL"
  if (["al", "at-large", "at large", "0", "00"].includes(normalized)) return "AL"
  const match = normalized.match(/\d+/)
  return match ? String(Number(match[0])) : ""
}

function parseDistrictSearch(value) {
  const normalized = value.trim().replace(/[.,]/g, " ").replace(/\s+/g, " ")
  if (!normalized) return null

  const compactMatch = normalized.match(/^([a-z]{2})\s*-?\s*(\d+|al|at-large|at large)$/i)
  if (compactMatch) {
    return {
      state: compactMatch[1].toUpperCase(),
      district: normalizeDistrictNumber(compactMatch[2]),
    }
  }

  const stateName = Object.keys(STATE_ABBREVIATIONS)
    .sort((a, b) => b.length - a.length)
    .find(name => normalized.toLowerCase().includes(name))
  if (stateName) {
    const escapedState = stateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const districtValue = "(\\d+(?:st|nd|rd|th)?|al|at-large|at large)"
    const stateFirst = new RegExp(`^${escapedState}\\s+(?:district\\s+)?${districtValue}$`, "i")
    const districtFirst = new RegExp(`^${districtValue}(?:\\s+congressional)?\\s+district\\s+${escapedState}$`, "i")
    const match = normalized.match(stateFirst) || normalized.match(districtFirst)
    if (!match) return null
    return {
      state: STATE_ABBREVIATIONS[stateName],
      district: normalizeDistrictNumber(match[1]),
    }
  }

  return null
}

function districtSuggestions(value) {
  const normalized = value.trim().toLowerCase()
  if (normalized.length < 2) return []
  return DISTRICT_OPTIONS
    .filter(option => (
      option.label.toLowerCase().includes(normalized)
      || option.display.toLowerCase().includes(normalized)
      || `${option.state}${option.district}`.toLowerCase().includes(normalized.replace(/[^a-z0-9]/g, ""))
    ))
    .slice(0, 8)
}

function representativeSuggestions(value, options) {
  const normalized = value.trim().toLowerCase()
  if (normalized.length < 2) return []
  const terms = normalized.split(/\s+/).filter(Boolean)
  return options
    .filter(option => {
      const searchText = `${option.label} ${option.display} ${option.search ?? ""}`.toLowerCase()
      return terms.every(term => searchText.includes(term))
    })
    .slice(0, 8)
}

function looksLikeAddress(value) {
  const normalized = value.trim()
  if (!/\d/.test(normalized) || /^[0-9-]+$/.test(normalized)) return false
  return (
    /\b(aly|alley|ave|avenue|blvd|boulevard|cir|circle|ct|court|dr|drive|hwy|highway|ln|lane|loop|pkwy|parkway|pl|place|rd|road|sq|square|st|street|ter|terrace|trl|trail|way)\b/i.test(normalized)
    || /,\s*[A-Z]{2}\b/.test(normalized)
    || Object.values(STATE_NAMES).some(stateName => normalized.toLowerCase().includes(stateName.toLowerCase()))
  )
}

function getPartyClass(partyName) {
  if (partyName === "Democratic") return "party-democratic"
  if (partyName === "Republican") return "party-republican"
  return "party-independent"
}

function formatMemberName(name) {
  if (!name || !name.includes(",")) return name
  const [last, ...rest] = name.split(",")
  const givenNames = rest.join(",").trim()
  return `${givenNames} ${last.trim()}`.replace(/\s+/g, " ").trim()
}

function formatLatestAction(latestAction) {
  if (!latestAction) return ""
  if (typeof latestAction !== "object") return latestAction
  return `${latestAction.actionDate ?? ""} · ${latestAction.text ?? ""}`.replace(/^ · | · $/, "")
}

function formatBillMeta(bill) {
  const parts = [`${bill.type ?? "Bill"} ${bill.number ?? ""}`.trim()]
  if (bill.introducedDate) parts.push(`Introduced ${bill.introducedDate}`)
  if (bill.policyArea) parts.push(bill.policyArea)
  return parts.filter(Boolean)
}

function formatDateOnly(value) {
  if (!value) return ""
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return value.split(",")[0]
}

function formatVoteMeta(vote) {
  const bill = vote.bill ?? {}
  const parts = []
  if (vote.rollCall) parts.push(`Roll call ${vote.rollCall}`)
  if (bill.type && bill.number) parts.push(`${bill.type} ${bill.number}`)
  if (vote.date) parts.push(formatDateOnly(vote.date))
  return parts
}

function displayVotePosition(memberName, vote) {
  const label = vote.voterContext?.positionLabel
  if (label) return `${memberName} ${label}`
  return vote.position || "Position unavailable"
}

function voteMetadata(vote) {
  const context = vote.voterContext
  const kind = context?.kind || vote.interpretation?.kind
  const bill = vote.bill
  return [
    context?.issue,
    kind ? `${kind[0].toUpperCase()}${kind.slice(1)} vote` : undefined,
    vote.rollCall ? `Roll call ${vote.rollCall}` : undefined,
    bill?.type && bill?.number ? `${bill.type} ${bill.number}` : undefined,
  ].filter(Boolean).join(" · ")
}

function issueExample(issue) {
  const vote = issue.evidence?.[0]
  if (!vote) return ""
  const title = vote.description || vote.bill?.title || vote.question
  if (!title) return ""
  return `${vote.position || "Voted"} on ${title}`
}

function profileSummaryNote(profile) {
  const policyCount = profile.policyVoteCount ?? 0
  const scannedCount = profile.scannedVoteCount ?? 0
  if (profile.aiSummary?.provider === "gemini") {
    return `AI-generated summary based on ${policyCount} substantive policy votes from ${scannedCount} recent roll calls. Review the evidence below; this is a snapshot, not a full career scorecard.`
  }
  return `Based on ${policyCount} substantive policy votes from ${scannedCount} recent roll calls. AI summary is unavailable; this is a snapshot, not a full career scorecard.`
}

function sourceLabel(type, items) {
  if (type === "profile") return "Source: normalized recent roll-call votes"
  if (type === "legislation") return "Source: Congress.gov"
  if (items.some(item => item.source === "senate.gov")) return "Source: Senate.gov roll call XML"
  return "Source: Congress.gov House roll call data"
}

function LoadingButtonContent({ loading, children, loadingText }) {
  return (
    <span className={`button-content ${loading ? "button-content-loading" : ""}`}>
      <span>{loading ? loadingText : children}</span>
      {loading && (
        <span className="loading-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
    </span>
  )
}

function SkeletonLine({ width = "100%" }) {
  return <span className="skeleton-line" style={{ width }} />
}

function DetailSkeletonList({ label }) {
  return (
    <div className="details-panel" aria-label={label} aria-live="polite">
      <ul className="detail-list">
        {[0, 1, 2].map(index => (
          <li key={index} className="detail-item detail-skeleton">
            <SkeletonLine width={index === 0 ? "82%" : "68%"} />
            <SkeletonLine width="46%" />
            <div className="skeleton-meta-row">
              <SkeletonLine width="72px" />
              <SkeletonLine width="96px" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResultsSkeleton() {
  return (
    <section className="results-section results-skeleton" aria-live="polite" aria-label="Loading representatives">
      <div className="results-header">
        <div>
          <SkeletonLine width="90px" />
          <SkeletonLine width="280px" />
        </div>
      </div>
      <div className="member-grid">
        {[0, 1].map(group => (
          <div key={group} className="result-group">
            <SkeletonLine width={group === 0 ? "180px" : "130px"} />
            <article className="member-card loading-card">
              <div className="member-summary">
                <span className="member-photo skeleton-avatar" />
                <div className="member-details skeleton-member-details">
                  <SkeletonLine width="96px" />
                  <SkeletonLine width="180px" />
                  <SkeletonLine width="92px" />
                </div>
              </div>
              <div className="member-actions">
                <SkeletonLine width="100%" />
                <SkeletonLine width="100%" />
              </div>
            </article>
          </div>
        ))}
      </div>
    </section>
  )
}

function VoteCard({ vote, displayName }) {
  const context = vote.voterContext
  const metadata = voteMetadata(vote)
  const headline = context?.headline || vote.description || "Vote details unavailable"
  const impact = context?.impact || vote.interpretation?.summary
  const result = context?.resultLabel || vote.result

  return (
    <li className={`detail-item vote-card ${context ? "vote-card-contextual" : ""}`}>
      <div className="detail-title">{headline}</div>
      {impact && <div className="vote-impact">{impact}</div>}
      {context?.contextNote && <div className="vote-context-note">{context.contextNote}</div>}
      {!context && vote.question && vote.question !== vote.description && (
        <div className="vote-question">{vote.question}</div>
      )}
      <div className="vote-row vote-row-prominent">
        <span className="vote-position">{displayVotePosition(displayName, vote)}</span>
        {result && <span>{result}</span>}
      </div>
      {metadata && <div className="vote-metadata-line">{metadata}</div>}
      <div className="detail-meta">
        {formatVoteMeta(vote).map(part => <span key={part}>{part}</span>)}
      </div>
    </li>
  )
}

function MemberCard({ member }) {
  const [bills, setBills] = useState([])
  const [votes, setVotes] = useState([])
  const [profile, setProfile] = useState(null)
  const [loadingType, setLoadingType] = useState("")
  const [expandedType, setExpandedType] = useState("")
  const [memberError, setMemberError] = useState("")
  const [detailsNote, setDetailsNote] = useState("")

  async function fetchMemberDetails(type) {
    if (expandedType === type) {
      setExpandedType("")
      return
    }

    setLoadingType(type)
    setMemberError("")
    setDetailsNote("")
    try {
      const endpoint = type === "votes" ? "votes" : "legislation"
      const detailEndpoint = type === "profile" ? "stance" : endpoint
      const res = await fetch(`${API_BASE_URL}/member/${member.bioguideId}/${detailEndpoint}?limit=${ITEMS_PER_PAGE}`)
      const data = await res.json()
      if (data.error) {
        setMemberError(data.error)
        return
      }
      if (type === "profile") {
        setProfile(data.profile || null)
      } else if (type === "votes") {
        setVotes(data.votes || [])
        setDetailsNote(data.note || "")
      } else {
        setBills(data.bills || [])
      }
      setExpandedType(type)
    } catch {
      setMemberError("Could not load member details from the local API.")
    } finally {
      setLoadingType("")
    }
  }

  const expandedItems = expandedType === "votes" ? votes : bills
  const partyClass = getPartyClass(member.partyName)
  const displayName = formatMemberName(member.name)

  return (
    <article className={`member-card ${partyClass}`}>
      <div className="member-summary">
        {member.depiction?.imageUrl && (
          <img className="member-photo" src={member.depiction.imageUrl} alt={displayName} />
        )}
        <div className="member-details">
          <h3>{displayName}</h3>
          <span className="party-pill">{member.partyName}</span>
        </div>
      </div>

      <div className="member-actions">
        <button className="secondary-button" onClick={() => fetchMemberDetails("profile")} disabled={Boolean(loadingType)}>
          <LoadingButtonContent loading={loadingType === "profile"} loadingText="Building profile">
            {expandedType === "profile" ? "Hide profile" : "Policy profile"}
          </LoadingButtonContent>
        </button>
        <button className="secondary-button" onClick={() => fetchMemberDetails("votes")} disabled={Boolean(loadingType)}>
          <LoadingButtonContent loading={loadingType === "votes"} loadingText="Loading votes">
            {expandedType === "votes" ? "Hide votes" : "Recent votes"}
          </LoadingButtonContent>
        </button>
        <button className="secondary-button" onClick={() => fetchMemberDetails("legislation")} disabled={Boolean(loadingType)}>
          <LoadingButtonContent loading={loadingType === "legislation"} loadingText="Loading bills">
            {expandedType === "legislation" ? "Hide bills" : "Sponsored bills"}
          </LoadingButtonContent>
        </button>
      </div>

      {memberError && <p className="inline-error">{memberError}</p>}
      {detailsNote && expandedType === "votes" && <p className="detail-note">{detailsNote}</p>}
      {loadingType && <DetailSkeletonList label={`Loading ${loadingType}`} />}

      {!loadingType && expandedType === "profile" && profile && (
        <div className="details-panel">
          {profile.aiSummary && (
            <div className="ai-summary-card">
              <div className="ai-summary-label">
                {profile.aiSummary.provider === "gemini" ? "Policy Flash analysis" : "Policy analysis unavailable"}
              </div>
              <div className="ai-summary-headline">{profile.aiSummary.headline}</div>
              {profile.aiSummary.takeaways?.length > 0 && (
                <ul className="ai-takeaways">
                  {profile.aiSummary.takeaways.map(takeaway => <li key={takeaway}>{takeaway}</li>)}
                </ul>
              )}
              <div className="ai-caveat">{profileSummaryNote(profile)}</div>
            </div>
          )}
          {profile.issues.length > 0 ? (
            <div className="issue-list">
              {profile.issues.map(issue => (
                <div key={issue.issue} className="issue-card">
                  <div>
                    <div className="issue-title">{issue.issue}</div>
                    <div className="issue-direction">{issue.direction} · {issue.confidence}</div>
                    {issueExample(issue) && <div className="issue-example">{issueExample(issue)}</div>}
                  </div>
                  <div className="issue-counts">
                    <span>{issue.supported} supported</span>
                    <span>{issue.opposed} opposed</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-state">Not enough substantive votes in the scanned snapshot.</p>
          )}
          {profile.notableVotes.length > 0 && (
            <>
              <div className="section-label">Evidence votes</div>
              <ul className="detail-list">
                {profile.notableVotes.map((vote, i) => (
                  <li key={`${vote.rollCall}-${vote.date}-${i}`} className="detail-item">
                    <span className="vote-kind vote-kind-policy">Policy vote</span>
                    <div className="detail-title">{vote.description || "Vote details unavailable"}</div>
                    <div className="detail-meta">
                      {formatVoteMeta(vote).map(part => <span key={part}>{part}</span>)}
                    </div>
                    <div className="vote-row">
                      <span className="vote-position">{vote.position || "Position unavailable"}</span>
                      {vote.result && <span>{vote.result}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="source-line">{sourceLabel("profile", [])}</div>
        </div>
      )}

      {!loadingType && expandedType !== "profile" && expandedType && expandedItems.length > 0 && (
        <div className="details-panel">
          <ul className="detail-list">
            {expandedType === "votes"
              ? expandedItems.map((vote, i) => (
                <VoteCard key={`${vote.rollCall}-${vote.date}-${i}`} vote={vote} displayName={displayName} />
              ))
              : expandedItems.map((bill, i) => (
                <li key={`${bill.type}-${bill.number}-${i}`} className="detail-item">
                  <div className="detail-title">{bill.title ? bill.title : `Amendment ${bill.amendmentNumber}`}</div>
                  <div className="detail-meta">
                    {formatBillMeta(bill).map(part => <span key={part}>{part}</span>)}
                  </div>
                  {bill.latestAction && (
                    <div className="latest-action">{formatLatestAction(bill.latestAction)}</div>
                  )}
                </li>
              ))}
          </ul>
          <div className="source-line">{sourceLabel(expandedType, expandedItems)}</div>
        </div>
      )}

      {!loadingType && expandedType !== "profile" && expandedType && expandedItems.length === 0 && !memberError && (
        <p className="empty-state">No {expandedType === "votes" ? "recent votes" : "sponsored legislation"} found.</p>
      )}
    </article>
  )
}

function App() {
  const [searchMode, setSearchMode] = useState("address")
  const [searchText, setSearchText] = useState("")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [representativeOptions, setRepresentativeOptions] = useState([])
  const lookupSectionRef = useRef(null)
  const mode = SEARCH_MODES[searchMode]
  const districtMatches = searchMode === "district" ? districtSuggestions(searchText) : []
  const representativeMatches = searchMode === "representative" ? representativeSuggestions(searchText, representativeOptions) : []

  useEffect(() => {
    if (searchMode !== "representative" || representativeOptions.length > 0) return

    let cancelled = false
    async function loadRepresentatives() {
      try {
        const res = await fetch(`${API_BASE_URL}/representatives`)
        const json = await res.json()
        if (!cancelled) {
          setRepresentativeOptions(json.representatives || [])
        }
      } catch {
        if (!cancelled) setRepresentativeOptions([])
      }
    }
    loadRepresentatives()

    return () => {
      cancelled = true
    }
  }, [representativeOptions.length, searchMode])

  useEffect(() => {
    if (!loading && !data) return
    if (typeof lookupSectionRef.current?.scrollIntoView === "function") {
      lookupSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [data, loading])

  async function fetchReps(searchOverride = searchText, modeOverride = searchMode) {
    const trimmedSearch = searchOverride.trim()
    if (!trimmedSearch) {
      setError('Try a full address like "350 5th Ave New York, NY" or a district like "NY-12."')
      return
    }
    if (modeOverride === "address" && /^\d{5}(?:-\d{4})?$/.test(trimmedSearch)) {
      setError(`ZIP ${trimmedSearch.slice(0, 5)} may overlap multiple districts. Try a full address or switch to district search.`)
      return
    }
    if (modeOverride === "address" && parseDistrictSearch(trimmedSearch)) {
      setError("That looks like a congressional district. Switch to District search to look it up directly.")
      return
    }
    if (modeOverride === "address" && !looksLikeAddress(trimmedSearch)) {
      setError('Enter a complete street address, like "350 5th Ave New York, NY 10001", or switch to District or Representative search.')
      return
    }
    setLoading(true)
    setError("")
    setData(null)
    try {
      let url = `${API_BASE_URL}/reps`
      let options = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: trimmedSearch }),
      }
      if (modeOverride === "district") {
        const districtMatch = parseDistrictSearch(trimmedSearch)
        if (!districtMatch?.state || !districtMatch?.district) {
          setError('Try a district like "NY-12", "New York 12", or "Vermont at-large."')
          return
        }
        url = `${API_BASE_URL}/reps?state=${encodeURIComponent(districtMatch.state)}&district=${encodeURIComponent(districtMatch.district)}`
        options = undefined
      } else if (modeOverride === "representative") {
        url = `${API_BASE_URL}/reps?representative=${encodeURIComponent(trimmedSearch)}`
        options = undefined
      }
      const res = options ? await fetch(url, options) : await fetch(url)
      const json = await res.json()
      if (json.error) {
        setError(json.error)
        return
      }
      setData(json)
    } catch {
      setError("Could not reach the local API. Make sure the Flask server is running.")
    } finally {
      setLoading(false)
    }
  }

  function updateSearchText(value) {
    setSearchText(value)
    if (searchMode !== "representative" || loading) return
    const selectedRepresentative = representativeOptions.find(option => option.label === value)
    if (selectedRepresentative) {
      fetchReps(value, "representative")
    }
  }

  return (
    <>
      <main className="app-shell">
      <section className="hero">
        <div>
          <h1>Find your representatives and how they vote.</h1>
          <p className="hero-copy">
            Enter a street address or congressional district to find your House member, senators, recent votes, and sponsored legislation.
          </p>
        </div>

        <div className="search-card">
          <div className="search-mode-tabs" role="tablist" aria-label="Search type" data-active={searchMode}>
            {Object.entries(SEARCH_MODES).map(([key, config]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={searchMode === key}
                className={searchMode === key ? "active" : ""}
                onClick={() => {
                  setSearchMode(key)
                  setError("")
                  setData(null)
                }}
                disabled={loading}
              >
                {config.label}
              </button>
            ))}
          </div>
          <label htmlFor="search-text">{mode.inputLabel}</label>
          <div className="search-row">
            <input
              id="search-text"
              type="text"
              placeholder={mode.placeholder}
              value={searchText}
              onChange={e => updateSearchText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && fetchReps()}
              disabled={loading}
              list={searchMode === "district" ? "district-options" : searchMode === "representative" ? "representative-options" : undefined}
            />
            {searchMode === "district" && (
              <datalist id="district-options">
                {districtMatches.map(option => (
                  <option key={option.label} value={option.label}>{option.display}</option>
                ))}
              </datalist>
            )}
            {searchMode === "representative" && (
              <datalist id="representative-options">
                {representativeMatches.map(option => (
                  <option key={option.bioguideId || option.label} value={option.label}>{option.display}</option>
                ))}
              </datalist>
            )}
            <button className="primary-button" onClick={() => fetchReps()} disabled={loading}>
              <LoadingButtonContent loading={loading} loadingText="Searching">
                Search
              </LoadingButtonContent>
            </button>
          </div>
          <p className="helper-text">{mode.helper}</p>
        </div>
      </section>

      <div ref={lookupSectionRef} className="lookup-section-anchor">
        {error && <p className="status-message error">{error}</p>}
        {loading && <ResultsSkeleton />}

        {data && (
          <section className="results-section">
            <div className="results-header">
              <div className="district-summary">
                <h2>{data.districtLabel ?? `${data.state}-${data.district}`}</h2>
                {data.districtDescription && <p className="district-description">{data.districtDescription}</p>}
              </div>
            </div>

            <div className="member-grid">
              <div className="result-group">
                <h2>Your Representative</h2>
                {data.representative
                  ? <MemberCard member={data.representative} />
                  : <p className="empty-state">No representative found.</p>}
              </div>

              <div className="result-group">
                <h2>Your Senators</h2>
                {data.senators.map(s => <MemberCard key={s.bioguideId} member={s} />)}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>

      <footer className="site-footer">
        <span>© 2026 Morgan Guinyard</span>
        <nav aria-label="Morgan Guinyard links">
          <a href="https://vote.gov">Register to vote</a>
          <a href="mailto:moguinyard@gmail.com">Email</a>
          <a href="https://github.com/LandBasedFighter">GitHub</a>
          <a href="https://www.linkedin.com/in/morgan-guinyard-6304a1284/">LinkedIn</a>
        </nav>
      </footer>
    </>
  )
}

export default App