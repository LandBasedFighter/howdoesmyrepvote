from threading import Lock
from time import monotonic
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
        res.raise_for_status()
        return res.json()
    except requests.exceptions.RequestException as error:
        response = getattr(error, "response", None)
        status_code = getattr(response, "status_code", None)
        if status_code:
            return {
                "error": congress_error_message(response) or f"Congress.gov API request failed: {status_code}",
                "statusCode": status_code,
            }
        return {"error": "Congress.gov API request failed", "statusCode": 502}


def congress_error_message(response):
    try:
        error_payload = response.json().get("error", {})
    except ValueError:
        return None
    code = error_payload.get("code")
    message = error_payload.get("message")
    if code and message:
        return f"{code}: {message}"
    return message or code


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
    return member.get("terms", {}).get("item", [{}])[-1].get("chamber", "")


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
        data = congress_get(f"member/{bioguide_id}/votes", limit=limit)
        if data.get("error"):
            return data
        return {"votes": [normalize_vote(vote) for vote in data.get("votes", [])[:limit]]}

    data = cached(("votes", bioguide_id, limit), fetch_votes)
    status = data.get("statusCode", 502) if data.get("error") else 200
    return jsonify(data), status


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
