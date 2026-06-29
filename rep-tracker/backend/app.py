from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from threading import Lock
from time import monotonic
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
import json
import os
import re

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests

load_dotenv()

BASE_URL = "https://api.congress.gov/v3"
CACHE_TTL_SECONDS = int(os.getenv("CACHE_TTL_SECONDS", "900"))
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "10"))
MAX_LEGISLATION = 5
MAX_VOTES = 10
HOUSE_VOTE_SCAN_LIMIT = int(os.getenv("HOUSE_VOTE_SCAN_LIMIT", "30"))
HOUSE_VOTE_WORKERS = int(os.getenv("HOUSE_VOTE_WORKERS", "6"))
HOUSE_VOTE_SESSIONS = [
    tuple(int(part) for part in session.strip().split(":", 1))
    for session in os.getenv("HOUSE_VOTE_SESSIONS", "119:2").split(",")
    if session.strip()
]
SENATE_BASE_URL = "https://www.senate.gov/legislative/LIS"
SENATE_VOTE_SCAN_LIMIT = int(os.getenv("SENATE_VOTE_SCAN_LIMIT", "30"))
SENATE_VOTE_SESSIONS = [
    tuple(int(part) for part in session.strip().split(":", 1))
    for session in os.getenv("SENATE_VOTE_SESSIONS", "119:2").split(",")
    if session.strip()
]
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/{model}:generateContent"
STANCE_EVIDENCE_LIMIT = int(os.getenv("STANCE_EVIDENCE_LIMIT", "20"))

CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]

app = Flask(__name__)
CORS(app, origins=CORS_ORIGINS)

_session = requests.Session()
_cache = {}
_cache_lock = Lock()


def get_api_key():
    api_key = os.getenv("CONGRESS_CIVIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("CONGRESS_CIVIC_API_KEY environment variable is not set")
    return api_key


def get_gemini_api_key():
    return os.getenv("GEMINI_API_KEY", "").strip()


def cached(cache_key, fetcher, ttl=CACHE_TTL_SECONDS):
    now = monotonic()
    with _cache_lock:
        entry = _cache.get(cache_key)
        if entry and entry["expires_at"] > now:
            return entry["value"]

    value = fetcher()
    if not (isinstance(value, dict) and value.get("error")):
        with _cache_lock:
            _cache[cache_key] = {"value": value, "expires_at": now + ttl}
    return value


def clear_cache():
    with _cache_lock:
        _cache.clear()


def congress_get(endpoint_or_url, **params):
    params["api_key"] = get_api_key()
    url = endpoint_or_url if endpoint_or_url.startswith("http") else f"{BASE_URL}/{endpoint_or_url}"
    try:
        res = _session.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
        if res.status_code >= 400:
            return {
                "error": congress_error_message(res) or f"Congress.gov API request failed: {res.status_code}",
                "statusCode": res.status_code,
            }
        try:
            return res.json()
        except ValueError:
            return {"error": "Congress.gov API returned a non-JSON response", "statusCode": 502}
    except requests.exceptions.RequestException as error:
        return {"error": "Congress.gov API request failed", "statusCode": 502}


def congress_error_message(response):
    try:
        error_payload = response.json().get("error", {})
    except ValueError:
        return None
    if isinstance(error_payload, str):
        return error_payload
    if not isinstance(error_payload, dict):
        return None
    code = error_payload.get("code")
    message = error_payload.get("message")
    if code and message:
        return f"{code}: {message}"
    return message or code


def fetch_xml(url):
    try:
        res = _session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
        if res.status_code >= 400:
            return {"error": f"Request failed: {res.status_code}", "statusCode": res.status_code}
        return {"xml": ET.fromstring(res.content)}
    except ET.ParseError:
        return {"error": "XML response could not be parsed", "statusCode": 502}
    except requests.exceptions.RequestException:
        return {"error": "XML request failed", "statusCode": 502}


def xml_text(node, path, default=None):
    found = node.find(path)
    if found is None or found.text is None:
        return default
    return " ".join(found.text.split())


def gemini_generate_json(prompt):
    api_key = get_gemini_api_key()
    if not api_key:
        return None

    model_path = GEMINI_MODEL if GEMINI_MODEL.startswith("models/") else f"models/{GEMINI_MODEL}"
    url = GEMINI_API_URL.format(model=model_path)
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
        },
    }
    try:
        res = _session.post(
            url,
            params={"key": api_key},
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        if res.status_code >= 400:
            return None
        data = res.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
    except (KeyError, IndexError, TypeError, ValueError, requests.exceptions.RequestException):
        return None


def congress_state_members(state_code):
    def fetch_members():
        state_members = []
        offset = 0
        while True:
            data = congress_get(f"member/{state_code}", currentMember=True, limit=250, offset=offset)
            if data.get("error"):
                raise RuntimeError(data["error"])
            state_members.extend(data.get("members", []))
            if not data.get("pagination", {}).get("next"):
                break
            offset += 250
        return state_members

    return cached(("state-members", state_code), fetch_members)


def member_profile(bioguide_id):
    def fetch_profile():
        data = congress_get(f"member/{bioguide_id}")
        if data.get("error"):
            return data
        return data.get("member", {})

    return cached(("member-profile", bioguide_id), fetch_profile)


def geocode_address(address):
    normalized_address = address.strip()

    def fetch_geocode():
        res = _session.get(
            "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
            params={
                "address": normalized_address,
                "benchmark": "Public_AR_Current",
                "vintage": "Current_Current",
                "layers": "54",
                "format": "json",
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        res.raise_for_status()
        try:
            match = res.json()["result"]["addressMatches"][0]
            state = match["addressComponents"]["state"]
            geos = match["geographies"]
            cd_key = next(k for k in geos if "Congressional Districts" in k)
            district = geos[cd_key][0]["BASENAME"]
            return state, district
        except (IndexError, KeyError, StopIteration):
            return None, None

    return cached(("geocode", normalized_address.casefold()), fetch_geocode)


def last_chamber(member):
    return current_term(member).get("chamber", "")


def current_term(member):
    terms = member.get("terms", {})
    if isinstance(terms, dict):
        items = terms.get("item", [])
    elif isinstance(terms, list):
        items = terms
    else:
        items = []
    if isinstance(items, dict):
        items = [items]
    return items[-1] if items else {}


def member_state_code(member):
    term_state = current_term(member).get("stateCode")
    if term_state:
        return term_state
    state = member.get("state")
    return state if isinstance(state, str) and len(state) == 2 else None


def normalize_name_key(value):
    return "".join(ch.lower() for ch in (value or "") if ch.isalnum())


def senate_member_key(member):
    return (normalize_name_key(member.get("lastName")), member_state_code(member))


def normalize_policy_area(policy_area):
    if isinstance(policy_area, dict):
        return policy_area.get("name")
    return policy_area


def normalize_legislation(item):
    return {
        **item,
        "policyArea": normalize_policy_area(item.get("policyArea")),
        "title": item.get("title") or item.get("latestTitle") or item.get("title"),
    }


def normalize_vote(item):
    bill = item.get("bill") or {}
    return {
        "bill": bill,
        "chamber": item.get("chamber"),
        "congress": item.get("congress"),
        "date": item.get("date") or item.get("voteDate"),
        "description": item.get("description") or item.get("question") or bill.get("title"),
        "position": item.get("position") or item.get("vote") or item.get("castCode"),
        "result": item.get("result"),
        "rollCall": item.get("rollCall") or item.get("rollNumber") or item.get("voteNumber"),
        "session": item.get("session"),
        "type": item.get("type"),
    }


HARD_PROCEDURAL_TERMS = (
    "cloture",
    "motion to proceed",
    "motion to recommit",
    "ordering the previous question",
    "agreeing to the resolution",
    "table",
)

POLICY_TERMS = (
    "appropriations", "budget", "tax", "medicaid", "medicare", "health", "immigration",
    "border", "defense", "armed forces", "war powers", "housing", "education", "student loan",
    "energy", "environment", "iran", "ukraine", "farm", "transportation", "judg",
)

ISSUE_TAXONOMY = {
    "Cost of living & consumer rules": (
        "affordability", "consumer", "credit", "fee", "price", "cost", "home appliance", "appliance",
    ),
    "Energy, climate & utilities": (
        "energy", "environment", "emission", "climate", "utility", "pipeline", "public lands",
    ),
    "Defense, veterans & foreign policy": (
        "defense", "armed forces", "war powers", "iran", "ukraine", "hostilities", "veteran",
        "military", "ambassador", "foreign", "state department",
    ),
    "Housing & homeownership": ("housing", "homeownership", "homeowner", "mortgage", "rent", "zoning"),
    "Healthcare": ("health", "medicaid", "medicare", "drug", "hospital", "veterans health", "care"),
    "Immigration & border": ("immigration", "border", "asylum", "deport", "visa", "alien"),
    "Budget, taxes & government spending": (
        "appropriations", "budget", "tax", "spending", "debt", "revenue", "fiscal", "deficit",
    ),
    "Education & student loans": ("education", "student loan", "school", "college", "university"),
    "Federal courts & nominations": (
        "judge", "judg", "nomination", "confirmed", "circuit judge", "district judge", "pn ",
    ),
    "Federal agency rules & oversight": (
        "agency", "regulation", "information quality", "oversight", "rule submitted", "disapprove",
        "congressional review", "s.j.res.", "h.j.res.",
    ),
    "Civil rights & social policy": ("civil rights", "discrimination", "privacy", "abortion", "religious"),
}

LOW_INFORMATION_ISSUES = {"Federal courts & nominations"}


def bill_text(vote):
    bill = vote.get("bill") or {}
    return " ".join(str(value or "") for value in [bill.get("title"), bill.get("type"), bill.get("number")]).lower()


def question_text(vote):
    return " ".join(str(value or "") for value in [vote.get("question"), vote.get("type")]).lower()


def vote_text(vote):
    bill = vote.get("bill") or {}
    return " ".join(
        str(value or "")
        for value in [
            vote.get("description"),
            vote.get("question"),
            vote.get("type"),
            vote.get("result"),
            bill.get("title"),
            bill.get("type"),
        ]
    ).lower()


def classify_issue(vote):
    text = vote_text(vote)
    bill = vote.get("bill") or {}
    bill_type = str(bill.get("type") or "").lower()
    if bill_type in {"pn", "nomination"} or "confirmation:" in text:
        return "Federal courts & nominations"
    for issue, terms in ISSUE_TAXONOMY.items():
        if any(term in text for term in terms):
            return issue
    return "Other recent policy"


def vote_kind(vote):
    bill = vote.get("bill") or {}
    bill_type = str(bill.get("type") or "").lower()
    title_text = bill_text(vote)
    question = question_text(vote)
    text = vote_text(vote)

    if (
        "motion to recommit" in question
        or "ordering the previous question" in question
        or "motion to proceed" in question
        or "cloture" in question
    ):
        return "procedural"
    if "agreeing to the resolution" in question and bill_type in {"hres", "sres", "h.res.", "s.res."}:
        return "procedural"
    if "rule" in title_text and bill_type in {"hres", "h.res."}:
        return "procedural"

    if any(term in title_text for term in POLICY_TERMS):
        return "policy"
    if bill_type in {"hr", "s", "hjres", "sjres", "hconres", "sconres", "h.r.", "s.", "s.j.res.", "h.j.res."}:
        return "policy"
    if any(term in question for term in HARD_PROCEDURAL_TERMS):
        return "procedural"
    if any(term in text for term in POLICY_TERMS):
        return "policy"
    return "policy" if (vote.get("bill") or {}).get("title") else "procedural"


def interpret_vote(vote):
    kind = vote_kind(vote)
    bill = vote.get("bill") or {}
    title = vote.get("description") or bill.get("title") or vote.get("question")
    if kind == "procedural":
        summary = "Procedural vote that shaped debate, timing, or floor handling rather than directly deciding policy."
    else:
        issue = classify_issue(vote)
        issue_text = "policy" if issue == "Other recent policy" else issue.lower()
        summary = f"Substantive {issue_text} vote related to {title}."
    return {
        "issue": classify_issue(vote) if kind == "policy" else "Procedure",
        "kind": kind,
        "priority": 0 if kind == "policy" else 1,
        "summary": summary,
    }


def enrich_vote(vote):
    return {**vote, "interpretation": interpret_vote(vote)}


def policy_snapshot(votes, limit):
    enriched = [enrich_vote(vote) for vote in votes]
    recent_first = sorted(enriched, key=lambda vote: vote.get("date") or "", reverse=True)
    return sorted(recent_first, key=lambda vote: vote["interpretation"]["priority"])[:limit]


def stance_from_position(position):
    normalized = (position or "").strip().lower()
    if normalized in {"yea", "aye", "yes"}:
        return "supported"
    if normalized in {"nay", "no"}:
        return "opposed"
    return "no_position"


API_BILL_TYPE_MAP = {
    "hr": "hr",
    "h.r.": "hr",
    "house bill": "hr",
    "s": "s",
    "s.": "s",
    "senate bill": "s",
    "hjres": "hjres",
    "h.j.res.": "hjres",
    "house joint resolution": "hjres",
    "sjres": "sjres",
    "s.j.res.": "sjres",
    "senate joint resolution": "sjres",
    "hconres": "hconres",
    "h.con.res.": "hconres",
    "house concurrent resolution": "hconres",
    "sconres": "sconres",
    "s.con.res.": "sconres",
    "senate concurrent resolution": "sconres",
    "hres": "hres",
    "h.res.": "hres",
    "house resolution": "hres",
    "sres": "sres",
    "s.res.": "sres",
    "senate resolution": "sres",
}


def api_bill_type(value):
    return API_BILL_TYPE_MAP.get(str(value or "").strip().casefold())


def plain_text_summary(value, limit=300):
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", str(value))
    text = " ".join(unescape(text).split())
    if not text:
        return None
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."


def vote_bill_summary(vote):
    bill = vote.get("bill") or {}
    congress = vote.get("congress")
    bill_type = api_bill_type(bill.get("type"))
    bill_number = bill.get("number")
    if not congress or not bill_type or not bill_number:
        return None

    def fetch_summary():
        data = congress_get(f"bill/{congress}/{bill_type}/{bill_number}/summaries")
        if data.get("error"):
            return None
        summaries = data.get("summaries") or []
        if not summaries:
            return None
        return plain_text_summary(summaries[0].get("text"))

    return cached(("bill-summary", congress, bill_type, str(bill_number)), fetch_summary)


def compact_vote_evidence(votes, limit=STANCE_EVIDENCE_LIMIT):
    selected_votes = votes[:limit]
    summaries = {}
    with ThreadPoolExecutor(max_workers=max(1, min(HOUSE_VOTE_WORKERS, len(selected_votes) or 1))) as executor:
        future_map = {executor.submit(vote_bill_summary, vote): index for index, vote in enumerate(selected_votes)}
        for future in as_completed(future_map):
            summaries[future_map[future]] = future.result()

    compact = []
    for index, vote in enumerate(selected_votes):
        bill = vote.get("bill") or {}
        compact.append({
            "bill": f"{bill.get('type') or ''} {bill.get('number') or ''}".strip(),
            "issue": vote.get("interpretation", {}).get("issue"),
            "position": vote.get("position"),
            "question": vote.get("question"),
            "result": vote.get("result"),
            "summary": summaries.get(index),
            "title": vote.get("description") or bill.get("title"),
        })
    return compact


def diversified_policy_votes(policy_votes, limit, per_issue_limit=4):
    diversified = []
    issue_counts = {}
    for vote in policy_snapshot(policy_votes, len(policy_votes)):
        issue = vote.get("interpretation", {}).get("issue")
        issue_limit = 2 if issue in LOW_INFORMATION_ISSUES else per_issue_limit
        if issue_counts.get(issue, 0) >= issue_limit:
            continue
        diversified.append(vote)
        issue_counts[issue] = issue_counts.get(issue, 0) + 1
        if len(diversified) >= limit:
            break
    return diversified


def unavailable_ai_summary():
    return {
        "provider": "unavailable",
        "headline": "Policy analysis unavailable for this request.",
        "takeaways": [],
        "caveats": ["Contact me if this is a repeated issue. moguinyard@gmail.com."],
    }


def ai_stance_summary(issues, evidence_votes, scan_count, policy_count):
    if not get_gemini_api_key():
        return unavailable_ai_summary()

    prompt = json.dumps({
        "instruction": (
            "You are a nonpartisan civic explainer writing for a median voter, not a policy expert. "
            "Translate the voting pattern into plain English about what the member tended to support or oppose. "
            "Avoid congressional jargon such as cloture, motion, roll call, and procedural unless it is essential. "
            "Prioritize kitchen-table policy signals over repetitive nominations. "
            "When nominations dominate the sample, state that clearly but do not make it the whole summary if other policy votes exist. "
            "Use the summary field when present to explain what the bill or resolution would do in everyday terms. "
            "Use the bill titles and results to explain the practical topic of the votes; do not simply restate issue bucket names. "
            "Summarize only what the vote evidence supports. "
            "Do not infer ideology, motives, or party loyalty beyond the votes shown. "
            "Return JSON with headline, takeaways (array of 2-4 short strings), and caveats (array). "
            "Each takeaway should be specific enough to help a voter decide whether the member aligns with them."
        ),
        "issue_counts": issues,
        "scan_context": {
            "recent_roll_calls_scanned": scan_count,
            "substantive_policy_votes_found": policy_count,
        },
        "evidence_votes": compact_vote_evidence(evidence_votes),
    })
    result = gemini_generate_json(prompt)
    if not result:
        return unavailable_ai_summary()

    return {
        "provider": "gemini",
        "model": GEMINI_MODEL,
        "headline": result.get("headline") or "AI summary unavailable.",
        "takeaways": result.get("takeaways") if isinstance(result.get("takeaways"), list) else [],
        "caveats": result.get("caveats") if isinstance(result.get("caveats"), list) else [],
    }


def build_stance_profile(votes, limit):
    policy_votes = [enrich_vote(vote) for vote in votes if vote_kind(vote) == "policy"]
    issues = {}
    for vote in policy_votes:
        issue = vote["interpretation"]["issue"]
        stance = stance_from_position(vote.get("position"))
        if stance == "no_position":
            continue
        bucket = issues.setdefault(issue, {"issue": issue, "supported": 0, "opposed": 0, "evidence": []})
        bucket[stance] += 1
        if len(bucket["evidence"]) < 3:
            bucket["evidence"].append(vote)

    issue_summaries = []
    for issue in issues.values():
        total = issue["supported"] + issue["opposed"]
        direction = "mixed"
        if issue["supported"] > issue["opposed"]:
            direction = "more supportive"
        elif issue["opposed"] > issue["supported"]:
            direction = "more opposed"
        issue_summaries.append({
            **issue,
            "confidence": "higher" if total >= 3 else "early signal",
            "direction": direction,
            "totalVotes": total,
        })

    issue_summaries.sort(
        key=lambda issue: (
            issue["issue"] in LOW_INFORMATION_ISSUES and len(issue_summaries) > 1,
            -issue["totalVotes"],
        )
    )
    notable_votes = diversified_policy_votes(policy_votes, limit)
    ai_evidence_votes = diversified_policy_votes(policy_votes, STANCE_EVIDENCE_LIMIT)
    return {
        "aiSummary": ai_stance_summary(issue_summaries[:5], ai_evidence_votes, len(votes), len(policy_votes)),
        "caveat": f"Analyzed {len(policy_votes)} substantive policy votes from {len(votes)} recent roll calls. This is a snapshot, not a full career scorecard.",
        "issues": issue_summaries[:5],
        "notableVotes": notable_votes,
        "policyVoteCount": len(policy_votes),
        "scannedVoteCount": len(votes),
    }


PUBLIC_BILL_TYPE_MAP = {
    "house-bill": "hr",
    "senate-bill": "s",
    "house-joint-resolution": "hjres",
    "senate-joint-resolution": "sjres",
    "house-concurrent-resolution": "hconres",
    "senate-concurrent-resolution": "sconres",
    "house-resolution": "hres",
    "senate-resolution": "sres",
}


def congress_legislation_endpoint(legislation_url):
    parsed = urlparse(legislation_url)
    if parsed.netloc == "api.congress.gov":
        return legislation_url

    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 4 and parts[0] == "bill":
        congress, public_type, number = parts[1], parts[2], parts[3]
        bill_type = PUBLIC_BILL_TYPE_MAP.get(public_type)
        if bill_type:
            return f"bill/{congress}/{bill_type}/{number}"
    return None


def vote_bill_title(vote):
    legislation_url = vote.get("legislationUrl")
    if not legislation_url:
        return vote.get("title") or vote.get("amendmentAuthor")
    legislation_endpoint = congress_legislation_endpoint(legislation_url)
    if not legislation_endpoint:
        return vote.get("title") or vote.get("amendmentAuthor")

    def fetch_title():
        data = congress_get(legislation_endpoint)
        if data.get("error"):
            return None
        bill = data.get("bill") or {}
        amendment = data.get("amendment") or {}
        amended_bill = amendment.get("amendedBill") or {}
        return (
            bill.get("shortTitle")
            or bill.get("latestTitle")
            or bill.get("title")
            or amendment.get("purpose")
            or amended_bill.get("title")
        )

    return cached(("vote-bill-title", legislation_endpoint), fetch_title)


def normalize_house_member_vote(vote, member_vote):
    legislation_type = vote.get("legislationType") or vote.get("amendmentType")
    legislation_number = vote.get("legislationNumber") or vote.get("amendmentNumber")
    title = vote.get("enrichedTitle") or vote.get("title") or vote.get("amendmentAuthor")
    question = vote.get("voteQuestion")
    return {
        "bill": {
            "number": legislation_number,
            "title": title,
            "type": legislation_type,
        },
        "chamber": "House",
        "congress": vote.get("congress"),
        "date": vote.get("startDate"),
        "description": title or question,
        "question": question,
        "position": member_vote.get("voteCast"),
        "result": vote.get("result"),
        "rollCall": vote.get("rollCallNumber"),
        "session": vote.get("sessionNumber"),
        "source": "congress.gov",
        "type": vote.get("voteType"),
    }


def result_items(results):
    if isinstance(results, dict):
        items = results.get("item", [])
    else:
        items = results or []
    return items if isinstance(items, list) else [items]


def build_house_vote_index():
    votes_by_member = {}
    for congress, session in HOUSE_VOTE_SESSIONS:
        vote_list = congress_get(
            f"house-vote/{congress}/{session}",
            limit=HOUSE_VOTE_SCAN_LIMIT,
            sort="updateDate+desc",
        )
        if vote_list.get("error"):
            return vote_list

        roll_calls = [vote.get("rollCallNumber") for vote in vote_list.get("houseRollCallVotes", [])]

        def fetch_detail(roll_call):
            detail = congress_get(
                f"house-vote/{congress}/{session}/{roll_call}/members"
            )
            if detail.get("error"):
                return detail

            detail_vote = detail.get("houseRollCallVoteMemberVotes", {})
            detail_vote["enrichedTitle"] = vote_bill_title(detail_vote)
            return {"vote": detail_vote}

        with ThreadPoolExecutor(max_workers=max(1, min(HOUSE_VOTE_WORKERS, len(roll_calls) or 1))) as executor:
            futures = [executor.submit(fetch_detail, roll_call) for roll_call in roll_calls if roll_call]
            for future in as_completed(futures):
                detail = future.result()
                if detail.get("error"):
                    return detail
                detail_vote = detail["vote"]
                member_votes = result_items(detail_vote.get("results"))
                enriched_votes = [
                    (member_vote.get("bioguideID") or member_vote.get("bioguideId"),
                     enrich_vote(normalize_house_member_vote(detail_vote, member_vote)))
                    for member_vote in member_votes
                ]
                enriched_votes.sort(key=lambda item: item[0] or "")
                for bioguide_id, vote in enriched_votes:
                    if bioguide_id:
                        votes_by_member.setdefault(bioguide_id, []).append(vote)

    for member_votes in votes_by_member.values():
        member_votes.sort(key=lambda vote: vote.get("date") or "", reverse=True)

    return {
        "source": "house-vote",
        "votesByMember": votes_by_member,
    }


def house_vote_index():
    return cached(
        ("house-vote-index", tuple(HOUSE_VOTE_SESSIONS), HOUSE_VOTE_SCAN_LIMIT),
        build_house_vote_index,
    )


def senate_vote_menu_url(congress, session):
    return f"{SENATE_BASE_URL}/roll_call_lists/vote_menu_{congress}_{session}.xml"


def senate_vote_detail_url(congress, session, vote_number):
    return (
        f"{SENATE_BASE_URL}/roll_call_votes/vote{congress}{session}/"
        f"vote_{congress}_{session}_{str(vote_number).zfill(5)}.xml"
    )


SENATE_DOCUMENT_TYPE_MAP = {
    "s": "s",
    "s.": "s",
    "senate bill": "s",
    "s.j.res.": "sjres",
    "sjres": "sjres",
    "senate joint resolution": "sjres",
    "s.con.res.": "sconres",
    "s.res.": "sres",
    "h.r.": "hr",
    "hr": "hr",
    "house bill": "hr",
    "h.j.res.": "hjres",
    "hjres": "hjres",
    "house joint resolution": "hjres",
}


def senate_document_bill_title(vote):
    congress = xml_text(vote, "congress")
    document_type = (xml_text(vote, "document/document_type") or "").casefold()
    document_number = xml_text(vote, "document/document_number")
    bill_type = SENATE_DOCUMENT_TYPE_MAP.get(document_type)
    if not congress or not bill_type or not document_number:
        return None

    def fetch_title():
        data = congress_get(f"bill/{congress}/{bill_type}/{document_number}")
        if data.get("error"):
            return None
        bill = data.get("bill") or {}
        return bill.get("shortTitle") or bill.get("latestTitle") or bill.get("title")

    return cached(("senate-document-title", congress, bill_type, document_number), fetch_title)


def normalize_senate_member_vote(vote, member_vote, enriched_title=None):
    document_type = xml_text(vote, "document/document_type")
    document_number = xml_text(vote, "document/document_number")
    document_name = xml_text(vote, "document/document_name")
    title = enriched_title or xml_text(vote, "vote_title") or xml_text(vote, "document/document_title")
    question = xml_text(vote, "question") or xml_text(vote, "vote_question_text")
    return {
        "bill": {
            "number": document_number,
            "title": title,
            "type": document_type,
        },
        "chamber": "Senate",
        "congress": xml_text(vote, "congress"),
        "date": xml_text(vote, "vote_date"),
        "description": title or xml_text(vote, "vote_document_text") or question,
        "document": document_name,
        "position": xml_text(member_vote, "vote_cast"),
        "question": question,
        "result": xml_text(vote, "vote_result_text") or xml_text(vote, "vote_result"),
        "rollCall": xml_text(vote, "vote_number"),
        "session": xml_text(vote, "session"),
        "source": "senate.gov",
        "type": question,
    }


def senate_vote_member_key(member_vote):
    return (
        normalize_name_key(xml_text(member_vote, "last_name")),
        xml_text(member_vote, "state"),
    )


def build_senate_vote_index():
    votes_by_member = {}
    for congress, session in SENATE_VOTE_SESSIONS:
        menu = fetch_xml(senate_vote_menu_url(congress, session))
        if menu.get("error"):
            return menu

        vote_numbers = [
            xml_text(vote, "vote_number")
            for vote in menu["xml"].findall("./votes/vote")[:SENATE_VOTE_SCAN_LIMIT]
        ]
        for vote_number in filter(None, vote_numbers):
            detail = fetch_xml(senate_vote_detail_url(congress, session, vote_number))
            if detail.get("error"):
                return detail

            vote = detail["xml"]
            enriched_title = senate_document_bill_title(vote)
            for member_vote in vote.findall("./members/member"):
                key = senate_vote_member_key(member_vote)
                if key[0] and key[1]:
                    votes_by_member.setdefault(key, []).append(
                        enrich_vote(normalize_senate_member_vote(vote, member_vote, enriched_title))
                    )

    return {"source": "senate.gov", "votesByMember": votes_by_member}


def senate_vote_index():
    return cached(
        ("senate-vote-index", tuple(SENATE_VOTE_SESSIONS), SENATE_VOTE_SCAN_LIMIT),
        build_senate_vote_index,
    )


def find_representatives(state, district):
    district_num = int(district)
    state_members = congress_state_members(state)
    senators = [m for m in state_members if last_chamber(m) == "Senate"][:2]
    representative = next(
        (
            m for m in state_members
            if last_chamber(m) == "House of Representatives" and m.get("district") == district_num
        ),
        None,
    )
    return representative, senators


def get_int_arg(name, default, minimum, maximum):
    raw_value = request.args.get(name, default)
    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        return default
    return min(max(value, minimum), maximum)


@app.errorhandler(RuntimeError)
def handle_runtime_error(error):
    return jsonify({"error": str(error)}), 500


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/reps")
def get_reps():
    address = request.args.get("address", "").strip()
    if not address:
        return jsonify({"error": "no address provided"}), 400

    state, district = geocode_address(address)
    if not state:
        return jsonify({"error": "could not geocode address"}), 400

    representative, senators = find_representatives(state, district)
    return jsonify({
        "state": state,
        "district": district,
        "senators": senators,
        "representative": representative,
    })


@app.route("/member/<bioguide_id>/legislation")
def get_member_legislation(bioguide_id):
    limit = get_int_arg("limit", MAX_LEGISLATION, 1, 25)

    def fetch_legislation():
        bills = []
        url = f"{BASE_URL}/member/{bioguide_id}/sponsored-legislation"
        params = {"limit": min(limit, 10)}
        while len(bills) < limit:
            data = congress_get(url, **params)
            if data.get("error"):
                return data
            for item in data.get("sponsoredLegislation", []):
                if item.get("amendmentNumber") is not None and item.get("url"):
                    detail_data = congress_get(item["url"])
                    item["title"] = detail_data.get("amendment", {}).get("amendedBill", {}).get("title")
                bills.append(normalize_legislation(item))
                if len(bills) >= limit:
                    break
            next_url = data.get("pagination", {}).get("next")
            if not next_url or len(bills) >= limit:
                break
            url = next_url
            params = {"limit": min(limit, 10)}
        return {"bills": bills}

    data = cached(("legislation", bioguide_id, limit), fetch_legislation)
    status = data.get("statusCode", 502) if data.get("error") else 200
    return jsonify(data), status


@app.route("/member/<bioguide_id>/votes")
def get_member_votes(bioguide_id):
    limit = get_int_arg("limit", MAX_VOTES, 1, 25)

    def fetch_votes():
        pool = member_vote_pool(bioguide_id)
        if pool.get("error"):
            return pool
        return {
            "votes": policy_snapshot(pool.get("votes", []), limit),
            "source": pool.get("source"),
        }

    data = cached(("votes", bioguide_id, limit), fetch_votes)
    status = data.get("statusCode", 502) if data.get("error") else 200
    return jsonify(data), status


def member_vote_pool(bioguide_id):
    profile = member_profile(bioguide_id)
    if profile.get("error"):
        return profile
    if last_chamber(profile) == "Senate":
        index = senate_vote_index()
        if index.get("error"):
            return index
        return {
            "votes": index.get("votesByMember", {}).get(senate_member_key(profile), []),
            "source": index.get("source"),
        }

    index = house_vote_index()
    if index.get("error"):
        return index
    return {
        "votes": index.get("votesByMember", {}).get(bioguide_id, []),
        "source": index.get("source"),
    }


@app.route("/member/<bioguide_id>/stance")
def get_member_stance(bioguide_id):
    limit = get_int_arg("limit", MAX_VOTES, 1, 25)

    def fetch_stance():
        pool = member_vote_pool(bioguide_id)
        if pool.get("error"):
            return pool
        return {
            "profile": build_stance_profile(pool.get("votes", []), limit),
            "source": pool.get("source"),
        }

    data = cached(("stance", bioguide_id, limit), fetch_stance)
    status = data.get("statusCode", 502) if data.get("error") else 200
    return jsonify(data), status


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
