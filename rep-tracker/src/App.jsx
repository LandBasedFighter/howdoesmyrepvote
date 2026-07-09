import { useEffect, useRef, useState } from "react"

import { voteSourceUrl } from "./votes.js"

const ITEMS_PER_PAGE = 5
const ISSUE_BRIEFING_VOTE_LIMIT = 40
const DEFAULT_API_HOST = typeof window === "undefined" ? "localhost" : window.location.hostname || "localhost"
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? `http://${DEFAULT_API_HOST}:5000`
const SEARCH_MODES = {
  address: {
    label: "address",
    inputLabel: "your address",
    placeholder: "350 5th Ave, New York",
    helper: "we only use your address to identify your district. complete addresses work best.",
  },
  district: {
    label: "district",
    inputLabel: "congressional district",
    placeholder: "NY-12 or New York 12",
    helper: "search directly by district name or code, such as NY-12, New York 12, California 30, or Vermont at-large.",
  },
  representative: {
    label: "representative",
    inputLabel: "representative name",
    placeholder: "Alexandria Ocasio-Cortez",
    helper: "search by a current house member's name if you do not know their district.",
  },
}
const CIVIC_ISSUES = [
  {
    key: "Healthcare",
    label: "healthcare",
    description: "Care access, drug costs, hospitals, public health, and veterans care.",
  },
  {
    key: "Housing & homeownership",
    label: "housing",
    description: "Rent, mortgages, housing supply, zoning, and homeownership costs.",
  },
  {
    key: "Crime & public safety",
    label: "crime & public safety",
    description: "Policing, courts, sentencing, community safety, victims services, and crime prevention.",
  },
  {
    key: "Second Amendment & gun policy",
    label: "second amendment & gun policy",
    description: "Gun rights, firearm rules, background checks, public safety, and lawful ownership.",
  },
  {
    key: "Border security",
    label: "border security",
    description: "Border enforcement, ports of entry, asylum processing, fentanyl interdiction, and security operations.",
  },
  {
    key: "Budget, taxes & government spending",
    label: "taxes & spending",
    description: "Federal spending, revenue, debt, agency funding, and household tax rules.",
  },
  {
    key: "Immigration & border",
    label: "immigration",
    description: "Asylum, visas, enforcement, deportation policy, and border operations.",
  },
  {
    key: "Abortion & reproductive policy",
    label: "abortion & reproductive policy",
    description: "Abortion rules, reproductive healthcare, pregnancy policy, and federal funding restrictions.",
  },
  {
    key: "Election rules",
    label: "election rules",
    description: "Voting access, voter ID, election administration, campaign rules, and ballot security.",
  },
  {
    key: "Free speech & online safety",
    label: "free speech & online safety",
    description: "Speech protections, platform rules, child online safety, censorship concerns, and digital privacy.",
  },
  {
    key: "Energy, climate & utilities",
    label: "energy & climate",
    description: "Energy costs, emissions rules, public lands, and utility policy.",
  },
  {
    key: "Education & student loans",
    label: "education",
    description: "Schools, colleges, student debt, and education access.",
  },
  {
    key: "Defense, veterans & foreign policy",
    label: "veterans & foreign policy",
    description: "Service members, veterans, military action, overseas commitments, and national security spending.",
  },
  {
    key: "Civil rights & social policy",
    label: "civil rights",
    description: "Privacy, discrimination rules, reproductive policy, and religious-liberty disputes.",
  },
]
const FRONT_PAGE_ISSUE_COUNT = 6
const ISSUE_MATCH_ALIASES = {
  "Border security": ["Immigration & border"],
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
  if (bill.introducedDate) parts.push(`introduced ${bill.introducedDate}`)
  if (bill.policyArea) parts.push(bill.policyArea)
  return parts.filter(Boolean)
}

function formatLegislationMeta(bill, official) {
  const parts = []
  if (official) parts.push(officialDisplayName(official))
  if (bill.type && bill.number) parts.push(`${bill.type} ${bill.number}`)
  if (bill.introducedDate) parts.push(`introduced ${formatDateOnly(bill.introducedDate)}`)
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
  return vote.position || "position unavailable"
}

function voteMetadata(vote) {
  const context = vote.voterContext
  const kind = context?.kind || vote.interpretation?.kind
  const bill = vote.bill
  return [
    context?.issue,
    kind ? `${kind[0].toUpperCase()}${kind.slice(1)} vote` : undefined,
    vote.rollCall ? `roll call ${vote.rollCall}` : undefined,
    bill?.type && bill?.number ? `${bill.type} ${bill.number}` : undefined,
  ].filter(Boolean).join(" · ")
}

function voteIssue(vote) {
  return vote.voterContext?.issue || vote.interpretation?.issue || ""
}

function issueMatchKeys(issueKey) {
  return [issueKey, ...(ISSUE_MATCH_ALIASES[issueKey] || [])]
    .map(issue => String(issue || "").trim().toLowerCase())
    .filter(Boolean)
}

function matchingSelectedIssue(vote, selectedIssues) {
  const normalizedVoteIssue = String(voteIssue(vote) || "").trim().toLowerCase()
  return selectedIssues.find(issueKey => issueMatchKeys(issueKey).includes(normalizedVoteIssue)) || ""
}

function prioritizeVotes(votes, selectedIssues) {
  if (!selectedIssues.length) return votes
  return [...votes].sort((left, right) => {
    const leftMatch = matchingSelectedIssue(left, selectedIssues) ? 0 : 1
    const rightMatch = matchingSelectedIssue(right, selectedIssues) ? 0 : 1
    if (leftMatch !== rightMatch) return leftMatch - rightMatch
    return String(right.date || "").localeCompare(String(left.date || ""))
  })
}

function issueLabel(issueKey) {
  return (CIVIC_ISSUES.find(issue => issue.key === issueKey)?.label || issueKey).toLowerCase()
}

function priorityMatchLabel(vote, selectedIssues) {
  const issue = matchingSelectedIssue(vote, selectedIssues)
  if (!issue) return ""
  return `matches your ${issueLabel(issue)} priority`
}

function formattedIssueSelection(issueKeys) {
  const labels = issueKeys.map(issueLabel)
  if (labels.length === 0) return ""
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`
}

function allOfficials(data) {
  if (!data) return []
  return [data.representative, ...(data.senators || [])].filter(Boolean)
}

function officialDisplayName(official) {
  return formatMemberName(official.name)
}

function voteUsefulnessScore(vote) {
  const kind = vote.voterContext?.kind || vote.interpretation?.kind
  const hasContext = Boolean(vote.voterContext?.impact || vote.interpretation?.summary)
  return [
    kind === "policy" ? 0 : 1,
    hasContext ? 0 : 1,
    String(vote.date || ""),
  ]
}

function compareBriefingVotes(left, right) {
  const leftScore = voteUsefulnessScore(left.vote)
  const rightScore = voteUsefulnessScore(right.vote)
  if (leftScore[0] !== rightScore[0]) return leftScore[0] - rightScore[0]
  if (leftScore[1] !== rightScore[1]) return leftScore[1] - rightScore[1]
  return rightScore[2].localeCompare(leftScore[2])
}

function legislationForIssue(issueKey, issueLegislationByMember, officials) {
  const wantKeys = new Set(issueMatchKeys(issueKey))
  const entries = officials.flatMap(official => {
    const byIssue = issueLegislationByMember[official.bioguideId] || {}
    return Object.entries(byIssue)
      .filter(([issueLabel]) => wantKeys.has(String(issueLabel || "").trim().toLowerCase()))
      .flatMap(([, bills]) => (bills || []).map(bill => ({ bill, official })))
  })
  return entries.sort((left, right) => {
    const leftRank = left.bill.role === "sponsored" ? 0 : 1
    const rightRank = right.bill.role === "sponsored" ? 0 : 1
    return leftRank - rightRank
  })
}

function buildIssueBriefingCards(selectedIssues, issueVotesByMember, issueLegislationByMember, officials) {
  return selectedIssues.map(issueKey => {
    const matchKeys = new Set(issueMatchKeys(issueKey))
    const matches = officials.flatMap(official => {
      const votes = issueVotesByMember[official.bioguideId] || []
      return votes
        .filter(vote => matchKeys.has(String(voteIssue(vote) || "").trim().toLowerCase()))
        .map(vote => ({ vote, official }))
    }).sort(compareBriefingVotes)

    const legislation = legislationForIssue(issueKey, issueLegislationByMember, officials)

    return {
      issueKey,
      label: issueLabel(issueKey),
      matches,
      topMatch: matches[0],
      legislation,
      topLegislation: legislation[0],
    }
  })
}

function matchCountLabel(count) {
  if (count === 1) return "1 matching recent vote"
  return `${count} matching recent votes`
}

function briefingRequestKey(officials) {
  return officials.map(official => official.bioguideId).join("|")
}

function issueExample(issue) {
  const vote = issue.evidence?.[0]
  if (!vote) return ""
  const title = vote.description || vote.bill?.title || vote.question
  if (!title) return ""
  return `${vote.position || "voted"} on ${title}`
}

function profileSummaryNote(profile) {
  const policyCount = profile.policyVoteCount ?? 0
  const scannedCount = profile.scannedVoteCount ?? 0
  if (profile.aiSummary?.provider === "gemini") {
    return `ai-generated summary based on ${policyCount} substantive policy votes from ${scannedCount} recent roll calls. review the evidence below.`
  }
  return `based on ${policyCount} substantive policy votes from ${scannedCount} recent roll calls. ai summary is unavailable.`
}

function sourceLabel(type, items) {
  if (type === "profile") return "source: recent House & Senate roll-call votes"
  if (type === "legislation") return "source: Congress.gov"
  if (items.some(item => item.source === "senate.gov")) return "source: Senate.gov roll call XML"
  return "source: Congress.gov house roll call data"
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
    <section className="results-section results-skeleton" aria-live="polite" aria-label="loading representatives">
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

function positionTone(vote) {
  const label = String(vote.position || vote.voterContext?.positionLabel || "").toLowerCase()
  if (/(yea|aye|\byes\b)/.test(label)) return "yea"
  if (/(nay|\bno\b)/.test(label)) return "nay"
  return "neutral"
}

function resultTone(result) {
  const label = String(result || "").toLowerCase()
  if (/(pass|agreed|adopted|confirmed)/.test(label)) return "pass"
  if (/(fail|reject|not agreed|defeat)/.test(label)) return "fail"
  return "neutral"
}

function ClampText({ text, className }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return null
  if (text.length <= 200) return <p className={className}>{text}</p>
  return (
    <div className={className}>
      <p className={expanded ? "clamp-body" : "clamp-body clamp-3"}>{text}</p>
      <button type="button" className="read-more-btn" onClick={() => setExpanded(value => !value)}>
        {expanded ? "read less" : "read more"}
      </button>
    </div>
  )
}

function VoteCard({ vote, displayName, selectedIssues }) {
  const context = vote.voterContext
  const metadata = voteMetadata(vote)
  const headline = context?.headline || vote.description || "Vote details unavailable"
  const impact = context?.impact || vote.interpretation?.summary
  const result = context?.resultLabel || vote.result
  const priorityLabel = priorityMatchLabel(vote, selectedIssues)
  const sourceUrl = voteSourceUrl(vote)

  return (
    <li className={`detail-item vote-card ${context ? "vote-card-contextual" : ""}`}>
      <div className="detail-title">{headline}</div>
      {priorityLabel && <div className="priority-match-badge">{priorityLabel}</div>}
      {impact && <ClampText className="vote-impact" text={impact} />}
      {context?.contextNote && <div className="vote-context-note">{context.contextNote}</div>}
      {!context && vote.question && vote.question !== vote.description && (
        <div className="vote-question">{vote.question}</div>
      )}
      <div className="vote-row vote-row-prominent">
        <span className={`vote-position tone-${positionTone(vote)}`}>{displayVotePosition(displayName, vote)}</span>
        {result && <span className={`vote-result tone-${resultTone(result)}`}>{result}</span>}
      </div>
      {metadata && <div className="vote-metadata-line">{metadata}</div>}
      <div className="detail-meta">
        {formatVoteMeta(vote).map(part => <span key={part}>{part}</span>)}
      </div>
      {sourceUrl && (
        <a
          className="vote-source-link"
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          view official roll call
          <span aria-hidden="true"> ↗</span>
        </a>
      )}
    </li>
  )
}

function IssueBriefing({ selectedIssues, officials, issueVotesByMember, issueLegislationByMember, loading, error, requestKey, dataKey }) {
  if (!selectedIssues.length || !officials.length) return null
  if (dataKey !== requestKey) return null
  if (loading && Object.keys(issueVotesByMember).length === 0) return null

  const cards = buildIssueBriefingCards(selectedIssues, issueVotesByMember, issueLegislationByMember || {}, officials)

  return (
    <section className="issue-briefing" aria-label="your issue briefing">
      <div className="issue-briefing-header">
        <div>
          <h2>your issue briefing</h2>
          <p>recent floor votes, with bills they've backed when there's no recent vote.</p>
        </div>
        {loading && <span className="issue-briefing-status">checking recent votes</span>}
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="issue-briefing-grid">
        {cards.map(card => {
          const topMatch = card.topMatch
          const vote = topMatch?.vote
          const official = topMatch?.official
          const headline = vote?.voterContext?.headline || vote?.description || "Vote details unavailable"
          const impact = vote?.voterContext?.impact || vote?.interpretation?.summary

          const legislation = card.topLegislation
          const legBill = legislation?.bill
          const legOfficial = legislation?.official

          let countLabel = matchCountLabel(card.matches.length)
          if (!topMatch && legBill) {
            countLabel = card.legislation.length === 1 ? "1 bill they've backed" : `${card.legislation.length} bills they've backed`
          }

          return (
            <article key={card.issueKey} className="issue-briefing-card">
              <div className="issue-briefing-card-header">
                <h3>{card.label}</h3>
                <span>{countLabel}</span>
              </div>
              {topMatch ? (
                <>
                  <div className="detail-title">{headline}</div>
                  {impact && <ClampText className="vote-impact" text={impact} />}
                  <div className="vote-row vote-row-prominent">
                    <span className={`vote-position tone-${positionTone(vote)}`}>{displayVotePosition(officialDisplayName(official), vote)}</span>
                    {vote.result && <span className={`vote-result tone-${resultTone(vote.voterContext?.resultLabel || vote.result)}`}>{vote.voterContext?.resultLabel || vote.result}</span>}
                  </div>
                  <div className="detail-meta">
                    {formatVoteMeta(vote).map(part => <span key={part}>{part}</span>)}
                  </div>
                </>
              ) : legBill ? (
                <>
                  <span className={`vote-kind vote-kind-${legBill.role === "sponsored" ? "policy" : "procedural"}`}>
                    {legBill.role === "sponsored" ? "sponsored bill" : "cosponsored bill"}
                  </span>
                  <div className="detail-title">{legBill.title}</div>
                  <p className="vote-impact">no recent floor vote here, but {officialDisplayName(legOfficial)} has backed a bill on this issue.</p>
                  <div className="detail-meta">
                    {formatLegislationMeta(legBill, legOfficial).map(part => <span key={part}>{part}</span>)}
                  </div>
                </>
              ) : (
                <p className="issue-briefing-empty">no recent floor vote or backed bill on this issue yet. try the policy profile for a fuller picture.</p>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function MemberCard({ member, selectedIssues }) {
  const [bills, setBills] = useState([])
  const [votes, setVotes] = useState([])
  const [profile, setProfile] = useState(null)
  const [loadingType, setLoadingType] = useState("")
  const [expandedType, setExpandedType] = useState("")
  const [memberError, setMemberError] = useState("")
  const [detailsNote, setDetailsNote] = useState("")
  const [showSkeleton, setShowSkeleton] = useState(false)
  const skeletonTimer = useRef(null)

  useEffect(() => () => clearTimeout(skeletonTimer.current), [])

  async function fetchMemberDetails(type) {
    if (expandedType === type) {
      setExpandedType("")
      return
    }

    setLoadingType(type)
    setMemberError("")
    setDetailsNote("")
    setShowSkeleton(false)
    clearTimeout(skeletonTimer.current)
    skeletonTimer.current = setTimeout(() => setShowSkeleton(true), 240)
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
      setMemberError("We couldn't load this member's details. Please try again in a moment.")
    } finally {
      clearTimeout(skeletonTimer.current)
      setShowSkeleton(false)
      setLoadingType("")
    }
  }

  const expandedItems = expandedType === "votes" ? prioritizeVotes(votes, selectedIssues) : bills
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
          <LoadingButtonContent loading={loadingType === "profile"} loadingText="building profile">
            {expandedType === "profile" ? "hide profile" : "policy profile"}
          </LoadingButtonContent>
        </button>
        <button className="secondary-button" onClick={() => fetchMemberDetails("votes")} disabled={Boolean(loadingType)}>
          <LoadingButtonContent loading={loadingType === "votes"} loadingText="loading votes">
            {expandedType === "votes" ? "hide votes" : "recent votes"}
          </LoadingButtonContent>
        </button>
        <button className="secondary-button" onClick={() => fetchMemberDetails("legislation")} disabled={Boolean(loadingType)}>
          <LoadingButtonContent loading={loadingType === "legislation"} loadingText="loading bills">
            {expandedType === "legislation" ? "hide bills" : "sponsored bills"}
          </LoadingButtonContent>
        </button>
      </div>

      {memberError && <p className="inline-error">{memberError}</p>}
      {detailsNote && expandedType === "votes" && <p className="detail-note">{detailsNote}</p>}
      {loadingType && showSkeleton && <DetailSkeletonList label={`Loading ${loadingType}`} />}

      {!loadingType && expandedType === "profile" && profile && (
        <div className="details-panel">
          {profile.aiSummary && (
            <div className="ai-summary-card">
              <div className="ai-summary-label">
                {profile.aiSummary.provider === "gemini" ? "policy flash analysis" : "policy analysis unavailable"}
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
            <p className="empty-state">not enough recent policy votes to build a profile yet.</p>
          )}
          {profile.notableVotes.length > 0 && (
            <>
              <div className="section-label">evidence votes</div>
              <ul className="detail-list">
                {profile.notableVotes.map((vote, i) => (
                  <li key={`${vote.rollCall}-${vote.date}-${i}`} className="detail-item">
                    <span className="vote-kind vote-kind-policy">policy vote</span>
                    <div className="detail-title">{vote.description || "Vote details unavailable"}</div>
                    <div className="detail-meta">
                      {formatVoteMeta(vote).map(part => <span key={part}>{part}</span>)}
                    </div>
                    <div className="vote-row">
                      <span className="vote-position">{vote.position || "position unavailable"}</span>
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
                <VoteCard key={`${vote.rollCall}-${vote.date}-${i}`} vote={vote} displayName={displayName} selectedIssues={selectedIssues} />
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
        <p className="empty-state">no {expandedType === "votes" ? "recent votes" : "sponsored legislation"} found.</p>
      )}
    </article>
  )
}

function App() {
  const [searchMode, setSearchMode] = useState("address")
  const [searchText, setSearchText] = useState("")
  const [selectedIssues, setSelectedIssues] = useState([])
  const [showMoreIssues, setShowMoreIssues] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [slowLoad, setSlowLoad] = useState(false)
  const [error, setError] = useState("")
  const [issueVotesByMember, setIssueVotesByMember] = useState({})
  const [issueLegislationByMember, setIssueLegislationByMember] = useState({})
  const [issueBriefingLoading, setIssueBriefingLoading] = useState(false)
  const [issueBriefingError, setIssueBriefingError] = useState("")
  const [issueBriefingDataKey, setIssueBriefingDataKey] = useState("")
  const [representativeOptions, setRepresentativeOptions] = useState([])
  const lookupSectionRef = useRef(null)
  const mode = SEARCH_MODES[searchMode]
  const districtMatches = searchMode === "district" ? districtSuggestions(searchText) : []
  const representativeMatches = searchMode === "representative" ? representativeSuggestions(searchText, representativeOptions) : []
  const visibleIssues = showMoreIssues ? CIVIC_ISSUES : CIVIC_ISSUES.slice(0, FRONT_PAGE_ISSUE_COUNT)
  const officials = allOfficials(data)
  const issueBriefingRequestKey = briefingRequestKey(officials)

  useEffect(() => {
    if (representativeOptions.length > 0) return

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
  }, [representativeOptions.length])

  useEffect(() => {
    const currentOfficials = allOfficials(data)
    const currentRequestKey = briefingRequestKey(currentOfficials)

    if (!selectedIssues.length || !currentOfficials.length) {
      return
    }

    let cancelled = false
    async function loadIssueBriefingVotes() {
      setIssueBriefingLoading(true)
      setIssueBriefingError("")
      setIssueLegislationByMember({})
      try {
        const results = await Promise.allSettled(currentOfficials.map(async official => {
          const res = await fetch(`${API_BASE_URL}/member/${official.bioguideId}/votes?context=briefing&limit=${ISSUE_BRIEFING_VOTE_LIMIT}`)
          const json = await res.json()
          if (json.error) throw new Error(json.error)
          return [official.bioguideId, json.votes || []]
        }))
        if (!cancelled) {
          const successfulEntries = results
            .filter(result => result.status === "fulfilled")
            .map(result => result.value)
          const failedCount = results.length - successfulEntries.length
          setIssueVotesByMember(Object.fromEntries(successfulEntries))
          setIssueBriefingDataKey(currentRequestKey)
          if (failedCount > 0) {
            setIssueBriefingError(
              successfulEntries.length
                ? "some officials could not be loaded for this briefing."
                : "we couldn't load your issue briefing. please try again in a moment."
            )
          }
        }
      } catch {
        if (!cancelled) {
          setIssueVotesByMember({})
          setIssueBriefingDataKey(currentRequestKey)
          setIssueBriefingError("we couldn't load your issue briefing. please try again in a moment.")
        }
      } finally {
        if (!cancelled) setIssueBriefingLoading(false)
      }

      // Sponsored/cosponsored legislation is a secondary signal used to fill in
      // issues that have no recent floor vote. Load it after votes so it never
      // blocks the primary briefing, and fail silently if it is unavailable.
      try {
        const legResults = await Promise.allSettled(currentOfficials.map(async official => {
          const res = await fetch(`${API_BASE_URL}/member/${official.bioguideId}/issue-legislation`)
          const json = await res.json()
          if (json.error) throw new Error(json.error)
          return [official.bioguideId, json.legislationByIssue || {}]
        }))
        if (!cancelled) {
          const legEntries = legResults
            .filter(result => result.status === "fulfilled")
            .map(result => result.value)
          setIssueLegislationByMember(Object.fromEntries(legEntries))
        }
      } catch {
        if (!cancelled) setIssueLegislationByMember({})
      }
    }

    loadIssueBriefingVotes()

    return () => {
      cancelled = true
    }
  }, [selectedIssues, data])

  useEffect(() => {
    if (!loading && !data) return
    if (typeof lookupSectionRef.current?.scrollIntoView === "function") {
      lookupSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [data, loading])

  useEffect(() => {
    if (!loading) return
    // Render's free tier can take ~50s to cold-start. After a few seconds of
    // waiting, reassure the user the request isn't stuck rather than failing.
    const timer = setTimeout(() => setSlowLoad(true), 7000)
    return () => {
      clearTimeout(timer)
      setSlowLoad(false)
    }
  }, [loading])

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
      setError("We couldn't reach the server. Please check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  async function fetchRepsByCoordinates(latitude, longitude) {
    setLoading(true)
    setError("")
    setData(null)
    try {
      // Send coordinates in the POST body, matching the address flow, so precise
      // location never lands in a query string or normal request log.
      const res = await fetch(`${API_BASE_URL}/reps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: latitude, lon: longitude }),
      })
      const json = await res.json()
      if (json.error) {
        setError(json.error)
        return
      }
      setData(json)
    } catch {
      setError("We couldn't reach the server. Please check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  function requestMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Your browser can't share your location. Try searching by address instead.")
      return
    }
    setError("")
    setData(null)
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocating(false)
        fetchRepsByCoordinates(position.coords.latitude, position.coords.longitude)
      },
      geolocationError => {
        setLocating(false)
        setError(
          geolocationError.code === geolocationError.PERMISSION_DENIED
            ? "Location access was blocked. You can search by address instead."
            : "We couldn't get your location. Try searching by address."
        )
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    )
  }

  function updateSearchText(value) {
    setSearchText(value)
    if (searchMode !== "representative" || loading) return
    const selectedRepresentative = representativeOptions.find(option => option.label === value)
    if (selectedRepresentative) {
      fetchReps(value, "representative")
    }
  }

  function toggleIssue(issueKey) {
    setSelectedIssues(current => (
      current.includes(issueKey)
        ? current.filter(selectedIssue => selectedIssue !== issueKey)
        : [...current, issueKey]
    ))
  }

  return (
    <>
      <main className="app-shell">
      <section className="hero">
        <div>
          <h1>find your representatives and how they vote.</h1>
          <p className="hero-copy">
            enter a street address or congressional district to find your house member, senators, recent votes, and sponsored legislation.
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
                search
              </LoadingButtonContent>
            </button>
          </div>
          {searchMode === "address" && (
            <button
              type="button"
              className="location-button"
              onClick={requestMyLocation}
              disabled={loading || locating}
            >
              <LoadingButtonContent loading={locating} loadingText="finding you">
                use my location
              </LoadingButtonContent>
            </button>
          )}
          <p className="helper-text">{mode.helper}</p>
          <div className="issue-priority-panel" aria-label="Voter issue priorities">
            <div>
              <h2>choose what matters to you</h2>
              <p>pick issues so the briefing can put the most relevant votes first.</p>
            </div>
            <div className="issue-chip-grid">
              {visibleIssues.map(issue => (
                <button
                  key={issue.key}
                  type="button"
                  className={`issue-chip ${selectedIssues.includes(issue.key) ? "selected" : ""}`}
                  aria-pressed={selectedIssues.includes(issue.key)}
                  onClick={() => toggleIssue(issue.key)}
                  title={issue.description}
                >
                  {issue.label}
                </button>
              ))}
              <button
                type="button"
                className="issue-chip issue-chip-more"
                aria-expanded={showMoreIssues}
                onClick={() => setShowMoreIssues(current => !current)}
              >
                {showMoreIssues ? "fewer issues" : "more issues"}
              </button>
            </div>
            {selectedIssues.length > 0 && (
              <p className="selected-issues-note">
                your briefing will prioritize {formattedIssueSelection(selectedIssues)}.
              </p>
            )}
            <p className="missing-issue-note">
              <span>think an issue is missing?</span>{" "}
              <a href="mailto:moguinyard@gmail.com?subject=Issue%20suggestion%20for%20How%20Did%20Your%20Rep%20Vote">
                suggest one
              </a>
            </p>
          </div>
        </div>
      </section>

      <div ref={lookupSectionRef} className="lookup-section-anchor">
        {error && <p className="status-message error">{error}</p>}
        {loading && slowLoad && (
          <p className="loading-hint" role="status">
            the server is waking up. it runs on a free tier and naps when nobody's around (i can't
            pay for 24/7 cpu). first load can take up to a minute. hang tight…
          </p>
        )}
        {loading && <ResultsSkeleton />}

        {data && (
          <section className="results-section">
            <div className="results-header">
              <div className="district-summary">
                <h2>{data.districtLabel ?? `${data.state}-${data.district}`}</h2>
                {data.districtDescription && <p className="district-description">{data.districtDescription}</p>}
              </div>
            </div>

            <IssueBriefing
              selectedIssues={selectedIssues}
              officials={officials}
              issueVotesByMember={issueVotesByMember}
              issueLegislationByMember={issueLegislationByMember}
              loading={issueBriefingLoading}
              error={issueBriefingError}
              requestKey={issueBriefingRequestKey}
              dataKey={issueBriefingDataKey}
            />

            <div className="member-grid">
              <div className="result-group">
                <h2>your representative</h2>
                {data.representative
                  ? <MemberCard member={data.representative} selectedIssues={selectedIssues} />
                  : <p className="empty-state">no representative found.</p>}
              </div>

              <div className="result-group">
                <h2>your senators</h2>
                {data.senators.map(s => <MemberCard key={s.bioguideId} member={s} selectedIssues={selectedIssues} />)}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>

      <footer className="site-footer">
        <div className="footer-brand">
          <span>© 2026 morgan guinyard</span>
          <div className="footer-link-groups">
            <div className="footer-link-group">
              <span>pls pls pls</span>
              <nav aria-label="civic links">
                <a href="https://vote.gov">register to vote</a>
                <a href="https://www.nass.org/can-I-vote">check registration</a>
                <a href="https://www.vote411.org/ballot">find your next election</a>
              </nav>
            </div>
            <div className="footer-link-group">
              <span>contact</span>
              <nav aria-label="morgan guinyard links">
                <a href="mailto:moguinyard@gmail.com">email</a>
                <a href="https://github.com/LandBasedFighter">github</a>
                <a href="https://www.linkedin.com/in/morgan-guinyard-6304a1284/">linkedin</a>
              </nav>
            </div>
          </div>
        </div>
        <div className="footer-powered-by">
          <span>powered by:</span>
          <nav aria-label="data services">
            <a href="https://www.congress.gov">Congress.gov</a>
            <a href="https://geocoding.geo.census.gov">Census Geocoder</a>
            <a href="https://www.senate.gov">Senate.gov</a>
            <a href="https://www.wikipedia.org">Wikipedia</a>
            <a href="https://ai.google.dev">Google Gemini</a>
          </nav>
        </div>
      </footer>
    </>
  )
}

export default App