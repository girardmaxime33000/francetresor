import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import markets as mk


def pm_frame(n=1500, start="2020-01-01", last=200.0, seed=1):
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start, periods=n)
    values = last + np.cumsum(rng.normal(0, 1.5, n))
    return pd.DataFrame({"date": dates, "breakeven_bp": values, "breakeven": values / 10000})


def btf_frame(weeks=320, seed=2):
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2020-01-06", periods=weeks, freq="7D")
    rows = []
    for seg in mk.BTF_SEGMENTS:
        rate = 0.02 + np.cumsum(rng.normal(0, 0.0005, weeks))
        for d, r in zip(dates, rate):
            rows.append({"auction_date": d, "segment": seg, "weighted_rate": float(r), "amount_served": 1000.0})
    return pd.DataFrame(rows)


def oat_frame(months=80, seed=3):
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(months):
        first = pd.Timestamp("2020-01-02") + pd.DateOffset(months=i)
        third = first + pd.Timedelta(days=14)
        rows.append({"auction_date": first, "auction_type": "adju_LT", "bid_amount": 2.5 * 8000 * rng.uniform(0.8, 1.2), "amount_served": 8000.0})
        rows.append({"auction_date": third, "auction_type": "adju_MT", "bid_amount": 2.2 * 6000 * rng.uniform(0.8, 1.2), "amount_served": 6000.0})
        rows.append({"auction_date": third, "auction_type": "adju_I", "bid_amount": 3000.0, "amount_served": 1000.0})
    return pd.DataFrame(rows)


def test_breakeven_markets_are_balanced_and_unique():
    ms = mk.generate_breakeven(pm_frame())
    assert len(ms) == 6
    assert len({m["id"] for m in ms}) == 6
    for m in ms:
        assert mk.P_MIN <= m["p0"] <= mk.P_MAX
        assert m["status"] == "open" and m["target_date"] > m["reference_date"]
    probs = sorted(m["p0"] for m in ms if m["params"]["horizon_days"] == 14)
    assert probs[0] < 0.4 and probs[-1] > 0.6


def test_breakeven_resolution_waits_for_target_then_applies_strict_threshold():
    pm = pm_frame()
    m = mk.generate_breakeven(pm)[0]
    assert mk.resolve_market(m, pd.DataFrame(), pd.DataFrame(), pm)["status"] == "open"
    target = pd.Timestamp(m["target_date"])
    s = mk.breakeven_series(pm)
    extra = pd.DataFrame({"date": pd.bdate_range(s.index.max() + pd.Timedelta(days=1), target + pd.Timedelta(days=4)), "breakeven_bp": m["threshold"], "breakeven": 0.0})
    r = mk.resolve_market(m, pd.DataFrame(), pd.DataFrame(), pd.concat([pm, extra]))
    assert r["status"] == "resolved"
    assert r["outcome"] is False  # valeur égale au seuil : pas strictement supérieure
    extra["breakeven_bp"] = m["threshold"] + 0.1
    assert mk.resolve_market(m, pd.DataFrame(), pd.DataFrame(), pd.concat([pm, extra]))["outcome"] is True


def test_breakeven_uses_last_observation_on_or_before_target():
    pm = pm_frame()
    m = mk.generate_breakeven(pm)[0]
    target = pd.Timestamp(m["target_date"])
    s = mk.breakeven_series(pm)
    days = pd.DatetimeIndex([target - pd.Timedelta(days=1), target + pd.Timedelta(days=3)])
    extra = pd.DataFrame({"date": days, "breakeven_bp": [m["threshold"] + 5, m["threshold"] - 50], "breakeven": 0.0})
    r = mk.resolve_market(m, pd.DataFrame(), pd.DataFrame(), pd.concat([pm, extra]))
    assert r["resolved_date"] == (target - pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    assert r["outcome"] is True
    assert s.index.max() < target


def test_btf_market_resolves_on_first_auction_after_reference():
    btf = btf_frame()
    ms = [m for m in mk.generate_btf(btf) if m["params"]["segment"] == "3 mois"]
    m = ms[0]
    assert mk.resolve_market(m, pd.DataFrame(), btf, pd.DataFrame())["status"] == "open"
    ref = pd.Timestamp(m["reference_date"])
    new = pd.DataFrame(
        [
            {"auction_date": ref + pd.Timedelta(days=7), "segment": "3 mois", "weighted_rate": m["threshold"] + 0.001, "amount_served": 1000.0},
            {"auction_date": ref + pd.Timedelta(days=7), "segment": "3 mois", "weighted_rate": m["threshold"] + 0.003, "amount_served": 3000.0},
            {"auction_date": ref + pd.Timedelta(days=14), "segment": "3 mois", "weighted_rate": 0.0, "amount_served": 1000.0},
        ]
    )
    r = mk.resolve_market(m, pd.DataFrame(), pd.concat([btf, new]), pd.DataFrame())
    assert r["resolved_date"] == (ref + pd.Timedelta(days=7)).strftime("%Y-%m-%d")
    assert r["resolved_value"] == pytest.approx(m["threshold"] + 0.0025)
    assert r["outcome"] is True


def test_btf_weighted_rate_by_amount():
    btf = pd.DataFrame(
        [
            {"auction_date": pd.Timestamp("2026-01-05"), "segment": "3 mois", "weighted_rate": 0.02, "amount_served": 1000.0},
            {"auction_date": pd.Timestamp("2026-01-05"), "segment": "3 mois", "weighted_rate": 0.03, "amount_served": 3000.0},
        ]
    )
    assert mk.btf_rate_series(btf, "3 mois").iloc[0] == pytest.approx(0.0275)


def test_oat_next_kind_alternates():
    d = mk.oat_dates(oat_frame())
    assert d.iloc[-1]["has_MT"] and not d.iloc[-1]["has_LT"]
    assert mk.next_kind(d) == "LT"


def test_oat_markets_target_next_long_term_date():
    oat = oat_frame()
    ms = mk.generate_oat(oat)
    assert {m["indicator"] for m in ms} == {"oat_cover", "oat_served"}
    assert all(m["params"]["kind"] == "LT" for m in ms)
    m = next(m for m in ms if m["indicator"] == "oat_served")
    ref = pd.Timestamp(m["reference_date"])
    # une date MT ne règle pas le marché
    mt = pd.DataFrame([{"auction_date": ref + pd.Timedelta(days=10), "auction_type": "adju_MT", "bid_amount": 1.0, "amount_served": 99999.0}])
    assert mk.resolve_market(m, pd.concat([oat, mt]), pd.DataFrame(), pd.DataFrame())["status"] == "open"
    lt = pd.DataFrame(
        [
            {"auction_date": ref + pd.Timedelta(days=20), "auction_type": "adju_LT", "bid_amount": 20000.0, "amount_served": 9000.0},
            {"auction_date": ref + pd.Timedelta(days=20), "auction_type": "adju_I", "bid_amount": 3000.0, "amount_served": 1000.0},
        ]
    )
    r = mk.resolve_market(m, pd.concat([oat, mt, lt]), pd.DataFrame(), pd.DataFrame())
    assert r["status"] == "resolved"
    assert r["resolved_value"] == 10000.0
    assert r["outcome"] is (10000.0 > m["threshold"])


def test_update_is_idempotent_and_keeps_resolved_markets():
    pm, btf, oat = pm_frame(), btf_frame(), oat_frame()
    first = mk.update_markets([], oat, btf, pm)
    assert first.created == len(first.markets) > 0 and first.resolved == 0
    again = mk.update_markets(first.markets, oat, btf, pm)
    assert again.created == 0 and again.markets == first.markets
    # nouvelle observation : les anciens marchés restent, de nouveaux s'ouvrent
    extra = pd.DataFrame({"date": pd.bdate_range(pm["date"].max() + pd.Timedelta(days=1), periods=25), "breakeven_bp": 200.0, "breakeven": 0.02})
    later = mk.update_markets(first.markets, oat, btf, pd.concat([pm, extra]))
    assert later.created > 0
    assert later.resolved > 0
    ids_before = {m["id"] for m in first.markets}
    assert ids_before <= {m["id"] for m in later.markets}
    kept = {m["id"]: m for m in later.markets}
    assert all(kept[i]["p0"] == m["p0"] for i, m in ((m["id"], m) for m in first.markets))
