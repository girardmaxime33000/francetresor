// Graphiques Observable Plot, chargés uniquement sur les pages concernées.
// Les données sont récupérées à la demande, quand le graphique approche de la fenêtre.
import type * as PlotNS from '@observablehq/plot';
import {
  btfMonthlyVolume,
  btfRates,
  nominalRatePoints,
  periodStart,
  syndYearly,
  yearlyCover,
  yearlyRealYield,
  yearlyServedByIndex,
  yearlyServedByType,
  type SeriesPoint,
} from '../lib/aggregate';
import type { Row } from '../lib/cell';
import type { Col, TableConfig } from '../lib/columns';
import {
  esc,
  fmtAmount,
  fmtBp,
  fmtDateLong,
  fmtDec,
  fmtInt,
  fmtMonthYear,
  fmtPct,
  fmtRatio,
} from '../lib/format';
import { AUCTION_TYPES, BTF_SEGMENTS, INDEX_TYPES, MATURITY_BUCKETS, SYND_TYPES } from '../lib/labels';
import type { BreakevenRow, BtfRow, OatRow, RefRow, SyndRow } from '../lib/types';
import { mountTable } from './table-init';

type Plot = typeof PlotNS;
type PlotElement = (SVGSVGElement | HTMLElement) & { scale: (name: string) => { apply: (v: unknown) => number; bandwidth?: number } | undefined };

const BASE = import.meta.env.BASE_URL;

// Ordre des couleurs retenu pour le contraste (tous au moins 3:1 sur fond blanc), #A3A9B0 réservé aux éléments neutres.
const COLORS = ['#1f3a5f', '#8c6d3f', '#4f6f52', '#6b8cae'];
const INK = '#1a1a1a';
const INK2 = '#4a4f55';
const RULE = '#d5d8dc';

interface TipItem {
  series: string;
  color: string;
  text: string;
  y?: number;
}
interface Tip {
  label: string;
  items: TipItem[];
}
interface ChartResult {
  plot: PlotElement;
  /** Clé : valeur de x telle que passée à l'échelle (nombre ou timestamp). */
  tips: Map<number, Tip>;
  legend?: { label: string; color: string }[];
  table: { config: TableConfig; rows: Row[] };
  /** Décalage en x pour les échelles à intervalles (centre de la barre). */
  xOffset?: number;
}

interface BuildCtx {
  Plot: Plot;
  width: number;
  host: HTMLElement;
  controls?: Record<string, string>;
}

type Builder = (data: unknown, ctx: BuildCtx) => ChartResult;

// ---------------------------------------------------------------- utilitaires

const compact = (w: number): boolean => w < 560;

function style(): Record<string, string> {
  return { fontFamily: "'Source Sans 3', system-ui, sans-serif", fontSize: '13px', color: INK, background: 'transparent', overflow: 'visible' };
}

function yearTicks(min: number, max: number, width: number): number[] {
  const slots = Math.max(3, Math.floor(width / 70));
  const step = [1, 2, 5, 10].find((s) => (max - min) / s <= slots) ?? 10;
  const first = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let y = first; y <= max; y += step) out.push(y);
  return out;
}

function dateTicks(min: Date, max: Date, width: number): Date[] {
  const years = yearTicks(min.getUTCFullYear(), max.getUTCFullYear(), width);
  return years.map((y) => new Date(Date.UTC(y, 0, 1))).filter((d) => d >= min && d <= max);
}

function tableConfig(id: string, caption: string, columns: Col[], csvName: string, sortKey: string, dir: 'asc' | 'desc' = 'desc'): TableConfig {
  return { id, caption, columns, filters: [], pageSize: 20, csvName, sort: { key: sortKey, dir } };
}

function pivot(points: SeriesPoint[], order: string[], labels: Record<string, string>): { columns: Col[]; rows: Row[] } {
  const rows = new Map<number | string, Row>();
  for (const p of points) {
    const r = rows.get(p.x) ?? { year: p.x };
    r[p.series] = p.value;
    rows.set(p.x, r);
  }
  return {
    columns: [{ key: 'year', label: 'Année', kind: 'year' }, ...order.map((s): Col => ({ key: s, label: `${labels[s] ?? s} (M€)`, kind: 'int' }))],
    rows: [...rows.values()],
  };
}

function marginRight(w: number, labelled: boolean): number {
  return labelled ? (compact(w) ? 96 : 124) : 16;
}

function axisMarks(Plot: Plot, o: { xTicks: (number | Date)[]; xFormat: (v: never) => string; yFormat: (v: number) => string; baseline?: boolean }) {
  const marks: PlotNS.Markish[] = [
    Plot.gridY({ ticks: 5, stroke: RULE, strokeOpacity: 1 }),
    Plot.axisY({ ticks: 5, tickSize: 0, tickFormat: o.yFormat, fill: INK2, label: null }),
    Plot.axisX({ ticks: o.xTicks as never, tickFormat: o.xFormat as never, tickSize: 4, stroke: INK2, fill: INK2, label: null }),
  ];
  if (o.baseline) marks.push(Plot.ruleY([0], { stroke: INK2, strokeWidth: 1 }));
  return marks;
}

function colorOf(series: string[], s: string): string {
  return COLORS[series.indexOf(s) % COLORS.length] ?? COLORS[0]!;
}

/** Barres empilées sur des années (échelle numérique, barre de x+0,1 à x+0,9). */
function stackedYears(
  ctx: BuildCtx,
  points: SeriesPoint[],
  order: string[],
  labels: Record<string, string>,
  yTitle: string,
  csvName: string,
  caption: string,
): ChartResult {
  const { Plot, width } = ctx;
  const years = [...new Set(points.map((p) => Number(p.x)))].sort((a, b) => a - b);
  const rects: { x1: number; x2: number; y1: number; y2: number; series: string; year: number }[] = [];
  const tips = new Map<number, Tip>();
  for (const y of years) {
    let acc = 0;
    const items: TipItem[] = [];
    for (const s of order) {
      const v = points.find((p) => p.x === y && p.series === s)?.value ?? 0;
      rects.push({ x1: y + 0.12, x2: y + 0.88, y1: acc, y2: acc + v, series: s, year: y });
      acc += v;
      items.push({ series: labels[s] ?? s, color: colorOf(order, s), text: fmtAmount(v) });
    }
    items.push({ series: 'Total', color: INK2, text: fmtAmount(acc) });
    tips.set(y + 0.5, { label: String(y), items });
  }
  const min = years[0] ?? 0;
  const max = (years.at(-1) ?? 0) + 1;
  const plot = Plot.plot({
    width,
    height: compact(width) ? 280 : 340,
    marginLeft: 64,
    marginRight: 16,
    marginBottom: 30,
    style: style(),
    x: { type: 'linear', domain: [min, max], axis: null },
    y: { domain: [0, Math.max(...rects.map((r) => r.y2)) * 1.02], axis: null, grid: false },
    color: { type: 'categorical', domain: order, range: order.map((s) => colorOf(order, s)) },
    marks: [
      ...axisMarks(Plot, {
        xTicks: yearTicks(min, max - 1, width).map((y) => y + 0.5),
        xFormat: ((v: number) => String(Math.floor(v))) as never,
        yFormat: (v) => fmtInt(v),
        baseline: true,
      }),
      Plot.rect(rects, { x1: 'x1', x2: 'x2', y1: 'y1', y2: 'y2', fill: 'series' }),
    ],
  }) as PlotElement;
  const p = pivot(points, order, labels);
  void yTitle;
  return {
    plot,
    tips,
    legend: order.map((s) => ({ label: labels[s] ?? s, color: colorOf(order, s) })),
    table: { config: tableConfig(`t-${csvName}`, caption, p.columns, csvName, 'year'), rows: p.rows },
  };
}

interface LineSeries {
  name: string;
  label: string;
  color: string;
  points: { x: number; y: number }[];
}

/** Courbes temporelles ou annuelles avec étiquetage direct en fin de courbe. */
function lines(
  ctx: BuildCtx,
  series: LineSeries[],
  o: {
    time: boolean;
    xLabel: (x: number) => string;
    yFormat: (v: number) => string;
    tipFormat: (v: number) => string;
    yDomain?: [number, number];
    dots?: boolean;
    caption: string;
    csvName: string;
    valueHeader: string;
    valueKind: Col['kind'];
    scatter?: boolean;
  },
): ChartResult {
  const { Plot, width } = ctx;
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const labelled = series.length <= 4 && series.length > 1;
  const tips = new Map<number, Tip>();
  for (const s of series) {
    for (const p of s.points) {
      const t = tips.get(p.x) ?? { label: o.xLabel(p.x), items: [] };
      t.items.push({ series: s.label, color: s.color, text: o.tipFormat(p.y), y: p.y });
      tips.set(p.x, t);
    }
  }
  const xTicks = o.time ? dateTicks(new Date(xmin), new Date(xmax), width) : yearTicks(xmin, xmax, width);
  const y0 = o.yDomain ?? [Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y))];
  const ends = series.map((s) => ({ ...s.points.reduce((a, b) => (b.x > a.x ? b : a)), label: s.label, color: s.color }));
  const toX = (x: number): number | Date => (o.time ? new Date(x) : x);
  const marks: PlotNS.Markish[] = [
    ...axisMarks(Plot, { xTicks: xTicks as never, xFormat: ((v: Date | number) => String(v instanceof Date ? v.getUTCFullYear() : v)) as never, yFormat: o.yFormat }),
  ];
  for (const s of series) {
    const data = s.points.map((p) => ({ x: toX(p.x), y: p.y }));
    if (o.scatter) marks.push(Plot.dot(data, { x: 'x', y: 'y', r: 2, fill: s.color, stroke: 'none' }));
    else marks.push(Plot.line(data, { x: 'x', y: 'y', stroke: s.color, strokeWidth: 1.6 }));
    if (o.dots) marks.push(Plot.dot(data, { x: 'x', y: 'y', r: 3, fill: s.color, stroke: 'none' }));
  }
  if (labelled) {
    // Écarte verticalement les étiquettes trop proches (15 px minimum).
    const h = compact(width) ? 280 : 340;
    const plotH = h - 20 - 30;
    const lo = y0[0];
    const hi = y0[1];
    const px = ends.map((e, i) => ({ i, py: ((hi - e.y) / (hi - lo)) * plotH })).sort((a, b) => a.py - b.py);
    for (let k = 1; k < px.length; k++) if (px[k]!.py - px[k - 1]!.py < 15) px[k]!.py = px[k - 1]!.py + 15;
    const labelY = new Map(px.map((p) => [p.i, hi - (p.py / plotH) * (hi - lo)]));
    marks.push(Plot.dot(ends.map((e) => ({ x: toX(e.x), y: e.y, c: e.color })), { x: 'x', y: 'y', r: 3.5, fill: 'c', stroke: 'none' }));
    marks.push(
      Plot.text(
        ends.map((e, i) => ({ x: toX(e.x), y: labelY.get(i)!, t: e.label })),
        { x: 'x', y: 'y', text: 't', dx: 9, textAnchor: 'start', fill: INK, fontWeight: 600, lineWidth: 12 },
      ),
    );
  }
  const plot = Plot.plot({
    width,
    height: compact(width) ? 280 : 340,
    marginLeft: 56,
    marginRight: marginRight(width, labelled),
    marginBottom: 30,
    style: style(),
    x: { type: o.time ? 'utc' : 'linear', domain: [toX(xmin) as never, toX(xmax) as never], axis: null },
    y: { domain: y0, nice: true, axis: null, grid: false },
    marks,
  }) as PlotElement;

  const ordered = [...tips.entries()].sort((a, b) => a[0] - b[0]);
  const columns: Col[] = [
    o.time ? { key: 'x', label: 'Date', kind: 'date' } : { key: 'x', label: 'Année', kind: 'year' },
    ...series.map((s): Col => ({ key: s.name, label: series.length > 1 ? `${s.label} (${o.valueHeader})` : o.valueHeader, kind: o.valueKind })),
  ];
  const lookup = series.map((s) => new Map(s.points.map((p) => [p.x, p.y])));
  const rows: Row[] = ordered.map(([x]) => {
    const r: Row = { x: o.time ? new Date(x).toISOString().slice(0, 10) : x };
    series.forEach((s, i) => {
      r[s.name] = lookup[i]!.get(x) ?? null;
    });
    return r;
  });
  return { plot, tips: new Map(ordered), table: { config: tableConfig(`t-${o.csvName}`, o.caption, columns, o.csvName, 'x'), rows } };
}

const ts = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

// ------------------------------------------------------------------ graphiques

const builders: Record<string, Builder> = {
  'oat-volumes'(data, ctx) {
    const rows = (data as { records: OatRow[] }).records;
    const order = ['adju_MT', 'adju_LT', 'adju_MLT'];
    return stackedYears(ctx, yearlyServedByType(rows, order), order, AUCTION_TYPES, 'M€', 'volumes-adjuges-oat', 'Volumes adjugés annuels d’OAT par type d’adjudication');
  },

  'oat-rates'(data, ctx) {
    const pts = nominalRatePoints((data as { records: OatRow[] }).records);
    const order: string[] = [...MATURITY_BUCKETS];
    const series: LineSeries[] = order.map((b, i) => ({
      name: `b${i}`,
      label: b,
      color: COLORS[i]!,
      points: pts.filter((p) => p.bucket === b).map((p) => ({ x: ts(p.date), y: p.rate * 100 })),
    }));
    const res = lines(ctx, series, {
      time: true,
      xLabel: (x) => fmtDateLong(new Date(x).toISOString()),
      yFormat: (v) => fmtDec(v, 0),
      tipFormat: (v) => `${fmtDec(v, 3)} %`,
      scatter: true,
      caption: 'Taux moyen pondéré de chaque adjudication selon la maturité résiduelle',
      csvName: 'taux-oat-par-maturite',
      valueHeader: '%',
      valueKind: 'pctnum',
    });
    // Les points de même date sont détaillés dans l'infobulle avec le titre adjugé.
    const byDate = new Map<number, Tip>();
    for (const p of pts) {
      const k = ts(p.date);
      const t = byDate.get(k) ?? { label: fmtDateLong(p.date), items: [] };
      t.items.push({ series: `${p.line} (${p.bucket})`, color: COLORS[order.indexOf(p.bucket)]!, text: fmtPct(p.rate, 3), y: p.rate * 100 });
      byDate.set(k, t);
    }
    res.tips = new Map([...byDate].sort((a, b) => a[0] - b[0]));
    res.table = {
      config: tableConfig('t-taux-oat', 'Taux moyen pondéré de chaque adjudication selon la maturité résiduelle', [
        { key: 'date', label: 'Date', kind: 'date' },
        { key: 'line', label: 'Ligne', kind: 'text' },
        { key: 'bucket', label: 'Maturité résiduelle', kind: 'text' },
        { key: 'rate', label: 'Taux moyen pondéré', kind: 'rate' },
      ], 'taux-oat-par-maturite', 'date'),
      rows: pts as unknown as Row[],
    };
    return res;
  },

  'oat-cover'(data, ctx) {
    const c = yearlyCover((data as { records: OatRow[] }).records);
    return lines(ctx, [{ name: 'cover', label: 'Ratio de couverture', color: COLORS[0]!, points: c.map((r) => ({ x: r.year, y: r.value })) }], {
      time: false,
      xLabel: String,
      yFormat: (v) => fmtDec(v, 1),
      tipFormat: fmtRatio,
      dots: true,
      yDomain: [0, Math.max(...c.map((r) => r.value)) * 1.05],
      caption: 'Ratio de couverture annuel des adjudications d’OAT',
      csvName: 'couverture-oat',
      valueHeader: 'Ratio de couverture',
      valueKind: 'ratio',
    });
  },

  'idx-volumes'(data, ctx) {
    const rows = (data as { records: OatRow[] }).records.filter((r) => r.auction_type === 'adju_I');
    const order = ['inflation_france', 'inflation_zone_euro'];
    return stackedYears(ctx, yearlyServedByIndex(rows), order, INDEX_TYPES, 'M€', 'volumes-adjuges-indexees', 'Volumes adjugés annuels de titres indexés par indice');
  },

  'idx-yield'(data, ctx) {
    const rows = (data as { records: OatRow[] }).records.filter((r) => r.auction_type === 'adju_I');
    const pts = yearlyRealYield(rows);
    const order = ['inflation_france', 'inflation_zone_euro'];
    const short: Record<string, string> = { inflation_france: 'OATi', inflation_zone_euro: 'OAT€i' };
    const series: LineSeries[] = order.map((s, i) => ({
      name: s,
      label: short[s]!,
      color: COLORS[i]!,
      points: pts.filter((p) => p.series === s).map((p) => ({ x: Number(p.x), y: p.value * 100 })),
    }));
    return lines(ctx, series, {
      time: false,
      xLabel: String,
      yFormat: (v) => fmtDec(v, 1),
      tipFormat: (v) => `${fmtDec(v, 2)} %`,
      dots: true,
      caption: 'Rendement réel moyen pondéré annuel des titres indexés',
      csvName: 'rendement-reel-indexees',
      valueHeader: '%',
      valueKind: 'pctnum',
    });
  },

  'idx-cover'(data, ctx) {
    const rows = (data as { records: OatRow[] }).records.filter((r) => r.auction_type === 'adju_I');
    const c = yearlyCover(rows);
    return lines(ctx, [{ name: 'cover', label: 'Ratio de couverture', color: COLORS[0]!, points: c.map((r) => ({ x: r.year, y: r.value })) }], {
      time: false,
      xLabel: String,
      yFormat: (v) => fmtDec(v, 1),
      tipFormat: fmtRatio,
      dots: true,
      yDomain: [0, Math.max(...c.map((r) => r.value)) * 1.05],
      caption: 'Ratio de couverture annuel des adjudications de titres indexés',
      csvName: 'couverture-indexees',
      valueHeader: 'Ratio de couverture',
      valueKind: 'ratio',
    });
  },

  'btf-rates'(data, ctx) {
    const pts = btfRates((data as { records: BtfRow[] }).records);
    const series: LineSeries[] = BTF_SEGMENTS.map((s, i) => ({
      name: `s${i}`,
      label: s,
      color: COLORS[i]!,
      points: pts.filter((p) => p.segment === s).map((p) => ({ x: ts(p.date), y: p.rate * 100 })),
    }));
    return lines(ctx, series, {
      time: true,
      xLabel: (x) => fmtDateLong(new Date(x).toISOString()),
      yFormat: (v) => fmtDec(v, 1),
      tipFormat: (v) => `${fmtDec(v, 3)} %`,
      caption: 'Taux moyen pondéré des adjudications de BTF par segment',
      csvName: 'taux-btf-par-segment',
      valueHeader: '%',
      valueKind: 'pctnum',
    });
  },

  'btf-volumes'(data, ctx) {
    const { Plot, width } = ctx;
    const months = btfMonthlyVolume((data as { records: BtfRow[] }).records);
    const rects = months.map((m) => {
      const [y, mo] = m.month.split('-').map(Number) as [number, number];
      return { x1: new Date(Date.UTC(y, mo - 1, 1)), x2: new Date(Date.UTC(y, mo, 1)), y: m.value };
    });
    const tips = new Map<number, Tip>();
    for (const [i, m] of months.entries()) {
      const r = rects[i]!;
      tips.set((r.x1.getTime() + r.x2.getTime()) / 2, { label: fmtMonthYear(`${m.month}-01`), items: [{ series: 'Volume adjugé', color: COLORS[0]!, text: fmtAmount(m.value) }] });
    }
    const min = rects[0]!.x1;
    const max = rects.at(-1)!.x2;
    const plot = Plot.plot({
      width,
      height: compact(width) ? 280 : 340,
      marginLeft: 64,
      marginRight: 16,
      marginBottom: 30,
      style: style(),
      x: { type: 'utc', domain: [min, max], axis: null },
      y: { domain: [0, Math.max(...months.map((m) => m.value)) * 1.03], axis: null, grid: false },
      marks: [
        ...axisMarks(Plot, { xTicks: dateTicks(min, max, width) as never, xFormat: ((d: Date) => String(d.getUTCFullYear())) as never, yFormat: (v) => fmtInt(v), baseline: true }),
        Plot.rectY(rects, { x1: 'x1', x2: 'x2', y: 'y', fill: COLORS[0] }),
      ],
    }) as PlotElement;
    return {
      plot,
      tips,
      table: {
        config: tableConfig('t-btf-volumes', 'Volumes adjugés de BTF par mois', [{ key: 'month', label: 'Mois', kind: 'text' }, { key: 'value', label: 'Volume adjugé (M€)', kind: 'int' }], 'volumes-btf-par-mois', 'month'),
        rows: months as unknown as Row[],
      },
    };
  },

  'synd-volumes'(data, ctx) {
    const pts = syndYearly((data as { records: SyndRow[] }).records);
    return stackedYears(ctx, pts, ['synd_LT', 'synd_I'], SYND_TYPES, 'M€', 'emissions-syndications', 'Émissions brutes de syndication par année et par type');
  },

  reference(data, ctx) {
    const rows = (data as { records: RefRow[] }).records;
    return lines(ctx, [{ name: 'ref', label: 'Référence quotidienne', color: COLORS[0]!, points: rows.map((r) => ({ x: ts(r.date), y: r.daily_reference })) }], {
      time: true,
      xLabel: (x) => fmtDateLong(new Date(x).toISOString()),
      yFormat: (v) => fmtInt(v),
      tipFormat: (v) => fmtDec(v, 5),
      yDomain: [0, Math.max(...rows.map((r) => r.daily_reference)) * 1.05],
      caption: 'Référence quotidienne d’inflation, base 2025',
      csvName: 'reference-quotidienne-inflation',
      valueHeader: 'Référence quotidienne d’inflation',
      valueKind: 'coef',
    });
  },

  breakeven(data, ctx) {
    const all = (data as { records: BreakevenRow[] }).records;
    const sel = ctx.controls?.period ?? 'all';
    const last = all.at(-1)!.date;
    const start = sel === '1' ? periodStart(last, 1) : sel === '3' ? periodStart(last, 3) : null;
    const rows = start ? all.filter((r) => r.date >= start) : all;
    return lines(ctx, [{ name: 'bp', label: 'Point mort à 10 ans', color: COLORS[0]!, points: rows.map((r) => ({ x: ts(r.date), y: r.breakeven_bp })) }], {
      time: true,
      xLabel: (x) => fmtDateLong(new Date(x).toISOString()),
      yFormat: (v) => fmtInt(v),
      tipFormat: (v) => fmtBp(v, 1),
      caption: 'Point mort d’inflation à 10 ans, série quotidienne',
      csvName: 'point-mort-inflation',
      valueHeader: 'Point mort (pb)',
      valueKind: 'bp',
    });
  },
};

// ------------------------------------------------------------ interactions

function addInteraction(host: HTMLElement, res: ChartResult, title: string): void {
  const svg = res.plot as unknown as SVGSVGElement;
  const xScale = res.plot.scale('x');
  const yScale = res.plot.scale('y');
  if (!xScale) return;
  const keys = [...res.tips.keys()].sort((a, b) => a - b);
  if (!keys.length) return;
  const px = keys.map((k) => xScale.apply(k));
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  const live = document.createElement('div');
  live.className = 'visually-hidden';
  live.setAttribute('aria-live', 'polite');
  const NS = 'http://www.w3.org/2000/svg';
  const cursor = document.createElementNS(NS, 'g');
  cursor.setAttribute('pointer-events', 'none');
  svg.append(cursor);
  host.append(tooltip, live);
  host.tabIndex = 0;
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', `${title}. Flèches gauche et droite : parcourir les valeurs.`);

  const height = Number(svg.getAttribute('height'));
  let current = -1;

  const show = (i: number, announce: boolean): void => {
    current = i;
    const key = keys[i]!;
    const tip = res.tips.get(key)!;
    const x = px[i]!;
    cursor.replaceChildren();
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', '8');
    line.setAttribute('y2', String(height - 30));
    line.setAttribute('stroke', INK2);
    line.setAttribute('stroke-width', '1');
    cursor.append(line);
    let topY = height / 2;
    for (const it of tip.items) {
      if (it.y !== undefined && yScale) {
        const cy = yScale.apply(it.y);
        topY = Math.min(topY, cy);
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', String(x));
        c.setAttribute('cy', String(cy));
        c.setAttribute('r', '4.5');
        c.setAttribute('fill', it.color);
        c.setAttribute('stroke', '#ffffff');
        c.setAttribute('stroke-width', '1.5');
        cursor.append(c);
      }
    }
    tooltip.innerHTML = `<strong>${esc(tip.label)}</strong>${tip.items
      .map((it) => `<span><span class="swatch" style="background:${it.color}"></span>${esc(it.series)}${it.text ? ' : ' + esc(it.text) : ''}</span><br>`)
      .join('')}`;
    tooltip.hidden = false;
    const w = host.clientWidth;
    const tw = tooltip.offsetWidth;
    const left = x + 14 + tw > w ? Math.max(0, x - 14 - tw) : x + 14;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(0, Math.min(topY, height - tooltip.offsetHeight - 36))}px`;
    if (announce) live.textContent = `${tip.label}. ${tip.items.map((it) => `${it.series} ${it.text}`).join(', ')}`;
  };
  const hide = (): void => {
    current = -1;
    tooltip.hidden = true;
    cursor.replaceChildren();
  };
  const nearest = (clientX: number): number => {
    const x = clientX - svg.getBoundingClientRect().left;
    let lo = 0;
    let hi = px.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (px[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && Math.abs(px[lo - 1]! - x) <= Math.abs(px[lo]! - x) ? lo - 1 : lo;
  };
  host.addEventListener('pointermove', (e) => show(nearest(e.clientX), false));
  host.addEventListener('pointerleave', () => {
    if (document.activeElement !== host) hide();
  });
  host.addEventListener('focus', () => show(current >= 0 ? current : keys.length - 1, true));
  host.addEventListener('blur', hide);
  host.addEventListener('keydown', (e) => {
    const move = (to: number): void => {
      e.preventDefault();
      show(Math.max(0, Math.min(keys.length - 1, to)), true);
    };
    if (e.key === 'ArrowLeft') move((current < 0 ? keys.length : current) - 1);
    else if (e.key === 'ArrowRight') move((current < 0 ? -1 : current) + 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(keys.length - 1);
    else if (e.key === 'Escape') hide();
  });
}

// ------------------------------------------------------------------ montage

const fetches = new Map<string, Promise<unknown>>();
function fetchJson(src: string): Promise<unknown> {
  let p = fetches.get(src);
  if (!p) {
    p = fetch(`${BASE}${src.replace(/^\//, '')}`).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
    fetches.set(src, p);
  }
  return p;
}

let plotModule: Promise<Plot> | undefined;
const loadPlot = (): Promise<Plot> => (plotModule ??= import('@observablehq/plot'));

function setupFigure(fig: HTMLElement): void {
  const kind = fig.dataset.chart!;
  const src = fig.dataset.src!;
  const hostEl = fig.querySelector<HTMLElement>('.chart-host')!;
  const legendEl = fig.querySelector<HTMLElement>('[data-legend]');
  const tableEl = fig.querySelector<HTMLElement>('[data-chart-table]');
  const details = fig.querySelector<HTMLDetailsElement>('details');
  const title = fig.querySelector('h3')?.textContent ?? 'Graphique';
  const controls: Record<string, string> = {};
  let data: unknown;
  let lastWidth = 0;
  let tableDone = false;
  let result: ChartResult | undefined;

  const render = async (): Promise<void> => {
    const Plot = await loadPlot();
    const width = Math.floor(hostEl.clientWidth);
    if (!width || (width === lastWidth && !hostEl.dataset.dirty)) return;
    lastWidth = width;
    delete hostEl.dataset.dirty;
    result = builders[kind]!(data, { Plot, width, host: hostEl, controls });
    const svg = result.plot as unknown as SVGSVGElement;
    svg.querySelectorAll('[aria-label],[aria-hidden]').forEach((n) => {
      n.removeAttribute('aria-label');
      n.removeAttribute('aria-hidden');
    });
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${title}. Les valeurs sont détaillées dans le tableau « Voir les données ».`.replace('« ', '«\u202F').replace(' »', '\u202F»'));
    hostEl.replaceChildren(result.plot);
    addInteraction(hostEl, result, title);
    if (legendEl) {
      legendEl.innerHTML = (result.legend ?? []).map((l) => `<li><span class="swatch" style="background:${l.color}"></span>${esc(l.label)}</li>`).join('');
    }
    tableDone = false;
    if (details?.open) buildTable();
    fig.dispatchEvent(new CustomEvent('chart:rendered', { detail: result }));
  };

  const buildTable = (): void => {
    if (!result || !tableEl || tableDone) return;
    tableDone = true;
    mountTable(tableEl, result.table.config, result.table.rows);
  };
  details?.addEventListener('toggle', () => {
    if (details.open) buildTable();
  });

  const load = async (): Promise<void> => {
    try {
      data = await fetchJson(src);
      await render();
      new ResizeObserver(() => {
        window.requestAnimationFrame(() => void render());
      }).observe(hostEl);
    } catch {
      hostEl.innerHTML = '<p class="chart-fallback">Le graphique n’a pas pu être chargé. Les données restent disponibles dans la rubrique Données.</p>';
    }
  };

  fig.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((btn) => {
    btn.addEventListener('click', () => {
      controls[btn.dataset.control!] = btn.dataset.value!;
      fig.querySelectorAll<HTMLButtonElement>(`[data-control="${btn.dataset.control}"]`).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      hostEl.dataset.dirty = '1';
      void render();
    });
  });

  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void load();
      }
    },
    { rootMargin: '300px' },
  );
  io.observe(hostEl);
}

document.querySelectorAll<HTMLElement>('[data-chart]').forEach(setupFigure);
