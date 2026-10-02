import { resultHtml } from '../lib/indexation';
import type { CoefficientsFile } from '../lib/types';

const BASE = import.meta.env.BASE_URL;
const root = document.querySelector<HTMLElement>('[data-calculator]');

if (root) {
  const select = root.querySelector<HTMLSelectElement>('select')!;
  const input = root.querySelector<HTMLInputElement>('input[type="date"]')!;
  const out = root.querySelector<HTMLElement>('[data-result]')!;
  let file: CoefficientsFile | undefined;
  let loading: Promise<void> | undefined;

  const compute = (): void => {
    if (!file) return;
    const security = file.meta.securities.find((s) => s.id === select.value);
    if (security) out.innerHTML = resultHtml({ file, security, date: input.value });
  };

  const load = (): Promise<void> =>
    (loading ??= fetch(`${BASE}data/coefficients_indexation.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<CoefficientsFile>;
      })
      .then((f) => {
        file = f;
        compute();
      })
      .catch(() => {
        out.innerHTML = '<p>Le calculateur n’a pas pu charger les coefficients. Le fichier reste disponible dans la rubrique Données.</p>';
      }));

  root.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    void load().then(compute);
  });
  select.addEventListener('change', () => void load().then(compute));
  input.addEventListener('change', () => void load().then(compute));
  input.addEventListener('input', () => void load().then(compute));
  root.addEventListener('focusin', () => void load(), { once: true });
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      void load();
    }
  }, { rootMargin: '300px' });
  io.observe(root);
}
