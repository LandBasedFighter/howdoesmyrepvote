export function voteSourceUrl(vote) {
  if (!vote || !vote.rollCall) return null
  const roll = String(vote.rollCall)
  const chamber = String(vote.chamber || "").toLowerCase()
  const isSenate = chamber.includes("senate") || vote.source === "senate.gov"
  if (isSenate) {
    const congress = vote.congress
    const session = vote.session
    if (!congress || !session) return null
    const padded = roll.padStart(5, "0")
    return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${padded}.htm`
  }
  const year = String(vote.date || "").slice(0, 4)
  if (!/^\d{4}$/.test(year)) return null
  return `https://clerk.house.gov/Votes/${year}${roll.padStart(3, "0")}`
}
