from threading import Lock
from time import monotonic
import xml.etree.ElementTree as ET
import os

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
HOUSE_VOTE_SCAN_LIMIT = int(os.getenv("HOUSE_VOTE_SCAN_LIMIT", "10"))
HOUSE_VOTE_SESSIONS = [
    tuple(int(part) for part in session.strip().split(":", 1))
    for session in os.getenv("HOUSE_VOTE_SESSIONS", "119:2").split(",")
    if session.strip()
]
SENATE_BASE_URL = "https://www.senate.gov/legislative/LIS"
SENATE_VOTE_SCAN_LIMIT = int(os.getenv("SENATE_VOTE_SCAN_LIMIT", "10"))
SENATE_VOTE_SESSIONS = [
    tuple(int(part) for part in session.strip().split(":", 1))
    for session in os.getenv("SENATE_VOTE_SESSIONS", "119:2").split(",")
    if session.strip()
]

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


def vote_bill_title(vote):
    legislation_url = vote.get("legislationUrl")
    if not legislation_url:
        return vote.get("title") or vote.get("amendmentAuthor")

    def fetch_title():
        data = congress_get(legislation_url)
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

    return cached(("vote-bill-title", legislation_url), fetch_title)


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

        for vote in vote_list.get("houseRollCallVotes", []):
            detail = congress_get(
                f"house-vote/{congress}/{session}/{vote.get('rollCallNumber')}/members"
            )
            if detail.get("error"):
                return detail

            detail_vote = detail.get("houseRollCallVoteMemberVotes", {})
            detail_vote["enrichedTitle"] = vote_bill_title(detail_vote)
            for member_vote in result_items(detail_vote.get("results")):
                bioguide_id = member_vote.get("bioguideID") or member_vote.get("bioguideId")
                if bioguide_id:
                    votes_by_member.setdefault(bioguide_id, []).append(
                        normalize_house_member_vote(detail_vote, member_vote)
                    )

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


def normalize_senate_member_vote(vote, member_vote):
    document_type = xml_text(vote, "document/document_type")
    document_number = xml_text(vote, "document/document_number")
    document_name = xml_text(vote, "document/document_name")
    title = xml_text(vote, "vote_title") or xml_text(vote, "document/document_title")
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
            for member_vote in vote.findall("./members/member"):
                key = senate_vote_member_key(member_vote)
                if key[0] and key[1]:
                    votes_by_member.setdefault(key, []).append(
                        normalize_senate_member_vote(vote, member_vote)
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
        profile = member_profile(bioguide_id)
        if profile.get("error"):
            return profile
        if last_chamber(profile) == "Senate":
            index = senate_vote_index()
            if index.get("error"):
                return index
            return {
                "votes": index.get("votesByMember", {}).get(senate_member_key(profile), [])[:limit],
                "source": index.get("source"),
            }

        index = house_vote_index()
        if index.get("error"):
            return index
        return {
            "votes": index.get("votesByMember", {}).get(bioguide_id, [])[:limit],
            "source": index.get("source"),
            "note": index.get("note"),
        }

    data = cached(("votes", bioguide_id, limit), fetch_votes)
    status = data.get("statusCode", 502) if data.get("error") else 200
    return jsonify(data), status


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
