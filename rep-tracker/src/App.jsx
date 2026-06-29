import { useState } from "react"

const ITEMS_PER_PAGE = 10
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

function formatVoteMeta(vote) {
  const bill = vote.bill ?? {}
  const parts = []
  if (vote.chamber) parts.push(vote.chamber)
  if (vote.rollCall) parts.push(`Roll call ${vote.rollCall}`)
  if (bill.type && bill.number) parts.push(`${bill.type} ${bill.number}`)
  if (vote.date) parts.push(vote.date)
  return parts
}

function MemberCard({ member, chamber }) {
  const [bills, setBills] = useState([])
  const [votes, setVotes] = useState([])
  const [loadingType, setLoadingType] = useState("")
  const [expandedType, setExpandedType] = useState("")
  const [memberError, setMemberError] = useState("")
  const [page, setPage] = useState(1)

  async function fetchMemberDetails(type) {
    if (expandedType === type) {
      setExpandedType("")
      return
    }

    setLoadingType(type)
    setMemberError("")
    try {
      const endpoint = type === "votes" ? "votes" : "legislation"
      const res = await fetch(`${API_BASE_URL}/member/${member.bioguideId}/${endpoint}`)
      const data = await res.json()
      if (data.error) {
        setMemberError(data.error)
        return
      }
      if (type === "votes") {
        setVotes(data.votes || [])
      } else {
        setBills(data.bills || [])
      }
      setPage(1)
      setExpandedType(type)
    } catch {
      setMemberError("Could not load member details from the local API.")
    } finally {
      setLoadingType("")
    }
  }

  const expandedItems = expandedType === "votes" ? votes : bills
  const totalPages = Math.ceil(expandedItems.length / ITEMS_PER_PAGE)
  const pagedItems = expandedItems.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)
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
        <button className="secondary-button" onClick={() => fetchMemberDetails("votes")} disabled={Boolean(loadingType)}>
          {loadingType === "votes" ? "Loading votes..." : expandedType === "votes" ? "Hide votes" : "Recent votes"}
        </button>
        <button className="secondary-button" onClick={() => fetchMemberDetails("legislation")} disabled={Boolean(loadingType)}>
          {loadingType === "legislation" ? "Loading bills..." : expandedType === "legislation" ? "Hide bills" : "Sponsored bills"}
        </button>
      </div>

      {memberError && <p className="inline-error">{memberError}</p>}

      {expandedType && expandedItems.length > 0 && (
        <div className="details-panel">
          <ul className="detail-list">
            {expandedType === "votes"
              ? pagedItems.map((vote, i) => (
                <li key={`${vote.rollCall}-${vote.date}-${i}`} className="detail-item">
                  <div className="detail-title">{vote.description || "Vote details unavailable"}</div>
                  <div className="detail-meta">
                    {formatVoteMeta(vote).map(part => <span key={part}>{part}</span>)}
                  </div>
                  <div className="vote-row">
                    <span className="vote-position">{vote.position || "Position unavailable"}</span>
                    {vote.result && <span>{vote.result}</span>}
                  </div>
                </li>
              ))
              : pagedItems.map((bill, i) => (
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
          {totalPages > 1 && (
            <div className="pagination">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="ghost-button">
                ← Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="ghost-button">
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {expandedType && expandedItems.length === 0 && !memberError && (
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
            />
            <button className="primary-button" onClick={fetchReps} disabled={loading}>
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
          <p className="helper-text">Powered by Census geocoding and Congress.gov data.</p>
        </div>
      </section>

      {error && <p className="status-message error">{error}</p>}
      {loading && <p className="status-message">Looking up your representatives...</p>}

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