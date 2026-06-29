import { useState } from "react"

const ITEMS_PER_PAGE = 5
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000"

function getPartyClass(partyName) {
  if (partyName === "Democratic") return "party-democratic"
  if (partyName === "Republican") return "party-republican"
  return "party-independent"
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

function LoadingSpinner() {
  return <span className="loading-spinner" aria-hidden="true" />
}

function LoadingButtonContent({ loading, children, loadingText }) {
  return (
    <span className="button-content">
      {loading && <LoadingSpinner />}
      <span>{loading ? loadingText : children}</span>
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

function MemberCard({ member, chamber }) {
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

  return (
    <article className={`member-card ${partyClass}`}>
      <div className="member-summary">
        {member.depiction?.imageUrl && (
          <img className="member-photo" src={member.depiction.imageUrl} alt={member.name} />
        )}
        <div className="member-details">
          <p className="eyebrow">{chamber}</p>
          <h3>{member.name}</h3>
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
                <li key={`${vote.rollCall}-${vote.date}-${i}`} className="detail-item">
                  {vote.interpretation?.kind && (
                    <span className={`vote-kind vote-kind-${vote.interpretation.kind}`}>
                      {vote.interpretation.kind === "policy" ? "Policy vote" : "Procedural vote"}
                    </span>
                  )}
                  <div className="detail-title">{vote.description || "Vote details unavailable"}</div>
                  {vote.interpretation?.summary && (
                    <div className="vote-summary">{vote.interpretation.summary}</div>
                  )}
                  {vote.question && vote.question !== vote.description && (
                    <div className="vote-question">{vote.question}</div>
                  )}
                  <div className="detail-meta">
                    {formatVoteMeta(vote).map(part => <span key={part}>{part}</span>)}
                  </div>
                  <div className="vote-row">
                    <span className="vote-position">{vote.position || "Position unavailable"}</span>
                    {vote.result && <span>{vote.result}</span>}
                  </div>
                </li>
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
  const [address, setAddress] = useState("")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function fetchReps() {
    const trimmedAddress = address.trim()
    if (!trimmedAddress) {
      setError("Enter an address to search.")
      return
    }
    setLoading(true)
    setError("")
    setData(null)
    try {
      const res = await fetch(`${API_BASE_URL}/reps?address=${encodeURIComponent(trimmedAddress)}`)
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

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Congressional lookup</p>
          <h1>Find your representatives and how they vote.</h1>
          <p className="hero-copy">
            Enter a street address to identify your House district, senators, recent votes, and sponsored legislation.
          </p>
        </div>

        <div className="search-card">
          <label htmlFor="address">Your address</label>
          <div className="search-row">
            <input
              id="address"
              type="text"
              placeholder="350 5th Ave New York, NY 10001"
              value={address}
              onChange={e => setAddress(e.target.value)}
              onKeyDown={e => e.key === "Enter" && fetchReps()}
              disabled={loading}
            />
            <button className="primary-button" onClick={fetchReps} disabled={loading}>
              <LoadingButtonContent loading={loading} loadingText="Searching">
                Search
              </LoadingButtonContent>
            </button>
          </div>
          <p className="helper-text">Powered by Census geocoding and congressional vote data. Performs best with complete addresses (e.g., 350 5th Ave New York, NY 10001).</p>
        </div>
      </section>

      {error && <p className="status-message error">{error}</p>}
      {loading && <ResultsSkeleton />}

      {data && (
        <section className="results-section">
          <div className="results-header">
            <p className="eyebrow">Results</p>
            <h2>{data.state} congressional district {data.district}</h2>
          </div>

          <div className="member-grid">
            <div className="result-group">
              <h2>Your Representative</h2>
              {data.representative
                ? <MemberCard member={data.representative} chamber="House of Representatives" />
                : <p className="empty-state">No representative found.</p>}
            </div>

            <div className="result-group">
              <h2>Your Senators</h2>
              {data.senators.map(s => <MemberCard key={s.bioguideId} member={s} chamber="Senate" />)}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

export default App