# Recent Votes Experience Design

## Goal

Make the Recent votes panel feel like a voter-facing explainer instead of a raw roll-call feed. For representatives like Hank Johnson, the panel should help a normal voter understand what each recent vote was about, what real-world stakes it touches, and how the member voted, without relying on Gemini or making unsupported ideological claims.

## Architecture

Keep the existing `GET /member/<bioguide_id>/votes` endpoint and deterministic vote ingestion pipeline. The backend already normalizes House and Senate roll-call data, classifies votes as policy or procedural, and assigns issue buckets; it should also own the voter-facing translation.

Each returned vote should include a new `voterContext` object:

- `issue`: issue bucket, using the existing taxonomy when possible.
- `kind`: `policy` or `procedural`.
- `headline`: concise plain-English statement of what the vote was about.
- `positionLabel`: member-facing vote text, such as `Voted Yea` or `Voted Nay`.
- `resultLabel`: chamber result text, normalized when possible.
- `impact`: deterministic “real-world stakes” sentence from issue templates.
- `contextNote`: short caveat for procedural votes or thin/unknown context.

The frontend should render `voterContext` when present and fall back to the current title/meta display when it is missing. This preserves backward compatibility and keeps the UI resilient if an older API response or partial vote object is returned.

## UI Behavior

Recent votes should become “voter-facing vote cards.” Each card should lead with a concrete “What this vote was about” headline derived from the vote description, bill title, or question. The next line should explain real-world stakes in household terms, using deterministic issue templates such as:

- Healthcare: effects on care access, drug costs, hospitals, or public health programs.
- Housing: rent, mortgages, homeowners, zoning, or affordability.
- Immigration and border: asylum, visas, enforcement, deportation, or border policy.
- Defense and foreign policy: service members, veterans, military action, or overseas commitments.
- Budget, taxes, and spending: federal spending, tax rules, debt, or agency funding.
- Education and student loans: schools, colleges, student debt, or education access.
- Energy, climate, and utilities: household energy costs, emissions, public lands, or utility rules.
- Federal agency rules and oversight: consumer protections, regulation, agency authority, or congressional review.

The member’s position should be prominent but not judgmental. Use language like “Hank Johnson voted Yea” or “Hank Johnson voted Nay” rather than “supported good policy” or “opposed bad policy.” Bill number, roll call, date, source, and policy/procedural label should remain visible as secondary metadata.

Policy votes should appear before procedural votes, as the current `policy_snapshot` behavior already does. Procedural votes should remain visible, but their `contextNote` should explain that they usually shape debate, timing, or floor handling rather than directly deciding policy.

## Data Rules

The system must not invent context. If a vote lacks a useful title, bill number, question, or recognized issue, the backend should return a modest fallback such as “This vote has limited public context in the scanned roll-call data.” Unknown or thin context is better than a confident but unsupported explanation.

The design is deterministic and does not use Gemini for Recent votes. The existing Policy profile can continue using Gemini when configured, but Recent votes should stay fast, cheap, and auditable from the vote fields already present.

The existing `interpretation` object can remain for compatibility. `voterContext` should build on it rather than replacing it immediately.

## Error Handling

The existing endpoint error behavior should stay the same. If vote fetching fails, return the current explicit API error. If individual vote context cannot be generated because fields are missing, return the vote with a conservative `voterContext` fallback instead of failing the whole endpoint.

The frontend should not break if `voterContext` is absent. It should continue displaying the current vote title, summary, question, metadata, position, and result.

## Testing

Backend tests should cover deterministic context generation for:

- A healthcare policy vote with a clear bill title.
- A procedural vote, verifying the caveat explains that it is process-oriented.
- An unknown or thin-context vote, verifying the fallback does not overclaim.
- The existing `/member/<bioguide_id>/votes` response, verifying `voterContext` is included alongside existing `interpretation`.

Frontend tests should cover:

- Recent votes render the voter-facing headline, real-world stakes, member position, result, and metadata when `voterContext` is present.
- The UI falls back to the current display when `voterContext` is missing.

E2E coverage should keep using mocked API data and add or update a Recent votes case so the richer card is visible after clicking the Recent votes button.

## Success Criteria

The feature is successful when a Hank Johnson Recent votes panel no longer feels like a raw roll-call list. A voter should be able to scan the cards and understand:

1. What each vote was about.
2. Why that issue could matter in real life.
3. How the member voted.
4. Whether the vote was substantive policy or mostly procedural.
5. Where the data came from.

