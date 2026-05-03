import { useState } from "react"

const BILLS_PER_PAGE = 10

function MemberCard({ member, chamber }) {
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(1)

  async function fetchLegislation() {
    if (expanded) { setExpanded(false); return }
    setLoading(true)
    const res = await fetch(`http://localhost:5000/member/${member.bioguideId}/legislation`)
    const data = await res.json()
    setBills(data.bills || [])
    setPage(1)
    setLoading(false)
    setExpanded(true)
  }

  const totalPages = Math.ceil(bills.length / BILLS_PER_PAGE)
  const pagedBills = bills.slice((page - 1) * BILLS_PER_PAGE, page * BILLS_PER_PAGE)

  const partyColor = member.partyName === "Democratic" ? "#3b82f6" :
                     member.partyName === "Republican" ? "#ef4444" : "#8b5cf6"

  return (
    <div style={{ border: `2px solid ${partyColor}`, borderRadius: "8px", padding: "16px", marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {member.depiction?.imageUrl && (
          <img src={member.depiction.imageUrl} alt={member.name}
            style={{ width: "60px", height: "60px", borderRadius: "50%", objectFit: "cover" }} />
        )}
        <div>
          <h3 style={{ margin: 0 }}>{member.name}</h3>
          <p style={{ margin: 0, color: partyColor }}>{member.partyName}</p>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#888" }}>{chamber}</p>
        </div>
      </div>

      <button onClick={fetchLegislation} style={{ marginTop: "12px", cursor: "pointer" }}>
        {expanded ? "Hide Legislation" : "See Sponsored Bills"}
      </button>

      {loading && <p>Loading...</p>}

      {expanded && bills.length > 0 && (
        <>
          <ul style={{ marginTop: "12px", paddingLeft: "0", listStyle: "none" }}>
            {pagedBills.map((bill, i) => (
              <li key={i} style={{ marginBottom: "12px", borderTop: "1px solid #eee", paddingTop: "10px" }}>
                <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>{bill.title}</div>
                <div style={{ fontSize: "0.8rem", color: "#888", marginTop: "4px" }}>
                  {bill.type} {bill.number} · Introduced {bill.introducedDate}
                  {bill.policyArea && ` · ${bill.policyArea}`}
                </div>
                {bill.latestAction && (
                  <div style={{ fontSize: "0.8rem", color: "#555", marginTop: "4px" }}>
                    {typeof bill.latestAction === "object"
                      ? `${bill.latestAction.actionDate ?? ""} · ${bill.latestAction.text ?? ""}`.replace(/^ · | · $/, "")
                      : bill.latestAction}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ cursor: page === 1 ? "default" : "pointer" }}>
                ← Prev
              </button>
              <span style={{ fontSize: "0.85rem", color: "#666" }}>
                Page {page} of {totalPages}
              </span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ cursor: page === totalPages ? "default" : "pointer" }}>
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {expanded && bills.length === 0 && <p>No sponsored legislation found.</p>}
    </div>
  )
}

function App() {
  const [address, setAddress] = useState("")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function fetchReps() {
    if (!address) return
    setLoading(true)
    setError("")
    setData(null)
    const res = await fetch(`http://localhost:5000/reps?address=${encodeURIComponent(address)}`)
    const json = await res.json()
    if (json.error) { setError(json.error); setLoading(false); return }
    setData(json)
    setLoading(false)
  }

  return (
    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "32px 16px", fontFamily: "sans-serif" }}>
      <h1>How Did Your Rep Vote?</h1>
      <p style={{ color: "#888" }}>Enter your address to find your representatives and their sponsored legislation.</p>

      <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
        <input
          type="text"
          placeholder="350 5th Ave New York, NY 10001"
          value={address}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e => e.key === "Enter" && fetchReps()}
          style={{ flex: 1, padding: "10px", fontSize: "1rem", borderRadius: "6px", border: "1px solid #ccc" }}
        />
        <button onClick={fetchReps} style={{ padding: "10px 16px", cursor: "pointer", borderRadius: "6px" }}>
          Search
        </button>
      </div>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {loading && <p>Looking up your representatives...</p>}

      {data && (
        <div>
          <p style={{ color: "#888" }}>Showing results for <strong>{data.state}</strong>, District <strong>{data.district}</strong></p>
          <h2>Your Representative</h2>
          {data.representative
            ? <MemberCard member={data.representative} chamber="House of Representatives" />
            : <p>No representative found.</p>}
          <h2>Your Senators</h2>
          {data.senators.map(s => <MemberCard key={s.bioguideId} member={s} chamber="Senate" />)}
        </div>
      )}
    </div>
  )
}

export default App