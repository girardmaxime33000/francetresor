"""Marchés fictifs : génération, cotes initiales et règlement.

Projet éducatif. Les marchés portent sur des indicateurs publiés par l'AFT. Les jetons sont
virtuels, illimités et sans valeur. Les définitions de marchés et leurs règlements sont
conservés dans data/markets_state.json (versionné) et publiés dans public/data/marches.json.

Chaque marché est une question fermée (Oui si la valeur est strictement supérieure au seuil).
Le règlement est déterministe et reproductible à partir des fichiers sources.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

HORIZONS_DAYS = (14, 28)
QUANTILES = (0.25, 0.5, 0.75)
WINDOW_YEARS = 5
BTF_SEGMENTS = ("3 mois", "6 mois", "12 mois")
P_MIN, P_MAX = 0.03, 0.97
STATE_VERSION = 1


def _clamp(p: float) -> float:
    return round(float(min(P_MAX, max(P_MIN, p))), 4)


def _day(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def _thresholds(base: float, deltas: np.ndarray, digits: int) -> list[float]:
    """Seuils uniques arrondis, issus des quantiles d'une distribution de variations."""
    out: list[float] = []
    for q in QUANTILES:
        t = round(base + float(np.quantile(deltas, q)), digits)
        if t not in out:
            out.append(t)
    return out


# ---------------------------------------------------------------------------
# Séries de référence
# ---------------------------------------------------------------------------


def breakeven_series(pm: pd.DataFrame) -> pd.Series:
    s = pm.set_index("date")["breakeven_bp"].astype(float).sort_index()
    return s[~s.index.duplicated(keep="last")]


def btf_rate_series(btf: pd.DataFrame, segment: str) -> pd.Series:
    """Taux par date d'adjudication pour un segment, pondéré par le volume adjugé."""
    sub = btf[(btf["segment"] == segment) & btf["weighted_rate"].notna() & (btf["amount_served"] > 0)]
    g = sub.assign(w=sub["weighted_rate"] * sub["amount_served"]).groupby("auction_date")
    return (g["w"].sum() / g["amount_served"].sum()).sort_index()


def oat_dates(oat: pd.DataFrame) -> pd.DataFrame:
    """Une ligne par date d'adjudication d'OAT : couverture, volume adjugé, présence de types."""
    g = oat.groupby("auction_date")
    out = pd.DataFrame(
        {
            "cover": g["bid_amount"].sum() / g["amount_served"].sum(),
            "served": g["amount_served"].sum(),
            "has_LT": g["auction_type"].apply(lambda s: bool((s == "adju_LT").any())),
            "has_MT": g["auction_type"].apply(lambda s: bool((s == "adju_MT").any())),
        }
    ).sort_index()
    return out


def next_kind(dates: pd.DataFrame) -> str:
    """Type d'adjudication attendu : l'inverse de celui de la dernière date (LT par défaut)."""
    last = dates.iloc[-1]
    if last["has_MT"] and not last["has_LT"]:
        return "LT"
    if last["has_LT"] and not last["has_MT"]:
        return "MT"
    return "LT"


def _window(index: pd.Index, years: int = WINDOW_YEARS) -> pd.Timestamp:
    return pd.Timestamp(index.max()) - pd.DateOffset(years=years)


# ---------------------------------------------------------------------------
# Génération
# ---------------------------------------------------------------------------


def _market(**kw) -> dict:
    base = {
        "target_date": None,
        "status": "open",
        "outcome": None,
        "resolved_value": None,
        "resolved_date": None,
    }
    base.update(kw)
    return base


def generate_breakeven(pm: pd.DataFrame) -> list[dict]:
    s = breakeven_series(pm)
    ref = s.index.max()
    last = float(s.loc[ref])
    recent = s[s.index >= _window(s.index)]
    markets = []
    for h in HORIZONS_DAYS:
        targets = recent.index + pd.Timedelta(days=h)
        ok = targets <= s.index.max()
        if ok.sum() < 30:
            continue
        deltas = (s.asof(targets[ok]).to_numpy() - recent.to_numpy()[ok]).astype(float)
        for thr in _thresholds(last, deltas, 0):
            p0 = _clamp(float(np.mean(deltas > thr - last)))
            markets.append(
                _market(
                    id=f"pm-{_day(ref)}-h{h}-{int(thr)}",
                    indicator="breakeven",
                    params={"horizon_days": h},
                    threshold=float(thr),
                    reference_date=_day(ref),
                    target_date=_day(ref + pd.Timedelta(days=h)),
                    last_value=last,
                    p0=p0,
                    p0_sample=int(ok.sum()),
                )
            )
    return markets


def generate_btf(btf: pd.DataFrame) -> list[dict]:
    markets = []
    for seg in BTF_SEGMENTS:
        s = btf_rate_series(btf, seg)
        if len(s) < 60:
            continue
        ref = s.index.max()
        last = float(s.loc[ref])
        recent = s[s.index >= _window(s.index)]
        deltas = recent.diff().dropna().to_numpy()
        for thr in _thresholds(last, deltas, 4):
            p0 = _clamp(float(np.mean(deltas > thr - last)))
            markets.append(
                _market(
                    id=f"btf-{seg.split()[0]}m-{_day(ref)}-{round(thr * 10000)}",
                    indicator="btf_rate",
                    params={"segment": seg},
                    threshold=float(thr),
                    reference_date=_day(ref),
                    last_value=last,
                    p0=p0,
                    p0_sample=len(deltas),
                )
            )
    return markets


def generate_oat(oat: pd.DataFrame) -> list[dict]:
    d = oat_dates(oat)
    kind = next_kind(d)
    flag = f"has_{kind}"
    sub = d[d[flag]]
    ref = d.index.max()
    recent = sub[sub.index >= _window(d.index)]
    if len(recent) < 20:
        return []
    markets = []
    for metric, col, digits, step in (("cover", "cover", 2, 100), ("served", "served", 0, 100)):
        values = recent[col].to_numpy(dtype=float)
        if metric == "served":
            thr_list = sorted({round(float(np.quantile(values, q)) / step) * step for q in QUANTILES})
        else:
            thr_list = sorted({round(float(np.quantile(values, q)), digits) for q in QUANTILES})
        last = float(sub[col].iloc[-1])
        for thr in thr_list:
            p0 = _clamp(float(np.mean(values > thr)))
            markets.append(
                _market(
                    id=f"oat-{kind.lower()}-{metric}-{_day(ref)}-{round(thr * 100) if metric == 'cover' else int(thr)}",
                    indicator=f"oat_{metric}",
                    params={"kind": kind},
                    threshold=float(thr),
                    reference_date=_day(ref),
                    last_value=last,
                    p0=p0,
                    p0_sample=len(values),
                )
            )
    return markets


# ---------------------------------------------------------------------------
# Règlement
# ---------------------------------------------------------------------------


def resolve_market(m: dict, oat: pd.DataFrame, btf: pd.DataFrame, pm: pd.DataFrame) -> dict:
    """Règle un marché ouvert si la source contient l'observation concernée."""
    if m["status"] != "open":
        return m
    value = None
    obs_date = None
    ref = pd.Timestamp(m["reference_date"])
    if m["indicator"] == "breakeven":
        s = breakeven_series(pm)
        target = pd.Timestamp(m["target_date"])
        if s.index.max() >= target:
            obs_date = s.index[s.index <= target].max()
            value = float(s.loc[obs_date])
    elif m["indicator"] == "btf_rate":
        s = btf_rate_series(btf, m["params"]["segment"])
        later = s[s.index > ref]
        if len(later):
            obs_date = later.index[0]
            value = float(later.iloc[0])
    else:
        d = oat_dates(oat)
        col = "cover" if m["indicator"] == "oat_cover" else "served"
        later = d[(d.index > ref) & d[f"has_{m['params']['kind']}"]]
        if len(later):
            obs_date = later.index[0]
            value = float(later[col].iloc[0])
    if value is None:
        return m
    out = dict(m)
    out.update(
        status="resolved",
        outcome=bool(value > m["threshold"]),
        resolved_value=round(value, 6),
        resolved_date=_day(obs_date),
    )
    return out


# ---------------------------------------------------------------------------
# État persistant
# ---------------------------------------------------------------------------


@dataclass
class MarketsResult:
    markets: list[dict]
    created: int
    resolved: int


def update_markets(state: list[dict], oat: pd.DataFrame, btf: pd.DataFrame, pm: pd.DataFrame) -> MarketsResult:
    """Règle les marchés ouverts puis ouvre ceux de la dernière observation."""
    by_id = {m["id"]: m for m in state}
    resolved = 0
    for mid, m in list(by_id.items()):
        new = resolve_market(m, oat, btf, pm)
        if new["status"] != m["status"]:
            resolved += 1
        by_id[mid] = new
    created = 0
    for m in generate_breakeven(pm) + generate_btf(btf) + generate_oat(oat):
        if m["id"] not in by_id:
            by_id[m["id"]] = resolve_market(m, oat, btf, pm)
            created += 1
    markets = sorted(by_id.values(), key=lambda m: (m["status"] != "open", m["reference_date"], m["indicator"], m["id"]), reverse=False)
    return MarketsResult(markets, created, resolved)


def load_state(path: Path) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("markets", [])


def save_state(path: Path, markets: list[dict]) -> None:
    payload = {"version": STATE_VERSION, "markets": markets}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def publish(out_dir: Path, markets: list[dict], generated_at: str) -> dict:
    refs = [m["reference_date"] for m in markets] or [""]
    meta = {
        "dataset": "marches",
        "title": "Marchés fictifs",
        "source_file": "data/markets_state.json",
        "first_observation": min(refs),
        "last_observation": max(refs),
        "record_count": len(markets),
        "generated_at": generated_at,
        "open_count": sum(1 for m in markets if m["status"] == "open"),
        "resolved_count": sum(1 for m in markets if m["status"] == "resolved"),
        "liquidity": 250,
    }
    (out_dir / "marches.json").write_text(json.dumps({"meta": meta, "records": markets}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return meta
