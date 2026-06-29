import os
from unittest.mock import Mock
import xml.etree.ElementTree as ET

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


def test_current_term_supports_profile_and_list_shapes():
    assert backend.last_chamber({"terms": {"item": [{"chamber": "Senate"}]}}) == "Senate"
    assert backend.last_chamber({"terms": [{"chamber": "House of Representatives"}]}) == "House of Representatives"


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


def test_votes_endpoint_filters_house_roll_call_member_votes(monkeypatch):
    calls = []

    def fake_congress_get(endpoint, **params):
        calls.append(endpoint)
        if endpoint == "house-vote/119/2":
            return {
                "houseRollCallVotes": [
                    {"rollCallNumber": "74"},
                    {"rollCallNumber": "72"},
                ]
            }
        if endpoint == "house-vote/119/2/74/members":
            return {
                "houseRollCallVoteMemberVotes": {
                    "congress": 119,
                    "legislationNumber": "1",
                    "legislationType": "HR",
                    "legislationUrl": "https://api.congress.gov/v3/bill/119/hr/1",
                    "result": "Passed",
                    "results": [
                        {"bioguideID": "A000001", "voteCast": "Nay"},
                        {"bioguideID": "R000000", "voteCast": "Aye"},
                    ],
                    "rollCallNumber": "74",
                    "sessionNumber": 2,
                    "startDate": "2026-01-01T12:00:00-05:00",
                    "voteQuestion": "On Passage",
                    "voteType": "Yea and Nay",
                }
            }
        if endpoint == "https://api.congress.gov/v3/bill/119/hr/1":
            return {"bill": {"latestTitle": "Example Act"}}
        return {"houseRollCallVoteMemberVotes": {"results": []}}

    monkeypatch.setattr(backend, "HOUSE_VOTE_SESSIONS", [(119, 2)])
    monkeypatch.setattr(backend, "congress_get", fake_congress_get)

    client = backend.app.test_client()
    response = client.get("/member/R000000/votes")

    assert response.status_code == 200
    assert response.get_json()["votes"] == [{
        "bill": {"number": "1", "title": "Example Act", "type": "HR"},
        "chamber": "House",
        "congress": 119,
        "date": "2026-01-01T12:00:00-05:00",
        "description": "Example Act",
        "position": "Aye",
        "question": "On Passage",
        "result": "Passed",
        "rollCall": "74",
        "session": 2,
        "type": "Yea and Nay",
    }]

    second_response = client.get("/member/A000001/votes")

    assert second_response.status_code == 200
    assert second_response.get_json()["votes"][0]["position"] == "Nay"
    assert calls.count("house-vote/119/2") == 1


def test_votes_endpoint_filters_senate_roll_call_xml(monkeypatch):
    menu_xml = ET.fromstring("""
        <vote_summary>
          <votes>
            <vote><vote_number>00192</vote_number></vote>
          </votes>
        </vote_summary>
    """)
    detail_xml = ET.fromstring("""
        <roll_call_vote>
          <congress>119</congress>
          <session>2</session>
          <vote_number>192</vote_number>
          <vote_date>24-Jun</vote_date>
          <vote_title>Motion to Proceed to S. J. Res. 185; A joint resolution to direct the removal of United States Armed Forces from hostilities.</vote_title>
          <question>On the Motion to Proceed</question>
          <vote_result_text>Rejected (47-50)</vote_result_text>
          <document>
            <document_type>S.J.Res.</document_type>
            <document_number>185</document_number>
            <document_name>S.J.Res.185</document_name>
          </document>
          <members>
            <member>
              <last_name>Ossoff</last_name>
              <first_name>Jon</first_name>
              <state>GA</state>
              <vote_cast>Yea</vote_cast>
            </member>
            <member>
              <last_name>Warnock</last_name>
              <first_name>Raphael</first_name>
              <state>GA</state>
              <vote_cast>Nay</vote_cast>
            </member>
          </members>
        </roll_call_vote>
    """)

    def fake_fetch_xml(url):
        if "vote_menu_119_2.xml" in url:
            return {"xml": menu_xml}
        return {"xml": detail_xml}

    monkeypatch.setattr(backend, "SENATE_VOTE_SESSIONS", [(119, 2)])
    monkeypatch.setattr(backend, "member_profile", lambda bioguide_id: {
        "lastName": "Ossoff",
        "terms": {"item": [{"chamber": "Senate", "stateCode": "GA"}]},
    })
    monkeypatch.setattr(backend, "fetch_xml", fake_fetch_xml)

    client = backend.app.test_client()
    response = client.get("/member/O000000/votes")

    assert response.status_code == 200
    assert response.get_json()["votes"] == [{
        "bill": {
            "number": "185",
            "title": "Motion to Proceed to S. J. Res. 185; A joint resolution to direct the removal of United States Armed Forces from hostilities.",
            "type": "S.J.Res.",
        },
        "chamber": "Senate",
        "congress": "119",
        "date": "24-Jun",
        "description": "Motion to Proceed to S. J. Res. 185; A joint resolution to direct the removal of United States Armed Forces from hostilities.",
        "document": "S.J.Res.185",
        "position": "Yea",
        "question": "On the Motion to Proceed",
        "result": "Rejected (47-50)",
        "rollCall": "192",
        "session": "2",
        "type": "On the Motion to Proceed",
    }]


def test_congress_error_message_handles_string_errors():
    class Response:
        def json(self):
            return {"error": "Unknown resource: member/R000000/votes"}

    assert backend.congress_error_message(Response()) == "Unknown resource: member/R000000/votes"


def test_congress_get_handles_http_errors_without_raising(monkeypatch):
    response = Mock()
    response.status_code = 404
    response.json.return_value = {"error": "Unknown resource: member/R000000/votes"}
    response.raise_for_status.side_effect = AssertionError("should not raise")
    get_mock = Mock(return_value=response)
    monkeypatch.setattr(backend._session, "get", get_mock)

    result = backend.congress_get("member/R000000/votes")

    assert result == {
        "error": "Unknown resource: member/R000000/votes",
        "statusCode": 404,
    }
    response.raise_for_status.assert_not_called()
    assert get_mock.call_args.kwargs["params"]["api_key"] == "test-key"


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
