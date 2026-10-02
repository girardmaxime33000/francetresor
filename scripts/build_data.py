#!/usr/bin/env python3
"""Pipeline de données : lit les fichiers bruts de data/raw/, valide, normalise
et écrit les jeux JSON et CSV dans public/data/ ainsi que le rapport de
validation data/validation_report.md.

Usage : python scripts/build_data.py [--raw data/raw] [--out public/data]
Code de sortie 1 si une anomalie bloquante est relevée.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Constantes de méthode
# ---------------------------------------------------------------------------

TOL_BID_TO_COVER = 0.01
TOL_COEFFICIENT = 1e-5
TOL_REBASE_RELATIVE = 5e-5
TOL_BREAKEVEN_BP = 0.051

MONTHS_FR = {
    "janvier": 1,
    "février": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "août": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "décembre": 12,
}

BTF_SEGMENTS = (
    (15, "3 mois"),
    (30, "6 mois"),
    (10**6, "12 mois"),
)

AUCTION_TYPE_LABELS = {
    "adju_LT": "Long terme",
    "adju_MT": "Moyen terme",
    "adju_I": "Indexées",
    "adju_MLT": "Moyen et long terme",
}
SYNDICATION_TYPE_LABELS = {"synd_LT": "Long terme", "synd_I": "Indexées"}

# ---------------------------------------------------------------------------
# Schémas des fichiers sources : (position, libellé français attendu, identifiant, type)
# ---------------------------------------------------------------------------

MLT_SCHEMA = [
    (0, "type d'adjudication", "auction_type", "str"),
    (1, "date d'adjudication", "auction_date", "date"),
    (2, "date de règlement", "settlement_date", "date"),
    (3, "volume offert - min", "offered_min", "num"),
    (4, "volume offert - max", "offered_max", "num"),
    (5, "code ISIN", "isin", "str"),
    (6, "ligne", "line", "str"),
    (7, "volume des soumissions", "bid_amount", "num"),
    (8, "volume adjugé", "amount_served", "num"),
    (9, "ratio de couverture", "bid_to_cover", "num"),
    (10, "ONC après adjudication", "nct_amount", "num"),
    (11, "volume total émis", "total_issued", "num"),
    (12, "taux moyen pondéré", "weighted_rate", "num"),
    (13, "prix moyen pondéré", "weighted_price", "num"),
    (14, "coefficient d'indexation", "index_ratio", "num"),
]
BTF_SCHEMA = [
    (0, "date d'adjudication", "auction_date", "date"),
    (1, "date de règlement", "settlement_date", "date"),
    (2, "durée (semaines)", "term_weeks", "num"),
    (3, "date d'échéance", "maturity_date", "date"),
    (4, "volume offert - min", "offered_min", "num"),
    (5, "volume offert - max", "offered_max", "num"),
    (6, "code ISIN", "isin", "str"),
    (7, "volume des soumissions", "bid_amount", "num"),
    (8, "volume adjugé", "amount_served", "num"),
    (9, "ratio de couverture", "bid_to_cover", "num"),
    (10, "ONC après adjudication", "nct_amount", "num"),
    (11, "volume total émis", "total_issued", "num"),
    (12, "taux moyen pondéré", "weighted_rate", "num"),
]
SYND_SCHEMA = [
    (0, "type de syndication", "syndication_type", "str"),
    (2, "date de règlement", "settlement_date", "date"),
    (4, None, "maturity_year", "num"),
    (5, "code ISIN", "isin", "str"),
    (6, "ligne", "line", "str"),
    (11, "volume émis(+) ou racheté(-)", "amount", "num"),
    (12, "taux moyen pondéré", "weighted_rate", "num"),
    (13, "prix moyen pondéré", "weighted_price", "num"),
    (14, "coefficient d'indexation", "index_ratio", "num"),
]
SYND_EMPTY_COLUMNS = (1, 3, 7, 8, 9, 10)

# ---------------------------------------------------------------------------
# Dictionnaire des variables publiées
# ---------------------------------------------------------------------------

_COMMON_OAT = [
    ("auction_type", "Type d'adjudication", "", "adju_LT (long terme), adju_MT (moyen terme), adju_I (indexées), adju_MLT (moyen et long terme)."),
    ("auction_date", "Date d'adjudication", "date", "Date de l'adjudication."),
    ("settlement_date", "Date de règlement", "date", "Date de règlement-livraison."),
    ("offered_min", "Volume offert, minimum", "M€", "Borne basse de la fourchette de volume offert."),
    ("offered_max", "Volume offert, maximum", "M€", "Borne haute de la fourchette de volume offert."),
    ("isin", "Code ISIN", "", "Identifiant international de la ligne."),
    ("line", "Ligne", "", "Libellé de la ligne tel que publié dans la source."),
    ("bid_amount", "Volume des soumissions", "M€", "Montant total des offres reçues."),
    ("amount_served", "Volume adjugé", "M€", "Montant adjugé lors de l'adjudication."),
    ("bid_to_cover", "Ratio de couverture", "", "Volume des soumissions rapporté au volume adjugé."),
    ("nct_amount", "ONC après adjudication", "M€", "Offres non compétitives servies après l'adjudication."),
    ("total_issued", "Volume total émis", "M€", "Volume adjugé et ONC."),
]
DICTIONARY = {
    "adjudications_oat": _COMMON_OAT
    + [
        ("weighted_rate", "Taux moyen pondéré", "décimal", "Rendement moyen pondéré (0,0392 pour 3,92 %). Rendement réel pour les titres indexés. Absent pour les OAT TEC 10."),
        ("weighted_price", "Prix moyen pondéré", "fraction du nominal", "0,9675 pour 96,75 % du pair."),
        ("index_ratio", "Coefficient d'indexation", "", "Coefficient d'indexation à la date de règlement. Absent pour les titres nominaux."),
        ("instrument_family", "Famille d'instrument", "", "Déduit de la ligne : OAT, OATi, OAT€i, BTAN, BTANi, BTAN€i, OAT TEC 10, OAT verte."),
        ("coupon", "Coupon", "décimal", "Coupon annuel déduit de la ligne. Absent pour les OAT TEC 10."),
        ("maturity_date", "Date d'échéance", "date", "Déduite de la ligne."),
        ("residual_maturity_years", "Maturité résiduelle à l'adjudication", "années", "(date d'échéance − date d'adjudication) / 365,25."),
        ("index_type", "Indice d'indexation", "", "inflation_france (OATi, BTANi) ou inflation_zone_euro (OAT€i, BTAN€i). Vide pour les titres nominaux."),
        ("line_label", "Libellé normalisé", "", "Ligne avec virgule décimale."),
    ],
    "adjudications_btf": [
        ("auction_date", "Date d'adjudication", "date", "Date de l'adjudication."),
        ("settlement_date", "Date de règlement", "date", "Date de règlement-livraison."),
        ("term_weeks", "Durée", "semaines", "Durée du BTF à l'émission."),
        ("maturity_date", "Date d'échéance", "date", "Date d'échéance du BTF."),
        ("offered_min", "Volume offert, minimum", "M€", "Borne basse de la fourchette de volume offert."),
        ("offered_max", "Volume offert, maximum", "M€", "Borne haute de la fourchette de volume offert."),
        ("isin", "Code ISIN", "", "Identifiant international de la ligne."),
        ("bid_amount", "Volume des soumissions", "M€", "Montant total des offres reçues."),
        ("amount_served", "Volume adjugé", "M€", "Montant adjugé lors de l'adjudication."),
        ("bid_to_cover", "Ratio de couverture", "", "Volume des soumissions rapporté au volume adjugé."),
        ("nct_amount", "ONC après adjudication", "M€", "Offres non compétitives servies après l'adjudication."),
        ("total_issued", "Volume total émis", "M€", "Volume adjugé et ONC."),
        ("weighted_rate", "Taux moyen pondéré", "décimal", "Taux moyen pondéré (0,0302 pour 3,02 %)."),
        ("segment", "Segment", "", "3 mois (15 semaines ou moins), 6 mois (16 à 30 semaines), 12 mois (31 semaines ou plus)."),
    ],
    "syndications": [
        ("syndication_type", "Type de syndication", "", "synd_LT (long terme), synd_I (indexées)."),
        ("settlement_date", "Date de règlement", "date", "Date de règlement-livraison."),
        ("maturity_year", "Année d'échéance", "année", "Année d'échéance de la ligne."),
        ("isin", "Code ISIN", "", "Identifiant international de la ligne."),
        ("line", "Ligne", "", "Libellé de la ligne tel que publié dans la source."),
        ("amount", "Volume émis ou racheté", "M€", "Positif pour une émission, négatif pour un rachat effectué dans le cadre d'une opération d'échange."),
        ("weighted_rate", "Taux moyen pondéré", "décimal", "Rendement moyen pondéré."),
        ("weighted_price", "Prix moyen pondéré", "fraction du nominal", "Prix moyen pondéré."),
        ("index_ratio", "Coefficient d'indexation", "", "Coefficient d'indexation à la date de règlement. Absent pour les titres nominaux."),
        ("operation", "Nature de l'opération", "", "emission ou rachat, déduite du signe du volume."),
        ("instrument_family", "Famille d'instrument", "", "Déduit de la ligne."),
        ("coupon", "Coupon", "décimal", "Coupon annuel déduit de la ligne."),
        ("maturity_date", "Date d'échéance", "date", "Déduite de la ligne."),
        ("line_label", "Libellé normalisé", "", "Ligne avec virgule décimale."),
    ],
    "point_mort_inflation": [
        ("date", "Date", "date", "Jour ouvré d'observation."),
        ("breakeven", "Point mort d'inflation à 10 ans", "décimal", "Écart de rendement OAT 05/36 − OATi 03/36 (0,02024 pour 202,4 pb)."),
        ("breakeven_bp", "Point mort d'inflation à 10 ans", "points de base", "Même valeur en points de base."),
    ],
    "reference_inflation": [
        ("date", "Date", "date", "Jour calendaire."),
        ("daily_reference", "Référence quotidienne d’inflation", "indice", "Base du fichier le plus récent (indice des prix hors tabac). Les valeurs publiées en base antérieure sont converties par le rapport constant calculé sur la période commune."),
    ],
    "coefficients_indexation": [
        ("date", "Date", "date", "Jour calendaire."),
        ("daily_reference", "Référence quotidienne d'inflation", "indice", "Base du fichier le plus récent."),
        ("<identifiant du titre>", "Coefficient d'indexation du titre", "", "Un champ par titre, nommé type_coupon_échéance. Vide avant la date de référence et après l'échéance. Valeurs publiées, jamais converties. Le JSON est organisé en colonnes (bloc columns) pour limiter son poids."),
    ],
}

DATASET_TITLES = {
    "adjudications_oat": "Adjudications d’OAT moyen et long terme",
    "adjudications_btf": "Adjudications de BTF",
    "syndications": "Syndications",
    "point_mort_inflation": "Point mort d’inflation à 10 ans",
    "reference_inflation": "Référence quotidienne d’inflation",
    "coefficients_indexation": "Coefficients d’indexation des OATi",
}

# ---------------------------------------------------------------------------
# Rapport de validation
# ---------------------------------------------------------------------------


@dataclass
class Anomaly:
    level: str  # "bloquante" ou "avertissement"
    check: str
    count: int
    detail: str = ""
    examples: list[str] = field(default_factory=list)


@dataclass
class DatasetReport:
    name: str
    source: str = ""
    rows_read: int = 0
    rows_rejected: int = 0
    rows_published: int = 0
    notes: list[str] = field(default_factory=list)
    anomalies: list[Anomaly] = field(default_factory=list)

    def flag(self, level, check, count, detail="", examples=None):
        if count:
            self.anomalies.append(Anomaly(level, check, int(count), detail, list(examples or [])[:5]))

    def note(self, text):
        self.notes.append(text)


class Report:
    def __init__(self):
        self.datasets: dict[str, DatasetReport] = {}
        self.global_notes: list[str] = []

    def dataset(self, name):
        self.datasets[name] = DatasetReport(name)
        return self.datasets[name]

    @property
    def blocking(self):
        return [(d.name, a) for d in self.datasets.values() for a in d.anomalies if a.level == "bloquante"]

    def render(self, generated_at: str) -> str:
        out = ["# Rapport de validation des données", "", f"Généré le {generated_at}.", ""]
        out.append(f"Anomalies bloquantes : {len(self.blocking)}.")
        out.append("")
        out.append("| Jeu | Fichier source | Lignes lues | Lignes rejetées | Lignes publiées | Anomalies bloquantes | Avertissements |")
        out.append("|---|---|---:|---:|---:|---:|---:|")
        for d in self.datasets.values():
            nb = sum(1 for a in d.anomalies if a.level == "bloquante")
            nw = sum(1 for a in d.anomalies if a.level == "avertissement")
            out.append(f"| {d.name} | {d.source} | {d.rows_read} | {d.rows_rejected} | {d.rows_published} | {nb} | {nw} |")
        out.append("")
        for text in self.global_notes:
            out.append(text)
            out.append("")
        for d in self.datasets.values():
            out.append(f"## {d.name}")
            out.append("")
            out.append(f"Source : {d.source}")
            out.append("")
            for n in d.notes:
                out.append(f"- {n}")
            if d.notes:
                out.append("")
            if d.anomalies:
                out.append("| Niveau | Contrôle | Occurrences | Détail |")
                out.append("|---|---|---:|---|")
                for a in d.anomalies:
                    ex = (" Exemples : " + " ; ".join(a.examples)) if a.examples else ""
                    detail = (a.detail + ex).replace("|", "/").replace("\n", " ")
                    out.append(f"| {a.level} | {a.check} | {a.count} | {detail} |")
            else:
                out.append("Aucune anomalie.")
            out.append("")
        return "\n".join(out)


# ---------------------------------------------------------------------------
# Anomalies connues de la source (data/known_issues.json)
# ---------------------------------------------------------------------------


class KnownIssues:
    """Anomalies de la source constatées et documentées.

    « tolerated » : l'anomalie est publiée telle quelle et ne bloque pas le build.
    « corrections » : valeur corrigée, motif obligatoire, rappelée dans le rapport.
    Toute anomalie absente du fichier reste bloquante."""

    def __init__(self, path: Path | None):
        data = json.loads(path.read_text(encoding="utf-8")) if path and path.exists() else {}
        self.tolerated = {(e["dataset"], e["check"], e["key"]): e["reason"] for e in data.get("tolerated", [])}
        self.corrections = data.get("corrections", [])
        self.used: set = set()


def row_keys(df: pd.DataFrame, extra: str) -> pd.Series:
    """Clé de ligne : date | ISIN | discriminant (échéance ou volume)."""
    date_col = "auction_date" if "auction_date" in df else "settlement_date"
    d = df[date_col].dt.strftime("%Y-%m-%d")
    isin = df["isin"].fillna("")
    if extra == "maturity":
        disc = df["maturity_date"].dt.strftime("%Y-%m-%d")
    else:
        disc = df["amount"].map(lambda v: f"{v:g}")
    return d + "|" + isin + "|" + disc


def apply_corrections(df: pd.DataFrame, rep: DatasetReport, known: KnownIssues, extra: str) -> pd.DataFrame:
    todo = [c for c in known.corrections if c["dataset"] == rep.name]
    if not todo:
        return df
    df = df.copy()
    keys = row_keys(df, extra)
    for c in todo:
        mask = keys == c["key"]
        if mask.any() and (df.loc[mask, c["field"]] == c["from"]).all():
            df.loc[mask, c["field"]] = c["to"]
            rep.note(f"Correction documentée sur {int(mask.sum())} ligne(s) ({c['key']}) : {c['field']} « {c['from']} » remplacé par « {c['to']} ». Motif : {c['reason']}")
    return df


def flag_keys(rep: DatasetReport, known: KnownIssues, check_id: str, label: str, keys, detail: str = ""):
    keys = list(keys)
    new = [k for k in keys if (rep.name, check_id, k) not in known.tolerated]
    old = [k for k in keys if (rep.name, check_id, k) in known.tolerated]
    rep.flag("bloquante", label, len(new), detail, new)
    if old:
        reasons = sorted({known.tolerated[(rep.name, check_id, k)] for k in old})
        rep.flag("avertissement", f"{label} (anomalie de la source documentée)", len(old), " ".join(reasons), old)


# ---------------------------------------------------------------------------
# Sélection et lecture des fichiers
# ---------------------------------------------------------------------------

DATASET_PATTERNS = {
    "mlt": re.compile(r"hist_mlt\.xlsx?$"),
    "btf": re.compile(r"hist_btf\.xlsx?$"),
    "synd": re.compile(r"historique_syndications\.xlsx?$"),
    "point_mort": re.compile(r"point_mort_inflation_oati\.xlsx?$"),
    "coef_current": re.compile(r"^(?!.*histo).*coef_oati.*\.xlsx?$"),
    "coef_histo": re.compile(r"coef_oati_histo.*\.xlsx?$"),
}


def date_prefix_key(name: str) -> tuple[int, int, int]:
    """Clé de tri issue du préfixe de date du nom de fichier.

    Formes reconnues : AAAA-MM-JJ, AAAA_MM_JJ, AAAA-MM, AAAA-AAAA (année de fin
    retenue), AAAA. Sans préfixe exploitable, la clé est (0, 0, 0).
    """
    m = re.match(r"^(\d{4})-(\d{4})(?=\D|$)", name)
    if m:
        return (int(m.group(2)), 12, 31)
    m = re.match(r"^(\d{4})(?:[-_](\d{2}))?(?:[-_](\d{2}))?", name)
    if not m:
        return (0, 0, 0)
    year = int(m.group(1))
    month = int(m.group(2) or 0)
    day = int(m.group(3) or 0)
    if not 0 <= month <= 12:
        return (year, 0, 0)
    return (year, month, day if 0 <= day <= 31 else 0)


def pick_latest(raw_dir: Path, key: str) -> Path:
    pattern = DATASET_PATTERNS[key]
    files = [p for p in raw_dir.iterdir() if p.is_file() and pattern.search(p.name)]
    if not files:
        raise FileNotFoundError(f"Aucun fichier source pour « {key} » dans {raw_dir}")
    return max(files, key=lambda p: (date_prefix_key(p.name), p.name))


def read_sheet(path: Path, sheet: str) -> pd.DataFrame:
    """Lit une feuille sans en-tête. Le format est détecté sur le contenu du
    fichier et non sur son extension."""
    with open(path, "rb") as fh:
        magic = fh.read(4)
    engine = "openpyxl" if magic[:2] == b"PK" else "xlrd"
    return pd.read_excel(path, sheet_name=sheet, header=None, engine=engine)


def normalize_label(value) -> str:
    if not isinstance(value, str):
        return ""
    first = value.split("\n")[0]
    first = first.replace("’", "'").replace("–", "-").replace("−", "-")
    return re.sub(r"\s+", " ", first).strip().lower()


def apply_schema(df: pd.DataFrame, schema, rep: DatasetReport) -> pd.DataFrame:
    """Contrôle le schéma (libellés et ordre) et renvoie un DataFrame typé."""
    header = df.iloc[0]
    missing = []
    for pos, label, ident, _ in schema:
        if pos >= df.shape[1]:
            missing.append(f"colonne {pos} absente ({ident})")
            continue
        found = normalize_label(header.iloc[pos])
        if label is None:
            if found:
                missing.append(f"colonne {pos} : en-tête inattendu « {found} »")
        elif found != normalize_label(label):
            missing.append(f"colonne {pos} : attendu « {label} », trouvé « {found} »")
    rep.flag("bloquante", "Schéma : libellés et ordre des colonnes", len(missing), "; ".join(missing))
    if missing:
        return pd.DataFrame()
    body = df.iloc[1:].copy()
    out = pd.DataFrame(index=body.index)
    for pos, _, ident, kind in schema:
        col = body.iloc[:, pos]
        if kind == "date":
            out[ident] = pd.to_datetime(col, errors="coerce")
            bad = col.notna() & out[ident].isna()
            rep.flag("bloquante", f"Type : date illisible ({ident})", bad.sum())
        elif kind == "num":
            out[ident] = pd.to_numeric(col, errors="coerce")
            bad = col.notna() & out[ident].isna()
            rep.flag("bloquante", f"Type : nombre illisible ({ident})", bad.sum())
        else:
            out[ident] = col.map(lambda v: v.strip() if isinstance(v, str) else v)
    return out


def drop_empty_rows(df: pd.DataFrame, rep: DatasetReport) -> pd.DataFrame:
    empty = df.isna().all(axis=1)
    rep.rows_rejected += int(empty.sum())
    if empty.any():
        rep.note(f"{int(empty.sum())} ligne(s) entièrement vide(s) rejetée(s).")
    return df[~empty].reset_index(drop=True)


# ---------------------------------------------------------------------------
# Parsing des lignes obligataires
# ---------------------------------------------------------------------------

LINE_RE = re.compile(
    r"^(?P<fam>BTAN€i|BTANi|BTAN|OAT€i|OATi|OAT)\s+"
    r"(?:(?P<coupon>\d+(?:[.,]\d+)?)\s*%\s+)?"
    r"(?P<day>\d{1,2})(?:er)?\s+(?P<month>[a-zéûè]+)\s+(?P<year>\d{4})$",
    re.IGNORECASE,
)
TEC_RE = re.compile(r"^OAT\s*tec\s*10\s+(?P<day>\d{1,2})(?:er)?\s+(?P<month>[a-zéûè]+)\s+(?P<year>\d{4})$", re.IGNORECASE)
INDEX_TYPE = {
    "OATi": "inflation_france",
    "BTANi": "inflation_france",
    "OAT€i": "inflation_zone_euro",
    "BTAN€i": "inflation_zone_euro",
}


@dataclass(frozen=True)
class ParsedLine:
    family: str
    coupon: float | None
    maturity: dt.date
    label: str


def parse_line(text: str) -> ParsedLine:
    """Déduit famille, coupon et échéance d'une ligne obligataire.

    Lève ValueError si le libellé n'est pas reconnu."""
    s = re.sub(r"\s+", " ", text).strip()
    tec = TEC_RE.match(s)
    if tec:
        fam, coupon, m = "OAT TEC 10", None, tec
    else:
        m = LINE_RE.match(s)
        if not m:
            raise ValueError(f"Ligne non reconnue : {text!r}")
        fam = m.group("fam")
        fam = {"OAT€I": "OAT€i", "OATI": "OATi", "BTANI": "BTANi", "BTAN€I": "BTAN€i"}.get(fam.upper(), fam)
        coupon = round(float(m.group("coupon").replace(",", ".")) / 100, 6) if m.group("coupon") else None
    month = MONTHS_FR.get(m.group("month").lower())
    if month is None:
        raise ValueError(f"Mois non reconnu dans {text!r}")
    maturity = dt.date(int(m.group("year")), month, int(m.group("day")))
    if re.search(r"\bverte\b", s, re.IGNORECASE):
        fam = "OAT verte"
    label = s.replace(".", ",") if fam != "OAT TEC 10" else "OAT TEC 10 " + f"{maturity.day} {m.group('month').lower()} {maturity.year}"
    return ParsedLine(fam, coupon, maturity, label)


def derive_line_columns(df: pd.DataFrame, rep: DatasetReport, date_col: str) -> pd.DataFrame:
    fam, cpn, mat, lab = [], [], [], []
    errors = []
    for line in df["line"]:
        try:
            p = parse_line(line)
            fam.append(p.family)
            cpn.append(p.coupon)
            mat.append(pd.Timestamp(p.maturity))
            lab.append(p.label)
        except (ValueError, TypeError) as exc:
            errors.append(str(exc))
            fam.append(None)
            cpn.append(None)
            mat.append(pd.NaT)
            lab.append(None)
    rep.flag("bloquante", "Parsing de la ligne obligataire", len(errors), examples=errors)
    df = df.copy()
    df["instrument_family"] = fam
    df["coupon"] = cpn
    df["maturity_date"] = pd.to_datetime(pd.Series(mat, index=df.index))
    df["line_label"] = lab
    return df


def residual_maturity(maturity: pd.Series, reference: pd.Series) -> pd.Series:
    return ((maturity - reference).dt.days / 365.25).round(3)


def btf_segment(weeks) -> str | None:
    if weeks is None or (isinstance(weeks, float) and math.isnan(weeks)):
        return None
    for upper, label in BTF_SEGMENTS:
        if weeks <= upper:
            return label
    return None


# ---------------------------------------------------------------------------
# Contrôles de cohérence communs
# ---------------------------------------------------------------------------


ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


def common_checks(df: pd.DataFrame, rep: DatasetReport, known: KnownIssues, keys: pd.Series, key_cols: list[str]):
    fk = lambda mask: list(keys[mask])
    dup = df.duplicated(subset=key_cols, keep=False)
    flag_keys(rep, known, "duplicate_key", f"Doublons (clé : {' + '.join(key_cols)})", fk(dup))
    served = df["amount_served"]
    bid = df["bid_amount"]
    ok = served.notna() & bid.notna() & (served > 0) & df["bid_to_cover"].notna()
    gap = (df["bid_to_cover"] - bid / served).abs()
    flag_keys(rep, known, "bid_to_cover", f"Ratio de couverture ≈ soumissions / adjugé (tolérance {TOL_BID_TO_COVER})", fk(ok & (gap > TOL_BID_TO_COVER + 1e-9)))
    both = df["total_issued"].notna() & served.notna() & df["nct_amount"].notna()
    flag_keys(rep, known, "total_issued", "Volume total émis = volume adjugé + ONC", fk(both & ((df["total_issued"] - served - df["nct_amount"]).abs() > 0.5)))
    mm = df["offered_min"].notna() & df["offered_max"].notna() & (df["offered_min"] > df["offered_max"])
    flag_keys(rep, known, "offered_range", "Volume offert min ≤ max", fk(mm))
    sd = df["settlement_date"].notna() & (df["settlement_date"] <= df["auction_date"])
    flag_keys(rep, known, "settlement_order", "Date de règlement postérieure à la date d'adjudication", fk(sd))
    flag_keys(rep, known, "missing_key", "Date d'adjudication ou ISIN manquant", fk(df["auction_date"].isna() | df["isin"].isna()))
    bad_isin = df["isin"].notna() & ~df["isin"].astype(str).str.match(ISIN_RE)
    flag_keys(rep, known, "isin_format", "Format du code ISIN (12 caractères)", fk(bad_isin))


# ---------------------------------------------------------------------------
# Jeux de données
# ---------------------------------------------------------------------------


def build_oat(raw_dir: Path, report: Report, known: KnownIssues):
    path = pick_latest(raw_dir, "mlt")
    rep = report.dataset("adjudications_oat")
    rep.source = path.name
    raw = read_sheet(path, "MLT")
    rep.rows_read = len(raw) - 1
    df = apply_schema(raw, MLT_SCHEMA, rep)
    if df.empty:
        return None, path
    extra = raw.iloc[1:, 15:]
    rep.flag("bloquante", "Colonnes 15 et suivantes attendues vides", int(extra.notna().any(axis=1).sum()))
    df = drop_empty_rows(df, rep)
    df = derive_line_columns(df, rep, "auction_date")
    df = apply_corrections(df, rep, known, "maturity")
    common_checks(df, rep, known, row_keys(df, "maturity"), ["auction_date", "isin"])
    bad_types = ~df["auction_type"].isin(AUCTION_TYPE_LABELS)
    rep.flag("bloquante", "Type d'adjudication inconnu", bad_types.sum(), examples=df.loc[bad_types, "auction_type"].unique())
    df["residual_maturity_years"] = residual_maturity(df["maturity_date"], df["auction_date"])
    df["index_type"] = df["instrument_family"].map(INDEX_TYPE)
    nom = ~df["instrument_family"].isin(INDEX_TYPE)
    df.loc[df["index_ratio"] == 0, "index_ratio"] = pd.NA
    df["index_ratio"] = pd.to_numeric(df["index_ratio"])
    neg = (df["residual_maturity_years"] < 0).sum()
    rep.flag("bloquante", "Échéance antérieure à la date d'adjudication", neg)
    miss_rate = df[df["weighted_rate"].isna()]
    rep.note(f"{len(miss_rate)} ligne(s) sans taux moyen pondéré, familles : {', '.join(sorted(miss_rate['instrument_family'].unique())) or 'aucune'}.")
    unexpected = miss_rate[miss_rate["instrument_family"] != "OAT TEC 10"]
    rep.flag("avertissement", "Taux moyen pondéré absent hors OAT TEC 10", len(unexpected))
    ratio_zero = df[(df["index_ratio"].notna()) & nom]
    rep.flag("avertissement", "Coefficient d'indexation renseigné sur un titre nominal", len(ratio_zero))
    rep.note("Valeur 0 du coefficient d'indexation sur les titres nominaux convertie en valeur vide.")
    rep.note("Répartition par type : " + ", ".join(f"{k} {v}" for k, v in df["auction_type"].value_counts().items()) + ".")
    rep.note("Répartition par famille : " + ", ".join(f"{k} {v}" for k, v in df["instrument_family"].value_counts().items()) + ".")
    n_lines = df["line"].nunique()
    n_isin = df["isin"].nunique()
    n_labels = df["line_label"].nunique()
    rep.note(f"{n_isin} codes ISIN distincts, {n_lines} libellés de ligne distincts dans la source, {n_labels} libellés distincts après normalisation de la virgule décimale.")
    multi = df.groupby("isin")["line_label"].nunique()
    rep.flag("bloquante", "Un ISIN associé à plusieurs libellés normalisés", (multi > 1).sum(), examples=list(multi[multi > 1].index))
    multi2 = df.groupby("line_label")["isin"].nunique()
    rep.flag("avertissement", "Un libellé normalisé associé à plusieurs ISIN", (multi2 > 1).sum(), examples=list(multi2[multi2 > 1].index))
    df = df.sort_values(["auction_date", "isin"]).reset_index(drop=True)
    rep.rows_published = len(df)
    return df, path


def build_btf(raw_dir: Path, report: Report, known: KnownIssues):
    path = pick_latest(raw_dir, "btf")
    rep = report.dataset("adjudications_btf")
    rep.source = path.name
    raw = read_sheet(path, "BTF")
    rep.rows_read = len(raw) - 1
    df = apply_schema(raw, BTF_SCHEMA, rep)
    if df.empty:
        return None, path
    df = drop_empty_rows(df, rep)
    df = apply_corrections(df, rep, known, "maturity")
    common_checks(df, rep, known, row_keys(df, "maturity"), ["auction_date", "isin"])
    per_isin = df.dropna(subset=["isin"]).groupby("isin")["maturity_date"].nunique()
    rep.flag("avertissement", "Un ISIN associé à plusieurs échéances dans la source", int((per_isin > 1).sum()), "Opérations publiées sans modification.", list(per_isin[per_isin > 1].index))
    df["segment"] = df["term_weeks"].map(btf_segment)
    rep.flag("bloquante", "Durée en semaines non classable", df["segment"].isna().sum())
    weeks = df["term_weeks"].astype("Int64")
    rep.note("Durées en semaines présentes : " + ", ".join(str(w) for w in sorted(weeks.dropna().unique())) + ".")
    for _, label in BTF_SEGMENTS:
        sub = df[df["segment"] == label]
        if len(sub):
            rep.note(f"Segment {label} : {len(sub)} adjudications, durées de {int(sub['term_weeks'].min())} à {int(sub['term_weeks'].max())} semaines.")
    rep.flag("avertissement", "Taux moyen pondéré absent", df["weighted_rate"].isna().sum())
    mat = (df["maturity_date"] - df["settlement_date"]).dt.days / 7
    gap = (mat - df["term_weeks"]).abs()
    rep.flag("avertissement", "Durée en semaines différente de (échéance − règlement), écart supérieur à 1 semaine", (gap > 1).sum(), examples=[f"{r.auction_date:%d/%m/%Y} {r.isin} : {r.term_weeks} semaines" for r in df[gap > 1].head(5).itertuples()])
    df = df.sort_values(["auction_date", "isin"]).reset_index(drop=True)
    rep.rows_published = len(df)
    return df, path


def build_synd(raw_dir: Path, report: Report, known: KnownIssues):
    path = pick_latest(raw_dir, "synd")
    rep = report.dataset("syndications")
    rep.source = path.name
    raw = read_sheet(path, "syndic")
    rep.rows_read = len(raw) - 1
    df = apply_schema(raw, SYND_SCHEMA, rep)
    if df.empty:
        return None, path
    stray = raw.iloc[1:, list(SYND_EMPTY_COLUMNS)]
    rep.flag("bloquante", "Colonnes 1, 3, 7 à 10 attendues vides", int(stray.notna().any(axis=1).sum()))
    df = drop_empty_rows(df, rep)
    df = derive_line_columns(df, rep, "settlement_date")
    dup = df.duplicated(subset=["settlement_date", "isin"], keep=False)
    flag_keys(rep, known, "duplicate_key", "Doublons (clé : date de règlement + ISIN)", row_keys(df, "amount")[dup])
    bad_isin = ~df["isin"].astype(str).str.match(ISIN_RE)
    flag_keys(rep, known, "isin_format", "Format du code ISIN (12 caractères)", row_keys(df, "amount")[bad_isin])
    bad_types = ~df["syndication_type"].isin(SYNDICATION_TYPE_LABELS)
    rep.flag("bloquante", "Type de syndication inconnu", bad_types.sum())
    df["operation"] = df["amount"].map(lambda v: "rachat" if v < 0 else "emission")
    ym = df["maturity_date"].dt.year != df["maturity_year"]
    rep.flag("bloquante", "Année d'échéance différente de celle de la ligne", ym.sum(), examples=[f"{r.settlement_date:%d/%m/%Y} {r.isin}" for r in df[ym].itertuples()])
    rep.flag("bloquante", "Volume manquant ou nul", (df["amount"].isna() | (df["amount"] == 0)).sum())
    df.loc[df["index_ratio"] == 0, "index_ratio"] = pd.NA
    df["index_ratio"] = pd.to_numeric(df["index_ratio"])
    rep.note("Répartition par type : " + ", ".join(f"{k} {v}" for k, v in df["syndication_type"].value_counts().items()) + ".")
    rep.note(f"{int((df['operation'] == 'rachat').sum())} rachat(s) (volume négatif), exclus des totaux d'émission brute.")
    df = df.sort_values(["settlement_date", "isin"]).reset_index(drop=True)
    rep.rows_published = len(df)
    return df, path


def build_breakeven(raw_dir: Path, report: Report):
    path = pick_latest(raw_dir, "point_mort")
    rep = report.dataset("point_mort_inflation")
    rep.source = path.name
    raw = read_sheet(path, "Données")
    title = str(raw.iloc[2, 1]).strip()
    rep.rows_read = len(raw) - 4
    body = raw.iloc[4:, :3].copy()
    body.columns = ["date", "breakeven", "breakeven_bp"]
    body["date"] = pd.to_datetime(body["date"], errors="coerce")
    body["breakeven"] = pd.to_numeric(body["breakeven"], errors="coerce")
    body["breakeven_bp"] = pd.to_numeric(body["breakeven_bp"], errors="coerce")
    bad = body.isna().any(axis=1)
    rep.rows_rejected = int(bad.sum())
    rep.flag("bloquante", "Ligne illisible ou incomplète", bad.sum())
    body = body[~bad].reset_index(drop=True)
    rep.flag("bloquante", "Dates en double", body["date"].duplicated().sum())
    rep.flag("bloquante", "Dates non croissantes", (body["date"].diff().dt.days <= 0).sum())
    diff = (body["breakeven"] * 10000 - body["breakeven_bp"]).abs()
    rep.flag("bloquante", "Valeur décimale ≠ valeur en points de base / 10 000", (diff > TOL_BREAKEVEN_BP).sum())
    rep.flag("bloquante", "Jour non ouvré (samedi ou dimanche)", (body["date"].dt.dayofweek >= 5).sum())
    rep.note(f"Libellé de la série : {title}")
    rep.rows_published = len(body)
    return body, path, title


@dataclass
class CoefFile:
    path: Path
    base_label: str
    reference: pd.Series
    securities: list[dict]


def read_coef_file(path: Path, rep: DatasetReport) -> CoefFile:
    raw = read_sheet(path, "Coeff_FR")
    header = str(raw.iloc[0, 1])
    m = re.search(r"base\s+(\d{4})", header)
    base_label = f"base {m.group(1)}" if m else "base inconnue"
    rep.flag("bloquante", f"{path.name} : base de la référence non lisible", 0 if m else 1)
    data = raw.iloc[9:].copy()
    dates = pd.to_datetime(data.iloc[:, 0], errors="coerce")
    bad = dates.isna()
    rep.rows_rejected += int(bad.sum())
    rep.flag("bloquante", f"{path.name} : date illisible", bad.sum())
    data = data[~bad]
    dates = dates[~bad].reset_index(drop=True)
    rep.flag("bloquante", f"{path.name} : jours calendaires non consécutifs ou en double", (dates.diff().dt.days.dropna() != 1).sum())
    reference = pd.Series(pd.to_numeric(data.iloc[:, 1], errors="coerce").to_numpy(), index=dates)
    rep.flag("bloquante", f"{path.name} : référence quotidienne manquante", reference.isna().sum())
    securities = []
    for col in range(2, raw.shape[1]):
        kind = raw.iloc[1, col]
        if not isinstance(kind, str) or not kind.strip():
            continue
        coupon = float(raw.iloc[2, col])
        maturity = pd.Timestamp(raw.iloc[3, col])
        ref_date = pd.Timestamp(raw.iloc[5, col])
        base_index = float(raw.iloc[7, col])
        coefs = pd.Series(pd.to_numeric(data.iloc[:, col], errors="coerce").to_numpy(), index=dates)
        securities.append(
            {
                "type": kind.strip(),
                "coupon": round(coupon, 6),
                "maturity_date": maturity,
                "reference_date": ref_date,
                "base_index": base_index,
                "coefficients": coefs,
                "source_file": path.name,
            }
        )
    rep.rows_read += len(raw) - 9
    return CoefFile(path, base_label, reference, securities)


def compute_rebase_ratio(old: pd.Series, new: pd.Series) -> tuple[float, pd.Series]:
    """Rapport ancienne base / nouvelle base, calculé sur les dates communes."""
    common = old.index.intersection(new.index)
    ratios = (old.loc[common] / new.loc[common]).dropna()
    return float(ratios.median()), ratios


def coefficient_gaps(coefficients: pd.Series, reference: pd.Series, base_index: float) -> pd.Series:
    """Écart absolu entre coefficient publié et round(référence / indice de base, 5)."""
    idx = coefficients.dropna().index
    expected = (reference.loc[idx] / base_index).round(5)
    return (coefficients.loc[idx] - expected).abs()


def security_id(sec: dict) -> str:
    c = f"{sec['coupon'] * 100:.4f}".rstrip("0").rstrip(".").replace(".", "-")
    return f"{sec['type'].lower()}_{c}_{sec['maturity_date']:%Y%m%d}"


def build_indexation(raw_dir: Path, report: Report, oat: pd.DataFrame | None):
    cur_path = pick_latest(raw_dir, "coef_current")
    old_path = pick_latest(raw_dir, "coef_histo")
    rep = report.dataset("coefficients_indexation")
    rep.source = f"{cur_path.name} ; {old_path.name}"
    cur = read_coef_file(cur_path, rep)
    old = read_coef_file(old_path, rep)
    rep.note(f"Fichier courant : {cur.base_label}, {len(cur.reference)} jours, {len(cur.securities)} titres. Fichier historique : {old.base_label}, {len(old.reference)} jours, {len(old.securities)} titres.")

    # 1. Rebasage de la référence quotidienne
    common = cur.reference.index.intersection(old.reference.index)
    ratio, ratios = compute_rebase_ratio(old.reference, cur.reference)
    spread = float(((ratios - ratio).abs() / ratio).max())
    rep.note(f"Rapport {old.base_label} / {cur.base_label} calculé sur {len(ratios)} jours communs : {ratio:.6f} (écart relatif maximal à la médiane : {spread:.2e}).")
    rep.flag("bloquante", "Rapport entre anciennes et nouvelles références non constant", int((((ratios - ratio).abs() / ratio) > TOL_REBASE_RELATIVE).sum()), f"tolérance relative {TOL_REBASE_RELATIVE}")
    only_old = old.reference.index.difference(cur.reference.index)
    converted = old.reference.loc[only_old] / ratio
    reference = pd.concat([cur.reference, converted]).sort_index()
    rep.note(f"{len(only_old)} jour(s) présents uniquement dans le fichier historique, convertis par le rapport ci-dessus.")
    overlap_gap = (old.reference.loc[common] / ratio - cur.reference.loc[common]).abs().max()
    rep.note(f"Écart absolu maximal entre l'ancienne référence convertie et la référence courante sur la période commune : {overlap_gap:.5f}.")

    # 2 et 3. Contrôle des coefficients, jamais convertis
    securities: dict[str, dict] = {}
    for cf in (old, cur):
        for sec in cf.securities:
            own_ref = cf.reference
            idx = sec["coefficients"].dropna().index
            expected = (own_ref.loc[idx] / sec["base_index"]).round(5)
            diff = coefficient_gaps(sec["coefficients"], own_ref, sec["base_index"])
            bad = diff > TOL_COEFFICIENT + 1e-12
            label = f"{sec['type']} {sec['coupon'] * 100:g} % {sec['maturity_date']:%d/%m/%Y}"
            rep.flag(
                "bloquante",
                f"Coefficient ≈ référence du jour / indice de base ({label}, {cf.path.name})",
                bad.sum(),
                f"tolérance {TOL_COEFFICIENT}",
                [f"{d:%d/%m/%Y} publié {sec['coefficients'].loc[d]} calculé {expected.loc[d]}" for d in diff[bad].index[:3]],
            )
            sec["checked_points"] = len(idx)
            sec["max_gap"] = float(diff.max()) if len(diff) else 0.0
            sid = security_id(sec)
            if sid in securities:
                prev = securities[sid]
                ov = prev["coefficients"].dropna().index.intersection(idx)
                gap = (prev["coefficients"].loc[ov] - sec["coefficients"].loc[ov]).abs()
                rep.flag("bloquante", f"Titre présent dans les deux fichiers, coefficients divergents ({label})", (gap > TOL_COEFFICIENT + 1e-12).sum())
                rep.note(f"Titre {label} présent dans les deux fichiers : {len(ov)} jours communs, écart maximal {gap.max():.5f}. Le fichier courant est retenu.")
            securities[sid] = sec
    rep.note("Écart maximal constaté entre coefficient publié et valeur recalculée, par titre : " + " ; ".join(f"{s['type']} {s['coupon'] * 100:g} % {s['maturity_date']:%Y} {s['max_gap']:.5f}" for s in securities.values()) + ".")

    # Assemblage
    all_dates = reference.index
    wide = pd.DataFrame({"date": all_dates, "daily_reference": reference.to_numpy()})
    meta_secs = []
    isin_index = {}
    if oat is not None:
        for r in oat[oat["index_type"] == "inflation_france"].itertuples():
            isin_index[(r.instrument_family, round(r.coupon, 6), r.maturity_date)] = r.isin
    for sid, sec in sorted(securities.items(), key=lambda kv: (kv[1]["maturity_date"], kv[1]["coupon"])):
        series = sec["coefficients"].reindex(all_dates)
        wide[sid] = series.to_numpy()
        valid = series.dropna()
        rebase = ratio if sec["source_file"] == old.path.name else 1.0
        base_label = old.base_label if rebase != 1.0 else cur.base_label
        meta_secs.append(
            {
                "id": sid,
                "type": sec["type"],
                "coupon": sec["coupon"],
                "maturity_date": sec["maturity_date"].strftime("%Y-%m-%d"),
                "reference_date": sec["reference_date"].strftime("%Y-%m-%d"),
                "base_index": sec["base_index"],
                "base_index_label": base_label,
                "base_index_current_base": round(sec["base_index"] / rebase, 5),
                "first_coefficient_date": valid.index.min().strftime("%Y-%m-%d"),
                "last_coefficient_date": valid.index.max().strftime("%Y-%m-%d"),
                "isin": isin_index.get((sec["type"], sec["coupon"], sec["maturity_date"])),
                "source_file": sec["source_file"],
            }
        )
    unmatched = [s for s in meta_secs if not s["isin"]]
    rep.note(f"{len(meta_secs) - len(unmatched)} titre(s) sur {len(meta_secs)} rattaché(s) à un ISIN par (famille, coupon, échéance) dans les adjudications.")
    rep.flag("avertissement", "Titre sans correspondance dans les adjudications d'OAT", len(unmatched), examples=[s["id"] for s in unmatched])
    rep.rows_published = len(wide)
    ref_df = wide[["date", "daily_reference"]].copy()
    info = {"ratio": ratio, "old_base": old.base_label, "new_base": cur.base_label, "files": [cur_path.name, old_path.name]}
    return wide, ref_df, meta_secs, info, cur_path


# ---------------------------------------------------------------------------
# Écriture
# ---------------------------------------------------------------------------


def _py(v):
    if v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NaT or v is pd.NA:
        return None
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return int(v)
    if isinstance(v, float):
        return round(v, 8)
    return v


def to_records(df: pd.DataFrame) -> list[dict]:
    cols = list(df.columns)
    return [{c: _py(v) for c, v in zip(cols, row)} for row in df.itertuples(index=False, name=None)]


def tidy_integers(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in df.columns:
        s = df[c]
        if pd.api.types.is_float_dtype(s) and s.notna().any():
            nz = s.dropna()
            if (nz == nz.round()).all() and nz.abs().max() < 1e12:
                df[c] = s.astype("Int64")
            else:
                df[c] = s.round(8)
    return df


def write_dataset(out_dir: Path, name: str, df: pd.DataFrame, source: str, last_obs_col: str, generated_at: str, extra_meta=None, *, last_obs_override=None, columnar=False):
    df = tidy_integers(df)
    last = last_obs_override or pd.Timestamp(df[last_obs_col].max()).strftime("%Y-%m-%d")
    first = pd.Timestamp(df[last_obs_col].min()).strftime("%Y-%m-%d")
    meta = {
        "dataset": name,
        "title": DATASET_TITLES[name],
        "source_file": source,
        "first_observation": first,
        "last_observation": last,
        "record_count": len(df),
        "generated_at": generated_at,
    }
    meta.update(extra_meta or {})
    if columnar:
        payload = {"meta": meta, "columns": {c: [_py(v) for v in df[c]] for c in df.columns}}
    else:
        payload = {"meta": meta, "records": to_records(df)}
    (out_dir / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    df.to_csv(out_dir / f"{name}.csv", sep=";", decimal=",", index=False, encoding="utf-8-sig", date_format="%Y-%m-%d", float_format="%.10g", lineterminator="\r\n")
    return meta


def build(raw_dir: Path, out_dir: Path, report_path: Path) -> Report:
    report = Report()
    out_dir.mkdir(parents=True, exist_ok=True)
    generated_at = dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat()
    metas: dict[str, dict] = {}

    known = KnownIssues(raw_dir.parent / "known_issues.json")
    oat, oat_path = build_oat(raw_dir, report, known)
    btf, btf_path = build_btf(raw_dir, report, known)
    synd, synd_path = build_synd(raw_dir, report, known)
    pm, pm_path, pm_title = build_breakeven(raw_dir, report)
    wide, ref_df, securities, info, _ = build_indexation(raw_dir, report, oat)

    if not report.blocking and oat is not None and btf is not None and synd is not None:
        metas["adjudications_oat"] = write_dataset(out_dir, "adjudications_oat", oat, oat_path.name, "auction_date", generated_at)
        metas["adjudications_btf"] = write_dataset(out_dir, "adjudications_btf", btf, btf_path.name, "auction_date", generated_at)
        metas["syndications"] = write_dataset(out_dir, "syndications", synd, synd_path.name, "settlement_date", generated_at)
        metas["point_mort_inflation"] = write_dataset(out_dir, "point_mort_inflation", pm, pm_path.name, "date", generated_at, {"series_label": pm_title})
        metas["reference_inflation"] = write_dataset(
            out_dir, "reference_inflation", ref_df, info["files"][0], "date", generated_at,
            {"base": info["new_base"], "rebase_ratio_previous_base": round(info["ratio"], 6), "previous_base": info["old_base"]},
        )
        metas["coefficients_indexation"] = write_dataset(
            out_dir, "coefficients_indexation", wide, " ; ".join(info["files"]), "date", generated_at,
            {"securities": securities, "base": info["new_base"], "rebase_ratio_previous_base": round(info["ratio"], 6), "previous_base": info["old_base"]},
            columnar=True,
        )
        write_catalog(out_dir, metas, generated_at)
        write_lines(out_dir, oat, synd, generated_at)

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report.render(generated_at), encoding="utf-8")
    return report


def fr_typo(text: str) -> str:
    """Typographie française des textes publiés : espace insécable avant « : » et « % »,
    espace fine insécable avant « ; », « ! » et « ? »."""
    text = text.replace("'", "\u2019")
    text = re.sub(r" ([:%])", "\u00a0\\1", text)
    return re.sub(r" ([;!?])", "\u202f\\1", text)


def write_catalog(out_dir: Path, metas: dict[str, dict], generated_at: str):
    catalog = {
        "generated_at": generated_at,
        "datasets": [
            {
                "id": name,
                "title": DATASET_TITLES[name],
                "files": {"json": f"{name}.json", "csv": f"{name}.csv"},
                "meta": meta,
                "variables": [{"id": i, "label": fr_typo(lab), "unit": fr_typo(unit), "description": fr_typo(desc)} for i, lab, unit, desc in DICTIONARY[name]],
            }
            for name, meta in metas.items()
        ],
    }
    (out_dir / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")


def write_lines(out_dir: Path, oat: pd.DataFrame, synd: pd.DataFrame, generated_at: str):
    """Une fiche par ISIN : caractéristiques déduites, première et dernière opération."""
    rows = []
    isins = sorted(set(oat["isin"]) | set(synd["isin"]))
    for isin in isins:
        a = oat[oat["isin"] == isin]
        s = synd[synd["isin"] == isin]
        src = a if len(a) else s
        last = src.iloc[-1]
        rows.append(
            {
                "isin": isin,
                "label": last["line_label"],
                "instrument_family": last["instrument_family"],
                "coupon": _py(last["coupon"]),
                "maturity_date": _py(last["maturity_date"]),
                "auction_count": len(a),
                "syndication_count": len(s),
                "first_operation": _py(min([x for x in [a["auction_date"].min() if len(a) else None, s["settlement_date"].min() if len(s) else None] if x is not None])),
                "last_operation": _py(max([x for x in [a["auction_date"].max() if len(a) else None, s["settlement_date"].max() if len(s) else None] if x is not None])),
                "auction_volume": _py(float(a["total_issued"].sum())) if len(a) else 0,
                "syndication_volume": _py(float(s.loc[s["amount"] > 0, "amount"].sum())) if len(s) else 0,
            }
        )
    payload = {"meta": {"dataset": "lignes", "record_count": len(rows), "generated_at": generated_at, "source_file": "adjudications_oat, syndications"}, "records": rows}
    (out_dir / "lignes.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw", type=Path, default=ROOT / "data" / "raw")
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "data")
    ap.add_argument("--report", type=Path, default=ROOT / "data" / "validation_report.md")
    args = ap.parse_args(argv)
    report = build(args.raw, args.out, args.report)
    blocking = report.blocking
    for name, a in blocking:
        print(f"BLOQUANT [{name}] {a.check} : {a.count} {a.detail}", file=sys.stderr)
    print(f"Rapport écrit dans {args.report}")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
