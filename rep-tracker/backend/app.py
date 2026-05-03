from concurrent.futures import ThreadPoolExecutor
from flask import Flask, jsonify, request
from flask_cors import CORS
import requests
import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("CONGRESS_CIVIC_API_KEY")
if not API_KEY:
    raise RuntimeError("CONGRESS_CIVIC_API_KEY environment variable is not set")

BASE_URL = "https://api.congress.gov/v3"

app = Flask(__name__)
CORS(app)

_session = requests.Session()
_session.params = {"api_key": API_KEY}

def congress_get(endpoint, **params):
    params["api_key"] = API_KEY
    url = f"{BASE_URL}/{endpoint}"
    try:
        res = requests.get(url, params=params)
        res.raise_for_status()
        return res.json()
    except requests.exceptions.HTTPError as e:
        return {"error": f"API request failed: {res.status_code}"}


def congress_state_members(state_code):
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


def geocode_address(address):
    res = requests.get(
        "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress",
        params={
            "address": address,
            "benchmark": "Public_AR_Current",
            "vintage": "Current_Current",
            "layers": "54",
            "format": "json",
        },
        timeout=10,
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


STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


@app.route("/reps")
def get_reps():
    address = request.args.get("address")
    if not address:
        return jsonify({"error": "no address provided"}), 400

    state, district = geocode_address(address)
    if not state:
        return jsonify({"error": "could not geocode address"}), 400
    district_num = int(district)
    state_members = congress_state_members(state)

    def last_chamber(m):
        return m.get("terms", {}).get("item", [{}])[-1].get("chamber", "")

    senators = [m for m in state_members if last_chamber(m) == "Senate"][:2]
    rep = next(
        (m for m in state_members
         if last_chamber(m) == "House of Representatives"
         and m.get("district") == district_num),
        None,
    )

    return jsonify({
        "state": state,
        "district": district,
        "senators": senators,
        "representative": rep,
    })


@app.route("/member/<bioguide_id>/legislation")
def get_member_legislation(bioguide_id):
    MAX_BILLS = 10
    bills = []
    url = f"{BASE_URL}/member/{bioguide_id}/sponsored-legislation"
    params = {
        "api_key": API_KEY,
        "limit": 10
    }
    while len(bills) < MAX_BILLS:
        res = requests.get(url, params=params)
        data = res.json()
        for item in data.get("sponsoredLegislation", []):
            if item.get("title") is not None:
                bills.append(item)
                if len(bills) >= MAX_BILLS:
                    break
        if not data.get("pagination", {}).get("next") or len(bills) >= MAX_BILLS:
            break
        url = data["pagination"]["next"]
        params = {"api_key": API_KEY, "limit": 10}
    print(f"fetched {len(bills)} bills")
    return jsonify({"bills": bills})






if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
