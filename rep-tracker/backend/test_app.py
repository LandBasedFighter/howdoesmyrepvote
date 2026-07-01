import os
import json
from unittest.mock import Mock
import xml.etree.ElementTree as ET

import requests

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


def test_cached_honors_custom_cache_predicate():
    calls = {"count": 0}

    def fetcher():
        calls["count"] += 1
        return {"value": calls["count"]}

    assert backend.cached(("custom",), fetcher, should_cache=lambda value: value["value"] > 1) == {"value": 1}
    assert backend.cached(("custom",), fetcher, should_cache=lambda value: value["value"] > 1) == {"value": 2}
    assert backend.cached(("custom",), fetcher, should_cache=lambda value: value["value"] > 1) == {"value": 2}
    assert calls["count"] == 2


def test_parse_cors_origins_normalizes_and_expands_loopback_aliases():
    assert backend.parse_cors_origins("http://localhost:5173, https://example.test/") == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://example.test",
    ]


def test_parse_cors_origins_keeps_wildcard():
    assert backend.parse_cors_origins("*") == ["*"]


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


def test_find_representatives_matches_at_large_member(monkeypatch):
    monkeypatch.setattr(backend, "congress_state_members", lambda state: [
        {"name": "At Large Rep", "terms": {"item": [{"chamber": "House of Representatives"}]}},
        {"name": "Senator One", "terms": {"item": [{"chamber": "Senate"}]}},
    ])

    representative, senators = backend.find_representatives("VT", "AL")

    assert representative["name"] == "At Large Rep"
    assert backend.district_label("VT", "AL") == "VT-AL"


def test_current_term_supports_profile_and_list_shapes():
    assert backend.last_chamber({"terms": {"item": [{"chamber": "Senate"}]}}) == "Senate"
    assert backend.last_chamber({"terms": [{"chamber": "House of Representatives"}]}) == "House of Representatives"


def test_reps_endpoint_returns_geocoded_members(monkeypatch):
    monkeypatch.setattr(backend, "geocode_address", lambda address: ("NY", "12", "New York"))
    monkeypatch.setattr(backend, "wikipedia_district_description", lambda state, district: "Covers much of Manhattan.")
    monkeypatch.setattr(backend, "find_representatives", lambda state, district: (
        {"name": "Rep Example"},
        [{"name": "Senator Example"}],
    ))

    client = backend.app.test_client()
    response = client.post("/reps", json={"address": "350 5th Ave New York, NY 10001"})

    assert response.status_code == 200
    assert response.get_json() == {
        "district": "12",
        "districtDescription": "Covers much of Manhattan.",
        "districtLabel": "NY-12",
        "representative": {"name": "Rep Example"},
        "senators": [{"name": "Senator Example"}],
        "state": "NY",
    }


def test_reps_endpoint_rejects_district_text_as_address(monkeypatch):
    def fail_geocode(address):
        raise AssertionError("district-looking input should not be geocoded as an address")

    monkeypatch.setattr(backend, "geocode_address", fail_geocode)

    client = backend.app.test_client()
    response = client.post("/reps", json={"address": "GA-4"})

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "that looks like a congressional district; use district search instead",
    }


def test_reps_endpoint_rejects_non_address_text(monkeypatch):
    def fail_geocode(address):
        raise AssertionError("non-address input should not be geocoded")

    monkeypatch.setattr(backend, "geocode_address", fail_geocode)

    client = backend.app.test_client()
    response = client.post("/reps", json={"address": "not an address"})

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "enter a complete street address, or use district or representative search",
    }


def test_reps_endpoint_returns_district_members_without_geocoding(monkeypatch):
    def fail_geocode(address):
        raise AssertionError("district searches should not geocode an address")

    monkeypatch.setattr(backend, "geocode_address", fail_geocode)
    monkeypatch.setattr(backend, "wikipedia_district_description", lambda state, district: "Covers much of Manhattan.")
    monkeypatch.setattr(backend, "find_representatives", lambda state, district: (
        {"name": "Rep Example"},
        [{"name": "Senator Example"}],
    ))

    client = backend.app.test_client()
    response = client.get("/reps?state=ny&district=12th")

    assert response.status_code == 200
    assert response.get_json() == {
        "district": "12",
        "districtDescription": "Covers much of Manhattan.",
        "districtLabel": "NY-12",
        "representative": {"name": "Rep Example"},
        "senators": [{"name": "Senator Example"}],
        "state": "NY",
    }


def test_reps_endpoint_rejects_out_of_range_district_without_lookup(monkeypatch):
    def fail_find_representatives(state, district):
        raise AssertionError("invalid districts should not be looked up")

    monkeypatch.setattr(backend, "find_representatives", fail_find_representatives)

    client = backend.app.test_client()
    response = client.get("/reps?state=CA&district=99")

    assert response.status_code == 404
    assert response.get_json() == {
        "error": "No current House representative found for CA-99.",
    }


def test_reps_endpoint_enriches_member_card_images(monkeypatch):
    monkeypatch.setattr(backend, "geocode_address", lambda address: ("NY", "14", "Queens"))
    monkeypatch.setattr(backend, "wikipedia_district_description", lambda state, district: "Covers parts of New York City.")
    monkeypatch.setattr(backend, "find_representatives", lambda state, district: (
        {"bioguideId": "O000172", "name": "Ocasio-Cortez, Alexandria"},
        [{"bioguideId": "S000001", "name": "Schumer, Charles E."}],
    ))
    monkeypatch.setattr(backend, "member_profile", lambda bioguide_id: {
        "depiction": {"imageUrl": f"https://example.test/{bioguide_id}.jpg"},
    })

    client = backend.app.test_client()
    response = client.post("/reps", json={"address": "350 5th Ave New York, NY 10001"})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["representative"]["depiction"]["imageUrl"] == "https://example.test/O000172.jpg"
    assert payload["senators"][0]["depiction"]["imageUrl"] == "https://example.test/S000001.jpg"


def test_reps_endpoint_returns_representative_name_match(monkeypatch):
    def state_members(state):
        if state != "NY":
            return []
        return [
            {
                "name": "Ocasio-Cortez, Alexandria",
                "district": 14,
                "terms": {"item": [{"chamber": "House of Representatives", "stateCode": "NY"}]},
            },
            {"name": "Senator Example", "terms": {"item": [{"chamber": "Senate", "stateCode": "NY"}]}},
        ]

    monkeypatch.setattr(backend, "congress_state_members", state_members)
    monkeypatch.setattr(backend, "wikipedia_district_description", lambda state, district: "Covers parts of New York City.")

    client = backend.app.test_client()
    response = client.get("/reps?representative=Alexandria%20Ocasio-Cortez")

    assert response.status_code == 200
    assert response.get_json() == {
        "district": "14",
        "districtDescription": "Covers parts of New York City.",
        "districtLabel": "NY-14",
        "representative": {
            "district": 14,
            "name": "Ocasio-Cortez, Alexandria",
            "terms": {"item": [{"chamber": "House of Representatives", "stateCode": "NY"}]},
        },
        "senators": [{"name": "Senator Example", "terms": {"item": [{"chamber": "Senate", "stateCode": "NY"}]}}],
        "state": "NY",
    }


def test_reps_endpoint_handles_misspelled_representative_name(monkeypatch):
    def state_members(state):
        if state != "NY":
            return []
        return [
            {
                "name": "Ocasio-Cortez, Alexandria",
                "district": 14,
                "terms": {"item": [{"chamber": "House of Representatives", "stateCode": "NY"}]},
            },
            {"name": "Senator Example", "terms": {"item": [{"chamber": "Senate", "stateCode": "NY"}]}},
        ]

    monkeypatch.setattr(backend, "congress_state_members", state_members)
    monkeypatch.setattr(backend, "wikipedia_district_description", lambda state, district: "Covers parts of New York City.")

    client = backend.app.test_client()
    response = client.get("/reps?representative=Alexandria%20Ocascio")

    assert response.status_code == 200
    assert response.get_json()["districtLabel"] == "NY-14"
    assert response.get_json()["representative"]["name"] == "Ocasio-Cortez, Alexandria"


def test_representatives_endpoint_returns_autocomplete_options(monkeypatch):
    def state_members(state):
        if state != "NY":
            return []
        return [
            {
                "bioguideId": "O000172",
                "name": "Ocasio-Cortez, Alexandria",
                "district": 14,
                "terms": {"item": [{"chamber": "House of Representatives", "stateCode": "NY"}]},
            },
            {"name": "Senator Example", "terms": {"item": [{"chamber": "Senate", "stateCode": "NY"}]}},
        ]

    monkeypatch.setattr(backend, "congress_state_members", state_members)

    client = backend.app.test_client()
    response = client.get("/representatives")

    assert response.status_code == 200
    assert response.get_json() == {
        "representatives": [{
            "bioguideId": "O000172",
            "display": "Alexandria Ocasio-Cortez (NY-14)",
            "districtLabel": "NY-14",
            "label": "Alexandria Ocasio-Cortez",
            "search": "Ocasio-Cortez, Alexandria",
        }],
    }


def test_reps_endpoint_capitalizes_representative_not_found(monkeypatch):
    monkeypatch.setattr(backend, "congress_state_members", lambda state: [])

    client = backend.app.test_client()
    response = client.get("/reps?representative=Nope")

    assert response.status_code == 404
    assert response.get_json() == {
        "error": "Could not find a current House representative by that name.",
    }


def test_compact_district_extract_prefers_geography_over_tautology():
    extract = (
        "Georgia's 4th congressional district is a congressional district in Georgia. "
        "The district is based in the eastern suburbs of Atlanta, encompassing parts of DeKalb, Gwinnett, and Newton counties. "
        "It has changed after redistricting."
    )

    assert backend.compact_district_extract(extract) == (
        "Based in the eastern suburbs of Atlanta, encompassing parts of DeKalb, Gwinnett, and Newton counties."
    )


def test_compact_district_extract_skips_incumbent_history_sentences():
    extract = (
        "The district was represented by Democrat John Lewis from January 3, 1987, until his death on July 17, 2020. "
        "The district includes central Atlanta and nearby communities in Fulton, DeKalb, and Clayton counties."
    )

    assert backend.compact_district_extract(extract) == (
        "District includes central Atlanta and nearby communities in Fulton, DeKalb, and Clayton counties."
    )


def test_compact_district_extract_removes_representative_clause_from_geography():
    extract = (
        "The redrawn District 12 includes the Upper West Side constituency represented by Nadler since the 1990s, "
        "the Upper East Side, and all of Midtown Manhattan."
    )

    assert backend.compact_district_extract(extract) == (
        "Redrawn District 12 includes the Upper West Side constituency, the Upper East Side, and all of Midtown Manhattan."
    )


def test_compact_district_extract_keeps_current_geography_over_old_boundary_history():
    extract = (
        "Texas's 16th congressional district of the United States House of Representatives includes almost all of El Paso "
        "and most of its suburbs in the state of Texas. "
        "However, after Texas' original 1960 district map was thrown out as a result of Wesberry v. Sanders, "
        "the 16th was shrunk down to the city of El Paso and most of its surrounding suburban communities."
    )

    assert backend.compact_district_extract(extract, require_geography=True) == (
        "Includes almost all of El Paso and most of its suburbs in the state of Texas."
    )


def test_district_area_description_falls_back_to_census_county(monkeypatch):
    monkeypatch.setattr(backend, "wikipedia_district_description", lambda state, district: None)

    assert backend.district_area_description("GA", "4", "DeKalb") == (
        "GA-4 includes the area around this address in DeKalb County, GA. District lines can change after redistricting."
    )


def test_district_area_description_handles_at_large_statewide_districts():
    assert backend.district_area_description("VT", "AL") == "Covers the entire state of Vermont."
    assert backend.district_area_description("AK", "AL") == "Covers the entire state of Alaska."


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
                    "legislationUrl": "https://www.congress.gov/bill/119/house-bill/1",
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
        if endpoint == "house-vote/119/2/72/members":
            return {
                "houseRollCallVoteMemberVotes": {
                    "congress": 119,
                    "legislationNumber": "2",
                    "legislationType": "HR",
                    "result": "Passed",
                    "results": [{"bioguideID": "R000000", "voteCast": "Yea"}],
                    "rollCallNumber": "72",
                    "sessionNumber": 2,
                    "startDate": "2026-01-02T12:00:00-05:00",
                    "voteQuestion": "On Motion to Recommit",
                    "voteType": "Yea and Nay",
                }
            }
        if endpoint == "bill/119/hr/1":
            return {"bill": {"latestTitle": "Example Act"}}
        return {"houseRollCallVoteMemberVotes": {"results": []}}

    monkeypatch.setattr(backend, "HOUSE_VOTE_SESSIONS", [(119, 2)])
    monkeypatch.setattr(backend, "congress_get", fake_congress_get)

    client = backend.app.test_client()
    response = client.get("/member/R000000/votes")

    assert response.status_code == 200
    votes = response.get_json()["votes"]
    assert votes[0] == {
        "bill": {"number": "1", "title": "Example Act", "type": "HR"},
        "chamber": "House",
        "congress": 119,
        "date": "2026-01-01T12:00:00-05:00",
        "description": "Example Act",
        "interpretation": {
            "issue": "Other recent policy",
            "kind": "policy",
            "priority": 0,
            "summary": "Substantive policy vote related to Example Act.",
        },
        "position": "Aye",
        "question": "On Passage",
        "result": "Passed",
        "rollCall": "74",
        "session": 2,
        "source": "congress.gov",
        "type": "Yea and Nay",
        "voterContext": {
            "contextNote": "",
            "headline": "Example Act",
            "impact": "This vote has limited public context in the scanned roll-call data.",
            "issue": "Other recent policy",
            "kind": "policy",
            "positionLabel": "Voted Aye",
            "resultLabel": "Passed",
        },
    }
    assert votes[1]["interpretation"]["kind"] == "procedural"

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
        "interpretation": {
            "issue": "Procedure",
            "kind": "procedural",
            "priority": 1,
            "summary": "Procedural vote that shaped debate, timing, or floor handling rather than directly deciding policy.",
        },
        "position": "Yea",
        "question": "On the Motion to Proceed",
        "result": "Rejected (47-50)",
        "rollCall": "192",
        "session": "2",
        "source": "senate.gov",
        "type": "On the Motion to Proceed",
        "voterContext": {
            "contextNote": "This is a process vote, so it may not directly decide the underlying bill.",
            "headline": "Motion to Proceed to S. J. Res. 185; A joint resolution to direct the removal of United States Armed Forces from hostilities.",
            "impact": "Procedural votes usually shape debate, timing, or floor handling rather than directly changing policy.",
            "issue": "Procedure",
            "kind": "procedural",
            "positionLabel": "Voted Yea",
            "resultLabel": "Rejected (47-50)",
        },
    }]


def test_policy_snapshot_prioritizes_policy_votes():
    votes = [
        {
            "bill": {"title": "House rule", "type": "HRES", "number": "1"},
            "date": "2026-02-24",
            "description": "On Ordering the Previous Question",
            "question": "On Ordering the Previous Question",
        },
        {
            "bill": {"title": "Defense funding bill", "type": "HR", "number": "2"},
            "date": "2026-02-25",
            "description": "Defense funding bill",
            "question": "On Passage",
        },
    ]

    snapshot = backend.policy_snapshot(votes, 2)

    assert snapshot[0]["bill"]["number"] == "2"
    assert snapshot[0]["interpretation"]["kind"] == "policy"
    assert snapshot[1]["interpretation"]["kind"] == "procedural"


def test_vote_kind_treats_suspend_rules_bill_votes_as_policy():
    vote = {
        "bill": {"title": "Veterans Health Care Improvement Act", "type": "HR", "number": "6329"},
        "description": "Veterans Health Care Improvement Act",
        "question": "On Motion to Suspend the Rules and Pass",
    }

    assert backend.vote_kind(vote) == "policy"


def test_vote_kind_keeps_house_rules_votes_procedural():
    vote = {
        "bill": {"title": "Providing for consideration of H.R. 6329", "type": "HRES", "number": "1075"},
        "description": "On Agreeing to the Resolution",
        "question": "On Agreeing to the Resolution",
    }

    assert backend.vote_kind(vote) == "procedural"


def test_voter_context_explains_healthcare_policy_vote():
    vote = {
        "bill": {"title": "Veterans Health Care Improvement Act", "type": "HR", "number": "6329"},
        "description": "Veterans Health Care Improvement Act",
        "position": "Yea",
        "question": "On Passage",
        "result": "Passed",
    }

    context = backend.voter_context(vote)

    assert context == {
        "contextNote": "",
        "headline": "Veterans Health Care Improvement Act",
        "impact": "Healthcare votes can affect care access, drug costs, hospitals, public health programs, or benefits for patients and veterans.",
        "issue": "Healthcare",
        "kind": "policy",
        "positionLabel": "Voted Yea",
        "resultLabel": "Passed",
    }


def test_voter_context_explains_procedural_votes_without_overclaiming():
    vote = {
        "bill": {"title": "Providing for consideration of H.R. 6329", "type": "HRES", "number": "1075"},
        "description": "On Ordering the Previous Question",
        "position": "Yea",
        "question": "On Ordering the Previous Question",
        "result": "Passed",
    }

    context = backend.voter_context(vote)

    assert context["issue"] == "Procedure"
    assert context["kind"] == "procedural"
    assert context["headline"] == "On Ordering the Previous Question"
    assert context["impact"] == "Procedural votes usually shape debate, timing, or floor handling rather than directly changing policy."
    assert context["contextNote"] == "This is a process vote, so it may not directly decide the underlying bill."


def test_voter_context_uses_conservative_fallback_for_thin_votes():
    context = backend.voter_context({
        "position": "",
        "result": "",
    })

    assert context == {
        "contextNote": "This vote has limited public context in the scanned roll-call data.",
        "headline": "Vote details unavailable",
        "impact": "This vote has limited public context in the scanned roll-call data.",
        "issue": "Other recent policy",
        "kind": "procedural",
        "positionLabel": "Position unavailable",
        "resultLabel": "Result unavailable",
    }


def test_congress_legislation_endpoint_converts_public_bill_urls():
    assert backend.congress_legislation_endpoint(
        "https://www.congress.gov/bill/119/house-bill/6329"
    ) == "bill/119/hr/6329"
    assert backend.congress_legislation_endpoint(
        "https://www.congress.gov/bill/119/senate-bill/2503"
    ) == "bill/119/s/2503"


def test_build_stance_profile_groups_policy_tendencies(monkeypatch):
    monkeypatch.setattr(backend, "gemini_generate_json", lambda prompt: None)
    votes = [
        {
            "bill": {"title": "Homeowner Energy Freedom Act", "type": "HR", "number": "4758"},
            "description": "Homeowner Energy Freedom Act",
            "position": "Yea",
            "question": "On Passage",
        },
        {
            "bill": {"title": "Home Appliance Protection and Affordability Act", "type": "HR", "number": "4626"},
            "description": "Home Appliance Protection and Affordability Act",
            "position": "Nay",
            "question": "On Passage",
        },
        {
            "bill": {"title": "Providing for consideration of H.R. 6329", "type": "HRES", "number": "1075"},
            "description": "On Ordering the Previous Question",
            "position": "Yea",
            "question": "On Ordering the Previous Question",
        },
    ]

    profile = backend.build_stance_profile(votes, 5)

    assert profile["aiSummary"]["provider"] == "unavailable"
    assert profile["policyVoteCount"] == 2
    assert profile["scannedVoteCount"] == 3
    assert "Analyzed 2 substantive policy votes from 3 recent roll calls" in profile["caveat"]
    assert profile["issues"][0]["issue"] == "Energy, climate & utilities"
    assert profile["issues"][0]["supported"] == 1
    assert profile["issues"][0]["opposed"] == 0
    assert profile["issues"][1]["issue"] == "Cost of living & consumer rules"
    assert profile["issues"][1]["supported"] == 0
    assert profile["issues"][1]["opposed"] == 1
    assert len(profile["notableVotes"]) == 2


def test_compact_vote_evidence_includes_bill_summary(monkeypatch):
    def fake_congress_get(endpoint, **params):
        assert endpoint == "bill/119/hr/42/summaries"
        return {
            "summaries": [{
                "text": "<p>This bill lowers household energy costs &amp; creates rebates for families.</p>"
            }]
        }

    monkeypatch.setattr(backend, "congress_get", fake_congress_get)

    evidence = backend.compact_vote_evidence([{
        "bill": {"type": "HR", "number": "42", "title": "Energy Rebates Act"},
        "congress": 119,
        "description": "Energy Rebates Act",
        "interpretation": {"issue": "Energy, climate & utilities"},
        "position": "Yea",
        "question": "On Passage",
        "result": "Passed",
    }])

    assert evidence[0]["summary"] == "This bill lowers household energy costs & creates rebates for families."


def test_compact_vote_evidence_handles_missing_bill_summary(monkeypatch):
    monkeypatch.setattr(
        backend,
        "congress_get",
        lambda endpoint, **params: {"error": "not found", "statusCode": 404},
    )

    evidence = backend.compact_vote_evidence([{
        "bill": {"type": "S.J.Res.", "number": "185", "title": "Foreign policy resolution"},
        "congress": 119,
        "description": "Foreign policy resolution",
        "interpretation": {"issue": "Defense, veterans & foreign policy"},
        "position": "Nay",
        "question": "On Passage",
        "result": "Failed",
    }])

    assert evidence[0]["summary"] is None


def test_compact_vote_evidence_does_not_fail_when_summary_lookup_raises(monkeypatch):
    def fail_congress_get(endpoint, **params):
        raise RuntimeError("summary lookup failed")

    monkeypatch.setattr(backend, "congress_get", fail_congress_get)

    evidence = backend.compact_vote_evidence([{
        "bill": {"type": "HR", "number": "42", "title": "Energy Rebates Act"},
        "congress": 119,
        "description": "Energy Rebates Act",
        "interpretation": {"issue": "Energy, climate & utilities"},
        "position": "Yea",
        "question": "On Passage",
        "result": "Passed",
    }])

    assert evidence[0]["summary"] is None
    assert evidence[0]["title"] == "Energy Rebates Act"


def test_ai_stance_summary_uses_gemini_when_configured(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(backend, "GEMINI_FALLBACK_MODELS", [])
    response = Mock()
    response.status_code = 200
    response.json.return_value = {
        "candidates": [{
            "content": {
                "parts": [{
                    "text": json.dumps({
                        "headline": "Shows mixed energy votes.",
                        "takeaways": ["Supported one energy measure.", "Opposed one energy measure."],
                        "caveats": ["Small sample."],
                    })
                }]
            }
        }]
    }
    post_mock = Mock(return_value=response)
    monkeypatch.setattr(backend._session, "post", post_mock)

    summary = backend.ai_stance_summary(
        [{"issue": "Energy & environment", "supported": 1, "opposed": 1, "direction": "mixed"}],
        [],
        12,
        8,
    )

    assert summary["provider"] == "gemini"
    assert summary["headline"] == "Shows mixed energy votes."
    assert summary["model"] == backend.GEMINI_MODEL
    assert post_mock.call_args.kwargs["params"] == {"key": "test-gemini-key"}


def test_ai_stance_summary_prompt_requires_voter_impact(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    captured = {}

    def fake_generate(prompt):
        captured["prompt"] = json.loads(prompt)
        return {"headline": "Energy costs mattered.", "takeaways": [], "caveats": []}

    monkeypatch.setattr(backend, "gemini_generate_json", fake_generate)

    backend.ai_stance_summary([], [], 30, 15)

    instruction = captured["prompt"]["instruction"]
    assert "concrete, everyday tradeoffs" in instruction
    assert "Energy costs:" in instruction
    assert "Avoid vague phrases" in instruction


def test_ai_stance_summary_normalizes_labeled_takeaway_objects(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(backend, "gemini_generate_json", lambda prompt: {
        "headline": "Voter-facing summary.",
        "takeaways": [
            {"label": "Energy costs:", "message": "Opposed repealing home energy rebates."},
            "Military action: Supported limiting unauthorized hostilities.",
        ],
        "caveats": [],
    })

    summary = backend.ai_stance_summary([], [], 30, 15)

    assert summary["takeaways"] == [
        "Energy costs: Opposed repealing home energy rebates.",
        "Military action: Supported limiting unauthorized hostilities.",
    ]


def test_gemini_generate_json_retries_transient_failures(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(backend, "GEMINI_ATTEMPTS", 2)
    monkeypatch.setattr(backend, "GEMINI_FALLBACK_MODELS", [])
    monkeypatch.setattr(backend, "sleep", lambda seconds: None)
    success = Mock()
    success.status_code = 200
    success.json.return_value = {
        "candidates": [{
            "content": {
                "parts": [{"text": json.dumps({"headline": "Recovered"})}]
            }
        }]
    }
    post_mock = Mock(side_effect=[requests.exceptions.Timeout("slow"), success])
    monkeypatch.setattr(backend._session, "post", post_mock)

    result = backend.gemini_generate_json("{}")

    assert result["headline"] == "Recovered"
    assert result["_model"] == backend.GEMINI_MODEL
    assert post_mock.call_count == 2


def test_gemini_generate_json_tries_fallback_model_after_quota(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setattr(backend, "GEMINI_MODEL", "gemini-2.5-flash")
    monkeypatch.setattr(backend, "GEMINI_FALLBACK_MODELS", ["gemini-2.0-flash"])
    quota = Mock()
    quota.status_code = 429
    success = Mock()
    success.status_code = 200
    success.json.return_value = {
        "candidates": [{
            "content": {
                "parts": [{"text": json.dumps({"headline": "Fallback worked"})}]
            }
        }]
    }
    post_mock = Mock(side_effect=[quota, success])
    monkeypatch.setattr(backend._session, "post", post_mock)

    result = backend.gemini_generate_json("{}")

    assert result["headline"] == "Fallback worked"
    assert result["_model"] == "gemini-2.0-flash"
    assert "models/gemini-2.5-flash" in post_mock.call_args_list[0].args[0]
    assert "models/gemini-2.0-flash" in post_mock.call_args_list[1].args[0]


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
