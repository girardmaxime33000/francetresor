import { price, trade, type Side } from '../lib/lmsr';
import { esc, fmtDec, fmtPct, MINUS, NBSP } from '../lib/format';
import type { Market } from '../lib/markets';
import { bookFor, loadPortfolio, placeBet, positions, savePortfolio, settle, validateStake, type PortfolioState } from '../lib/portfolio';

const root = document.querySelector<HTMLElement>('[data-market-root]');

if (root) {
  const market = JSON.parse(root.dataset.market!) as Market;
  let state: PortfolioState = loadPortfolio();

  const yes = root.querySelector<HTMLElement>('[data-price-yes]')!;
  const no = root.querySelector<HTMLElement>('[data-price-no]')!;
  const bar = root.querySelector<HTMLElement>('[data-bar]')!;
  const note = root.querySelector<HTMLElement>('[data-odds-note]')!;
  const positionEl = root.querySelector<HTMLElement>('[data-position]')!;
  const ticket = root.querySelector<HTMLElement>('[data-ticket]');
  const form = ticket?.querySelector<HTMLFormElement>('form');
  const stakeEl = form?.querySelector<HTMLInputElement>('#stake');
  const estEl = form?.querySelector<HTMLInputElement>('#estimate');
  const preview = form?.querySelector<HTMLElement>('[data-preview]');
  const feedback = form?.querySelector<HTMLElement>('[data-feedback]');

  const tokens = (n: number): string => `${fmtDec(n, 2)}${NBSP}jetons`;
  const signed = (n: number): string => `${n < 0 ? MINUS : '+'}${fmtDec(Math.abs(n), 2)}${NBSP}jetons`;
  const side = (): Side => (form!.querySelector<HTMLInputElement>('input[name="side"]:checked')?.value === 'no' ? 'no' : 'yes');

  const renderOdds = (): void => {
    const p = price(bookFor(state, market));
    yes.textContent = fmtPct(p, 0);
    no.textContent = fmtPct(1 - p, 0);
    bar.style.width = `${(p * 100).toFixed(1)}%`;
    const moved = state.bets.some((b) => b.marketId === market.id);
    note.textContent = moved
      ? `Cote du Oui après vos paris : ${fmtPct(p, 0)}. Cote initiale : ${fmtPct(market.p0, 0)}. Cette cote est locale et ne reflète que vos propres paris.`
      : note.textContent;
  };

  const renderPosition = (): void => {
    const p = positions(state).find((x) => x.marketId === market.id);
    if (!p) {
      positionEl.innerHTML = '<p>Aucun pari enregistré sur ce marché dans ce navigateur.</p>';
      return;
    }
    const s = settle(p, market);
    const rows: [string, string][] = [
      ['Paris enregistrés', String(p.bets)],
      ['Mise totale', tokens(p.stake)],
      ['Parts Oui', fmtDec(p.yesShares, 2)],
      ['Parts Non', fmtDec(p.noShares, 2)],
      ['Votre probabilité du Oui', fmtPct(p.estimate, 0)],
    ];
    if (s) {
      rows.push(['Résultat du marché', market.outcome ? 'Oui' : 'Non'], ['Gain', tokens(s.payout)], ['Gain net', signed(s.net)]);
    } else {
      rows.push(['Gain net si Oui', signed(p.yesShares - p.stake)], ['Gain net si Non', signed(p.noShares - p.stake)]);
    }
    positionEl.innerHTML = `<dl class="facts">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  };

  const renderPreview = (): void => {
    if (!form || !stakeEl || !preview) return;
    const stake = Number(stakeEl.value);
    if (validateStake(stake)) {
      preview.innerHTML = '';
      return;
    }
    const s = side();
    const t = trade(bookFor(state, market), s, stake);
    const net = t.shares - stake;
    preview.innerHTML =
      `<dt>Parts obtenues</dt><dd>${esc(fmtDec(t.shares, 2))}</dd>` +
      `<dt>Gain net si ${s === 'yes' ? 'Oui' : 'Non'}</dt><dd>${esc(signed(net))}</dd>` +
      `<dt>Perte si ${s === 'yes' ? 'Non' : 'Oui'}</dt><dd>${esc(tokens(stake))}</dd>` +
      `<dt>Cote du Oui après ce pari</dt><dd>${esc(fmtPct(t.priceAfter, 1))}</dd>`;
  };

  const lastEstimate = positions(state).find((x) => x.marketId === market.id)?.estimate;
  if (estEl && lastEstimate !== undefined) estEl.value = String(Math.round(lastEstimate * 100));

  if (form && stakeEl && estEl) {
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((el) => {
      el.disabled = false;
    });
    form.addEventListener('input', renderPreview);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      feedback!.classList.remove('error');
      const stake = Number(stakeEl.value);
      const est = Number(estEl.value);
      const err = validateStake(stake) ?? (!Number.isFinite(est) || est < 1 || est > 99 ? 'Saisissez une probabilité entre 1 et 99 %.' : null);
      if (err) {
        feedback!.textContent = err;
        feedback!.classList.add('error');
        return;
      }
      const s = side();
      const next = placeBet(state, market, s, stake, est / 100);
      const saved = savePortfolio(next);
      state = next;
      const bet = next.bets[next.bets.length - 1]!;
      feedback!.textContent = saved
        ? `Pari enregistré : ${tokens(stake)} sur ${s === 'yes' ? 'Oui' : 'Non'}, ${fmtDec(bet.shares, 2)} parts. Cote du Oui : ${fmtPct(bet.priceBefore, 1)} puis ${fmtPct(bet.priceAfter, 1)}.`
        : 'Le stockage local du navigateur est indisponible : le pari est pris en compte pour cette page seulement.';
      if (!saved) feedback!.classList.add('error');
      renderOdds();
      renderPosition();
      renderPreview();
    });
    renderPreview();
  }
  renderOdds();
  renderPosition();
}
