import os

os.environ.setdefault("CONGRESS_CIVIC_API_KEY", "test-key")

import app as backend


def setup_function():
    backend.clear_cache()


def test_cached_reuses_value_until_cleared():
    calls = {"count": 0}

    def fetcher():
        calls["count"] += 1
        return {"value": calls["count"]}

    assert backend.cached(("key",), fetcher) == {"value": 1}
    assert backend.cached(("key",), fetcher) == {"value": 1}
    assert calls["count"] == 1

    backend.clear_cache()

    assert backend.cached(("key",), fetcher) == {"value": 2}


def test_find_representatives_matches_current_chamber_and_district(monkeypatch):
    monkeypatch.setattr(backend, "congress_state_members", lambda state: [
        {
            "name": "Old House Member",
            "district": 12,
            "terms": {"item": [{"chamber": "House of Representatives"}, {"chamber": "Senate"}]},
        },
        {
            "name": "Current House Member",
            "district": 12,
            "terms": {"item": [{"chamber": "House of Representatives"}]},
        },
        {"name": "Senator One", "terms": {"item": [{"chamber": "Senate"}]}},
        {"name": "Senator Two", "terms": {"item": [{"chamber": "Senate"}]}},
    ])

    representative, senators = backend.find_representatives("NY", "12")

    assert representative["name"] == "Current House Member"
    assert [senator["name"] for senator in senators] == ["Old House Member", "Senator One"]


def test_reps_endpoint_returns_geocoded_members(monkeypatch):
    monkeypatch.setattr(backend, "geocode_address", lambda address: ("NY", "12"))
    monkeypatch.setattr(backend, "find_representatives", lambda state, district: (
        {"name": "Rep Example"},
        [{"name": "Senator Example"}],
    ))

    client = backend.app.test_client()
    response = client.get("/reps?address=350%205th%20Ave")

    assert response.status_code == 200
    assert response.get_json() == {
        "district": "12",
        "representative": {"name": "Rep Example"},
        "senators": [{"name": "Senator Example"}],
        "state": "NY",
    }


def test_votes_endpoint_normalizes_vote_payload(monkeypatch):
    monkeypatch.setattr(backend, "congress_get", lambda endpoint, **params: {
        "votes": [{
            "bill": {"type": "HR", "number": "1", "title": "Example Act"},
            "chamber": "House",
            "date": "2026-01-01",
            "position": "Yea",
            "question": "On Passage",
            "result": "Passed",
            "rollCall": "42",
        }]
    })

    client = backend.app.test_client()
    response = client.get("/member/R000000/votes")

    assert response.status_code == 200
    assert response.get_json()["votes"] == [{
        "bill": {"number": "1", "title": "Example Act", "type": "HR"},
        "chamber": "House",
        "congress": None,
        "date": "2026-01-01",
        "description": "On Passage",
        "position": "Yea",
        "result": "Passed",
        "rollCall": "42",
        "session": None,
        "type": None,
    }]


def test_legislation_endpoint_returns_upstream_status_and_message(monkeypatch):
    monkeypatch.setattr(backend, "congress_get", lambda endpoint, **params: {
        "error": "API_KEY_INVALID: An invalid api_key was supplied.",
        "statusCode": 403,
    })

    client = backend.app.test_client()
    response = client.get("/member/R000000/legislation")

    assert response.status_code == 403
    assert response.get_json() == {
        "error": "API_KEY_INVALID: An invalid api_key was supplied.",
        "statusCode": 403,
    }
