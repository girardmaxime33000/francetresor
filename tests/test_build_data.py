import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_data as bd

# --- Parsing des lignes obligataires ---------------------------------------


@pytest.mark.parametrize(
    "text,family,coupon,maturity,label",
    [
        ("OAT 3,25% 25 février 2032", "OAT", 0.0325, (2032, 2, 25), "OAT 3,25% 25 février 2032"),
        ("OAT 4% 25 avril 2009", "OAT", 0.04, (2009, 4, 25), "OAT 4% 25 avril 2009"),
        ("OAT€i 2,1% 1 mars 2037", "OAT€i", 0.021, (2037, 3, 1), "OAT€i 2,1% 1 mars 2037"),
        ("OATi 0.1% 1 mars 2036", "OATi", 0.001, (2036, 3, 1), "OATi 0,1% 1 mars 2036"),
        ("BTAN 3,5% 12 juillet 2004", "BTAN", 0.035, (2004, 7, 12), "BTAN 3,5% 12 juillet 2004"),
        ("BTANi 0,45% 25 juillet 2016", "BTANi", 0.0045, (2016, 7, 25), "BTANi 0,45% 25 juillet 2016"),
        ("BTAN€i 1,25% 25 juillet 2010", "BTAN€i", 0.0125, (2010, 7, 25), "BTAN€i 1,25% 25 juillet 2010"),
        ("OAT 0% 25 mars 2024", "OAT", 0.0, (2024, 3, 25), "OAT 0% 25 mars 2024"),
        ("OAT 2.75% 25 février 2030", "OAT", 0.0275, (2030, 2, 25), "OAT 2,75% 25 février 2030"),
    ],
)
def test_parse_line(text, family, coupon, maturity, label):
    p = bd.parse_line(text)
    assert p.family == family
    assert p.coupon == pytest.approx(coupon)
    assert (p.maturity.year, p.maturity.month, p.maturity.day) == maturity
    assert p.label == label


def test_parse_tec10_has_no_coupon():
    p = bd.parse_line("OAT tec10 25 janvier 2009")
    assert p.family == "OAT TEC 10"
    assert p.coupon is None
    assert p.maturity.isoformat() == "2009-01-25"


def test_parse_line_rejects_unknown():
    with pytest.raises(ValueError):
        bd.parse_line("Obligation 3% 25 mars 2030")
    with pytest.raises(ValueError):
        bd.parse_line("OAT 3% 25 marsouin 2030")


def test_residual_maturity():
    m = pd.Series(pd.to_datetime(["2032-02-25"]))
    a = pd.Series(pd.to_datetime(["2022-02-25"]))
    assert bd.residual_maturity(m, a).iloc[0] == pytest.approx(10.0, abs=0.01)


# --- Regroupement des BTF ---------------------------------------------------


@pytest.mark.parametrize(
    "weeks,segment",
    [(1, "3 mois"), (12, "3 mois"), (13, "3 mois"), (14, "3 mois"), (15, "3 mois"), (16, "6 mois"), (21, "6 mois"), (27, "6 mois"), (30, "6 mois"), (31, "12 mois"), (48, "12 mois"), (52, "12 mois")],
)
def test_btf_segment(weeks, segment):
    assert bd.btf_segment(weeks) == segment


def test_btf_segment_missing():
    assert bd.btf_segment(float("nan")) is None


# --- Rebasage de la référence d'inflation et contrôle des coefficients -------


def _series(values, start="2020-01-01"):
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="D"))


def test_rebase_ratio_is_computed_not_hardcoded():
    new = _series([66.363, 66.4, 66.5, 66.7])
    old = new * 1.5
    ratio, ratios = bd.compute_rebase_ratio(old, new)
    assert ratio == pytest.approx(1.5)
    assert ratios.nunique() == 1


def test_rebase_ratio_uses_common_dates_only():
    new = _series([10.0, 20.0, 30.0], "2020-01-02")
    old = _series([99.0, 15.0, 30.0, 45.0], "2020-01-01")
    ratio, ratios = bd.compute_rebase_ratio(old, new)
    assert ratio == pytest.approx(1.5)
    assert len(ratios) == 3


def test_coefficient_gaps_zero_when_consistent():
    ref = _series([100.0, 101.0, 102.5])
    base = 100.6
    coef = (ref / base).round(5)
    assert bd.coefficient_gaps(coef, ref, base).max() == 0


def test_coefficient_gaps_detects_error():
    ref = _series([100.0, 101.0, 102.5])
    coef = (ref / 100.6).round(5)
    coef.iloc[1] += 0.0005
    gaps = bd.coefficient_gaps(coef, ref, 100.6)
    assert gaps.iloc[1] > bd.TOL_COEFFICIENT
    assert gaps.iloc[0] <= bd.TOL_COEFFICIENT


def test_coefficient_gaps_ignores_empty_cells():
    ref = _series([100.0, 101.0, 102.5])
    coef = pd.Series([None, 1.00398, None], index=ref.index, dtype=float)
    assert len(bd.coefficient_gaps(coef, ref, 100.6)) == 1


def test_security_id():
    sec = {"type": "OATi", "coupon": 0.0055, "maturity_date": pd.Timestamp("2039-03-01")}
    assert bd.security_id(sec) == "oati_0-55_20390301"


# --- Sélection du fichier le plus récent -------------------------------------


@pytest.mark.parametrize(
    "name,key",
    [
        ("2026-10_hist_mlt.xlsx", (2026, 10, 0)),
        ("2026_10_01_point_mort_inflation_oati.xls", (2026, 10, 1)),
        ("1999-2026_historique_syndications.xlsx", (2026, 12, 31)),
        ("coef_oati_histo_1998_2016.xls", (0, 0, 0)),
    ],
)
def test_date_prefix_key(name, key):
    assert bd.date_prefix_key(name) == key


def test_pick_latest(tmp_path):
    for n in ["2026-09_hist_mlt.xlsx", "2026-10_hist_mlt.xlsx", "2025-12_hist_mlt.xlsx", "2026-10_hist_btf.xlsx"]:
        (tmp_path / n).write_bytes(b"")
    assert bd.pick_latest(tmp_path, "mlt").name == "2026-10_hist_mlt.xlsx"
    assert bd.pick_latest(tmp_path, "btf").name == "2026-10_hist_btf.xlsx"


def test_pick_latest_separates_current_and_historical_coefficients(tmp_path):
    for n in ["coef_oati_histo_1998_2016.xls", "2026-09_coef_oati-novembre26.xls"]:
        (tmp_path / n).write_bytes(b"")
    assert bd.pick_latest(tmp_path, "coef_current").name == "2026-09_coef_oati-novembre26.xls"
    assert bd.pick_latest(tmp_path, "coef_histo").name == "coef_oati_histo_1998_2016.xls"


def test_pick_latest_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        bd.pick_latest(tmp_path, "mlt")


# --- Anomalies : toute anomalie non documentée bloque -----------------------


def test_undocumented_anomaly_is_blocking():
    rep = bd.DatasetReport("adjudications_btf")
    known = bd.KnownIssues(None)
    bd.flag_keys(rep, known, "offered_range", "Volume offert min ≤ max", ["2030-01-01|FR0000000000|2030-04-01"])
    assert rep.anomalies[0].level == "bloquante"


def test_documented_anomaly_is_warning():
    rep = bd.DatasetReport("adjudications_btf")
    known = bd.KnownIssues(None)
    k = ("adjudications_btf", "offered_range", "2030-01-01|FR0000000000|2030-04-01")
    known.tolerated[k] = "motif"
    bd.flag_keys(rep, known, "offered_range", "Volume offert min ≤ max", [k[2]])
    assert rep.anomalies[0].level == "avertissement"


def test_isin_format():
    assert bd.ISIN_RE.match("FR001400PM68")
    assert not bd.ISIN_RE.match("FR00140PM68")


# --- Intégration sur les fichiers fournis -----------------------------------

RAW = ROOT / "data" / "raw"


@pytest.mark.skipif(not RAW.exists() or not any(RAW.glob("*hist_mlt*")), reason="fichiers sources absents")
def test_full_build(tmp_path):
    report = bd.build(RAW, tmp_path / "out", tmp_path / "report.md")
    assert report.blocking == []
    out = tmp_path / "out"
    oat = json.loads((out / "adjudications_oat.json").read_text(encoding="utf-8"))
    assert oat["meta"]["record_count"] == len(oat["records"]) == 2308
    assert oat["meta"]["last_observation"] == "2026-09-17"
    assert set(oat["meta"]) >= {"source_file", "last_observation", "record_count", "generated_at"}
    btf = json.loads((out / "adjudications_btf.json").read_text(encoding="utf-8"))
    assert btf["meta"]["record_count"] == 4067
    synd = json.loads((out / "syndications.json").read_text(encoding="utf-8"))
    assert synd["meta"]["record_count"] == 45
    assert sum(1 for r in synd["records"] if r["operation"] == "rachat") == 2
    pm = json.loads((out / "point_mort_inflation.json").read_text(encoding="utf-8"))
    assert pm["meta"]["record_count"] == 1978
    assert pm["records"][-1] == {"date": "2026-10-01", "breakeven": 0.02024, "breakeven_bp": 202.4}
    ref = json.loads((out / "reference_inflation.json").read_text(encoding="utf-8"))
    assert ref["meta"]["rebase_ratio_previous_base"] == pytest.approx(1.509487, abs=1e-6)
    raw_csv = (out / "adjudications_oat.csv").read_bytes()
    assert raw_csv.startswith(b"\xef\xbb\xbf")
    assert b";" in raw_csv.splitlines()[0]
    assert (tmp_path / "report.md").read_text(encoding="utf-8").startswith("# Rapport de validation")
