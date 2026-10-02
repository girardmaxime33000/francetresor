import type { TableConfig } from '../lib/columns';
import { esc, fmtDec, fmtInt, fmtPct, MINUS, NBSP } from '../lib/format';
import { question, type MarketsFile } from '../lib/markets';
import { emptyPortfolio, loadPortfolio, parsePortfolio, positions, savePortfolio, settle, stats, type PortfolioState } from '../lib/portfolio';
import { mountTable } from './table-init';

const BASE = import.meta.env.BASE_URL;
const root = document.querySelector<HTMLElement>('[data-portfolio]');

if (root) {
  const summary = root.querySelector<HTMLElement>('[data-summary]')!;
  const tableHost = root.querySelector<HTMLElement>('[data-positions]')!;
  const calibration = root.querySelector<HTMLElement>('[data-calibration]')!;
  const message = root.querySelector<HTMLElement>('[data-message]')!;
  const fileInput = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  let file: MarketsFile;
  let state: PortfolioState = loadPortfolio();

  const signed = (n: number): string => `${n < 0 ? MINUS : '+'}${fmtDec(Math.abs(n), 2)}${NBSP}jetons`;

  const render = (): void => {
    const markets = file.records;
    const byId = new Map(markets.map((m) => [m.id, m]));
    const st = stats(state, markets);
    const pos = positions(state);

    const rows = [
      ['Jetons misés au total', `${fmtDec(st.staked, 2)}${NBSP}jetons`],
      ['Positions ouvertes', fmtInt(st.openPositions)],
      ['Positions résolues', fmtInt(st.resolvedPositions)],
      ['Gain net fictif sur les marchés résolus', st.resolvedPositions ? signed(st.netResolved) : 'sans objet'],
      ['Score de Brier moyen', st.brier === null ? 'sans objet' : fmtDec(st.brier, 3)],
      ['Score de Brier de la cote initiale, mêmes marchés', st.brierInitial === null ? 'sans objet' : fmtDec(st.brierInitial, 3)],
      ['Score d’une estimation constante de 50' + NBSP + '%', fmtDec(0.25, 3)],
    ];
    summary.innerHTML = `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k!)}</dt><dd>${esc(v!)}</dd>`).join('')}</dl>`;

    const tableRows = pos
      .map((p) => {
        const m = byId.get(p.marketId);
        if (!m) return null;
        const s = settle(p, m);
        return {
          question: question(m),
          href: `/marches/${m.id}/`,
          status: m.status === 'open' ? 'Ouvert' : `Résolu, ${m.outcome ? 'Oui' : 'Non'}`,
          yes: p.yesShares,
          no: p.noShares,
          stake: p.stake,
          estimate: p.estimate,
          net: s ? s.net : null,
          last: p.lastAt.slice(0, 10),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (tableRows.length === 0) {
      tableHost.innerHTML = '<p>Aucun pari enregistré dans ce navigateur. Les paris se placent depuis la page de chaque marché.</p>';
    } else {
      const cfg: TableConfig = {
        id: 'positions',
        caption: 'Positions du portefeuille fictif, en jetons',
        columns: [
          { key: 'question', label: 'Marché', kind: 'text', href: '{href}', rowHeader: true },
          { key: 'status', label: 'Statut', kind: 'text' },
          { key: 'stake', label: 'Mise totale', kind: 'dec' },
          { key: 'yes', label: 'Parts Oui', kind: 'dec' },
          { key: 'no', label: 'Parts Non', kind: 'dec' },
          { key: 'estimate', label: 'Votre probabilité du Oui', kind: 'price' },
          { key: 'net', label: 'Gain net', kind: 'dec' },
          { key: 'last', label: 'Dernier pari', kind: 'date' },
        ],
        filters: [{ id: 'status', label: 'Statut', field: 'status', kind: 'value' }],
        pageSize: 15,
        csvName: 'portefeuille-marches-fictifs',
        sort: { key: 'last', dir: 'desc' },
      };
      tableHost.innerHTML = '<div data-table></div>';
      mountTable(tableHost.firstElementChild as HTMLElement, cfg, tableRows);
    }

    calibration.innerHTML = st.calibration.length
      ? `<div class="table-block"><div class="table-scroll" role="region" aria-label="Calibration" tabindex="0"><table class="data"><caption>Calibration de vos estimations sur les marchés résolus</caption><thead><tr><th scope="col">Probabilité estimée du Oui</th><th scope="col" class="num">Marchés</th><th scope="col" class="num">Part de Oui observée</th></tr></thead><tbody>${st.calibration
          .map((b) => `<tr><td>${b.from}${NBSP}%${'–'}${b.to}${NBSP}%</td><td class="num">${fmtInt(b.count)}</td><td class="num">${esc(fmtPct(b.observed, 0))}</td></tr>`)
          .join('')}</tbody></table></div></div>`
      : '<p>La calibration apparaît dès qu’un marché sur lequel vous avez parié est résolu.</p>';
  };

  const say = (t: string): void => {
    message.textContent = t;
  };

  root.querySelector('[data-export]')!.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portefeuille-marches-fictifs.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('Portefeuille exporté.');
  });
  root.querySelector('[data-import]')!.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const next = parsePortfolio(await f.text());
    if (next.bets.length === 0 && Object.keys(next.books).length === 0) {
      say('Le fichier ne contient aucun pari valide. Le portefeuille actuel est conservé.');
    } else if (window.confirm('Remplacer le portefeuille actuel par le contenu du fichier ?')) {
      state = next;
      say(savePortfolio(state) ? 'Portefeuille importé.' : 'Le stockage local est indisponible : import pris en compte pour cette page seulement.');
      render();
    }
    fileInput.value = '';
  });
  root.querySelector('[data-reset]')!.addEventListener('click', () => {
    if (window.confirm('Effacer tous les paris enregistrés dans ce navigateur ?')) {
      state = emptyPortfolio();
      savePortfolio(state);
      say('Portefeuille réinitialisé.');
      render();
    }
  });

  fetch(`${BASE}data/marches.json`)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<MarketsFile>;
    })
    .then((f) => {
      file = f;
      root.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        b.disabled = false;
      });
      render();
    })
    .catch(() => say('Les marchés n’ont pas pu être chargés.'));
}
