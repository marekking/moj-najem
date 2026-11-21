// UI helpers: escaping, inline SVG icons, stacked bar chart, modal sheet, toasts.
import { formatMonthShort, formatPLN } from './domain.js';
import { getBlobUrl } from './media.js';

export function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ICONS = {
  home: '<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><path d="M2 21h20"/><path d="M8 7h1m4 0h1M8 11h1m4 0h1M8 15h1m4 0h1"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="0.5"/><rect x="12" y="6" width="3" height="11" rx="0.5"/><rect x="17" y="13" width="3" height="4" rx="0.5"/>',
  template: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
  more: '<circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  photo: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7A2 2 0 0 1 22 16.9z"/>',
  sms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  swap: '<path d="M16 3l4 4-4 4"/><path d="M20 7H4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h16"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  compare: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 2v20"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
};

export function icon(name, size = 18) {
  const path = ICONS[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function renderStackedBarChart(months, opts = {}) {
  if (!months || months.length === 0) {
    return '<div class="empty-state">Brak wpisów w wybranym okresie do pokazania na wykresie.</div>';
  }
  const slice = months.slice(-12);
  const w = Math.max(360, slice.length * 52 + 48);
  const h = opts.height || 184;
  const padL = 8;
  const padR = 8;
  const padT = 22;
  const padB = 34;
  const plotH = h - padT - padB;
  const maxVal = Math.max(100, ...slice.map((m) => m.total || 0));
  const step = (w - padL - padR) / slice.length;
  const barW = Math.min(34, Math.max(14, step - 12));

  const gridLines = [0.25, 0.5, 0.75, 1].map((frac) => {
    const y = padT + plotH * (1 - frac);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity="0.08" stroke-dasharray="3 3"/>`;
  }).join('');

  const bars = slice.map((m, i) => {
    const cx = padL + i * step + step / 2;
    const x = cx - barW / 2;
    const totalH = (m.total / maxVal) * plotH;
    const rentH = (m.rent / maxVal) * plotH;
    const utilH = (m.utilities / maxVal) * plotH;
    const yRent = padT + plotH - rentH;
    const yUtil = padT + plotH - rentH - utilH;
    const topLabel = m.total >= 1000 ? `${(m.total / 1000).toFixed(1).replace('.', ',')}k` : `${Math.round(m.total)}`;
    const tip = `${formatMonthShort(m.month)}: Najem ${formatPLN(m.rent)} | Media ${formatPLN(m.utilities)} | Razem ${formatPLN(m.total)}`;
    return `
      <g>
        <title>${esc(tip)}</title>
        <rect x="${x.toFixed(1)}" y="${yRent.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, rentH).toFixed(1)}" rx="2" fill="var(--rent-color)"/>
        <rect x="${x.toFixed(1)}" y="${yUtil.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, utilH).toFixed(1)}" rx="2" fill="var(--media-color)"/>
        <text x="${cx.toFixed(1)}" y="${Math.max(12, padT + plotH - totalH - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--text-muted)">${esc(topLabel)}</text>
        <text x="${cx.toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${esc(formatMonthShort(m.month))}</text>
      </g>`;
  }).join('');

  return `
    <div class="chart-box">
      <svg viewBox="0 0 ${w} ${h}" width="100%" style="min-width:${Math.min(w, 420)}px;max-height:${h}px;display:block">
        ${gridLines}
        <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="currentColor" stroke-opacity="0.16"/>
        ${bars}
      </svg>
    </div>
    <div class="chart-legend" style="margin-top:4px">
      <span class="legend-item"><span class="legend-swatch" style="background:var(--rent-color)"></span>Najem (czynsz)</span>
      <span class="legend-item"><span class="legend-swatch" style="background:var(--media-color)"></span>Media / opłaty</span>
    </div>`;
}

export function showToast(message, durationMs = 2600) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, durationMs);
}

let activeModalClose = null;

export function closeModal() {
  const root = document.getElementById('modalRoot');
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
  if (activeModalClose) {
    const fn = activeModalClose;
    activeModalClose = null;
    fn();
  }
}

export function openModal({ title, bodyHtml, footerHtml = '', wide = false, onMount = null, onClose = null }) {
  const root = document.getElementById('modalRoot');
  if (!root) return;
  activeModalClose = onClose || null;
  document.body.style.overflow = 'hidden';
  root.innerHTML = `
    <div class="modal-backdrop" id="modalBackdrop" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-sheet ${wide ? 'wide' : ''}">
        <div class="modal-header">
          <h2 class="modal-title">${esc(title)}</h2>
          <button type="button" class="btn btn-ghost btn-sm" id="modalCloseBtn" aria-label="Zamknij">${icon('close', 18)}</button>
        </div>
        <div class="modal-body" id="modalBody">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-footer" id="modalFooter">${footerHtml}</div>` : ''}
      </div>
    </div>`;

  const backdrop = document.getElementById('modalBackdrop');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  if (onMount) onMount(root);
}

export async function hydrateImages(container) {
  if (!container) return;
  const imgs = container.querySelectorAll('img[data-blob-key]');
  await Promise.all(Array.from(imgs).map(async (img) => {
    const key = img.getAttribute('data-blob-key');
    if (!key) return;
    const url = await getBlobUrl(key);
    if (url && img.isConnected) img.src = url;
  }));
}

export function splitBarHtml(rent, utilities, onLight = true) {
  const total = (Number(rent) || 0) + (Number(utilities) || 0);
  const rentPct = total > 0 ? Math.round((rent / total) * 100) : 50;
  const mediaPct = total > 0 ? Math.max(0, 100 - rentPct) : 50;
  return `
    <div class="split-bar ${onLight ? 'on-light' : ''}" title="Najem ${rentPct}% / Media ${mediaPct}%">
      <div class="split-bar-rent" style="width:${total > 0 ? rentPct : 0}%"></div>
      <div class="split-bar-media" style="width:${total > 0 ? mediaPct : 0}%"></div>
    </div>`;
}
