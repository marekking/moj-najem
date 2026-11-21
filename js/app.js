// Main entry point & screen renderer for "Mój Najem" offline-first PWA.
import {
  DOC_CATEGORIES,
  PHOTO_STAGES,
  TEMPLATE_CATEGORIES,
  UTILITY_KEYS,
  appendAudit,
  buildLeaseReminderIcs,
  buildPaymentFromLease,
  computeIncomeHierarchy,
  computeMeterDelta,
  createEmptyState,
  currentMonthKey,
  exportPaymentsCsv,
  formatBytes,
  formatDatePL,
  formatMonthPL,
  formatPLN,
  getActiveLeaseForUnit,
  getArchivedLeasesForUnit,
  getEffectiveMediaAmount,
  getExpectedMonthlyRunRate,
  getLeaseStatus,
  getPaymentBalance,
  missingMonthsForLease,
  pluralPL,
  roundMoney,
  todayISO,
} from './domain.js';
import {
  clearAllData,
  deleteBlob,
  exportFullBackupZip,
  getBlob,
  getStorageInfo,
  loadState,
  requestPersistentStorage,
  saveState,
} from './db.js';
import { createDemoData } from './demo.js';
import { clearUrlCache, shareOrDownloadBlob, triggerDownload } from './media.js';
import { esc, hydrateImages, icon, renderStackedBarChart, showToast, splitBarHtml } from './ui_helpers.js';
import {
  openAddDocumentModal,
  openAddPhotoModal,
  openAddTemplateModal,
  openArchiveLeaseModal,
  openComparePhotosModal,
  openConfirmModal,
  openDocumentPreviewModal,
  openImportZipModal,
  openInstallmentsModal,
  openLeaseModal,
  openMetersModal,
  openPaymentModal,
  openPhotoViewerModal,
  openPropertyModal,
  openSetPinModal,
  openTurnoverWizard,
  openUnitModal,
  openUnlockModal,
} from './modals.js';

let state = null;
let editUnlocked = false;
let relockTimer = null;

const nav = {
  tab: 'dashboard', // 'dashboard' | 'properties' | 'finances' | 'templates' | 'more'
  selectedPropertyId: null,
  selectedUnitId: null,
  unitTab: 'overview', // 'overview' | 'payments' | 'photos' | 'docs' | 'history'
  photoFilter: 'all', // 'all' | 'start' | 'during' | 'end'
  dashPeriod: 'month', // 'month' | 'year' | 'all'
  finPeriod: 'year', // 'month' | 'year' | 'last12' | 'all'
  finMonth: currentMonthKey(),
  finYear: String(new Date().getFullYear()),
  finStatus: 'all', // 'all' | 'paid' | 'pending'
  collapsedFinProps: new Set(),
  propSearch: '',
  propMode: 'active', // 'active' | 'archive'
  moreSection: 'backup', // 'backup' | 'security' | 'audit' | 'trash' | 'install'
};

function isReadOnlySnapshot() {
  return !!state?.readOnlySnapshot;
}

function canEditNow() {
  if (isReadOnlySnapshot()) return false;
  if (!state?.settings?.requireUnlockForEdit) return true;
  return editUnlocked;
}

function bumpAutoLock() {
  if (relockTimer) clearTimeout(relockTimer);
  if (!editUnlocked || !state?.settings?.requireUnlockForEdit) return;
  const mins = Math.max(1, Number(state.settings.autoLockMinutes) || 5);
  relockTimer = setTimeout(() => {
    editUnlocked = false;
    renderAll();
    showToast('Tryb edycji automatycznie zablokowany 🔒');
  }, mins * 60 * 1000);
}

function unlockEditing() {
  if (isReadOnlySnapshot()) {
    showToast('To jest migawka tylko do odczytu (bez edycji).');
    return;
  }
  editUnlocked = true;
  bumpAutoLock();
  renderAll();
  showToast('Tryb edycji odblokowany.');
}

function lockEditing() {
  editUnlocked = false;
  if (relockTimer) clearTimeout(relockTimer);
  renderAll();
  showToast('Zablokowano do trybu podglądu 🔒');
}

function withEditGuard(actionFn) {
  if (isReadOnlySnapshot()) {
    showToast('To jest kopia tylko do odczytu — edycja jest wyłączona.');
    return;
  }
  if (canEditNow()) {
    bumpAutoLock();
    actionFn();
    return;
  }
  openUnlockModal({
    state,
    onUnlocked: () => {
      editUnlocked = true;
      bumpAutoLock();
      renderAll();
      actionFn();
    },
  });
}

async function saveAndRender() {
  await saveState(state);
  applyTheme();
  renderAll();
}

function applyTheme() {
  const mode = state?.settings?.theme || 'system';
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.setAttribute('data-theme', mode);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function countAlerts() {
  const now = todayISO();
  const threshold = state?.settings?.expiringAlertDays || 60;
  let expiring = 0;
  let pendingPay = 0;
  const activeUnitIds = new Set(state.units.filter((u) => !u.deletedAt).map((u) => u.id));
  for (const l of state.leases) {
    if (l.deletedAt || l.archivedAt || !activeUnitIds.has(l.unitId)) continue;
    const st = getLeaseStatus(l, now, threshold);
    if (st.code === 'expiring' || st.code === 'expired') expiring++;
  }
  for (const p of state.payments) {
    if (!p.deletedAt && activeUnitIds.has(p.unitId) && (p.status === 'pending' || p.status === 'partial')) pendingPay++;
  }
  return { expiring, pendingPay, total: expiring + pendingPay };
}

function getAvailableYears() {
  const cur = String(new Date().getFullYear());
  const set = new Set([cur]);
  for (const p of state.payments) {
    if (!p.deletedAt && p.month) set.add(p.month.slice(0, 4));
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

function getAvailableMonths() {
  const cur = currentMonthKey();
  const set = new Set([cur]);
  for (const p of state.payments) {
    if (!p.deletedAt && p.month) set.add(p.month);
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

function renderChrome() {
  const alerts = countAlerts();
  const tabs = [
    { id: 'dashboard', label: 'Start', iconName: 'home', badge: alerts.expiring || 0 },
    { id: 'properties', label: 'Lokale', iconName: 'building', badge: 0 },
    { id: 'finances', label: 'Finanse', iconName: 'chart', badge: alerts.pendingPay || 0 },
    { id: 'templates', label: 'Szablony', iconName: 'template', badge: 0 },
    { id: 'more', label: 'Więcej', iconName: 'more', badge: 0 },
  ];

  // Desktop sidebar
  const sideNav = document.getElementById('sideNav');
  sideNav.innerHTML = tabs.map((t) => `
    <button type="button" class="side-btn ${nav.tab === t.id ? 'active' : ''}" data-nav="${t.id}">
      ${icon(t.iconName, 19)}
      <span>${esc(t.label)}</span>
      ${t.badge ? `<span class="pill-count">${t.badge}</span>` : ''}
    </button>
  `).join('');
  sideNav.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.nav));
  });

  // Mobile bottom tab bar
  const tabbar = document.getElementById('tabbar');
  tabbar.innerHTML = tabs.map((t) => `
    <button type="button" class="tab-btn ${nav.tab === t.id ? 'active' : ''}" data-nav="${t.id}">
      ${icon(t.iconName, 22)}
      <span>${esc(t.label)}</span>
      ${t.badge ? `<span class="tab-badge">${t.badge}</span>` : ''}
    </button>
  `).join('');
  tabbar.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.nav));
  });

  // Sidebar footer
  const lastBk = state.settings.lastBackupAt ? formatDatePL(state.settings.lastBackupAt.slice(0, 10)) : 'brak';
  document.getElementById('sidebarStatus').innerHTML = `
    <div>Tryb: <strong>${isReadOnlySnapshot() ? 'Podgląd (migawka)' : 'Offline (lokalnie)'}</strong></div>
    <div>Ostatnia kopia ZIP: <strong>${esc(lastBk)}</strong></div>
  `;

  // Topbar
  const left = document.getElementById('topbarLeft');
  const right = document.getElementById('topbarRight');
  let title = 'Mój Najem';
  let backAction = null;

  if (nav.tab === 'dashboard') title = 'Przegląd';
  else if (nav.tab === 'finances') title = 'Finanse i przychody';
  else if (nav.tab === 'templates') title = 'Szablony in blanco';
  else if (nav.tab === 'more') title = 'Kopia, PIN i więcej';
  else if (nav.tab === 'properties') {
    if (nav.selectedUnitId) {
      const u = state.units.find((x) => x.id === nav.selectedUnitId);
      const p = u ? state.properties.find((x) => x.id === u.propertyId) : null;
      title = p?.kind === 'single' ? p.name : (u?.name || 'Lokal');
      backAction = () => {
        if (p?.kind === 'building') {
          nav.selectedUnitId = null;
          nav.selectedPropertyId = p.id;
        } else {
          nav.selectedUnitId = null;
          nav.selectedPropertyId = null;
        }
        renderAll();
      };
    } else if (nav.selectedPropertyId) {
      const p = state.properties.find((x) => x.id === nav.selectedPropertyId);
      title = p?.name || 'Nieruchomość';
      backAction = () => {
        nav.selectedPropertyId = null;
        renderAll();
      };
    } else {
      title = 'Nieruchomości';
    }
  }

  left.innerHTML = `
    ${backAction ? `<button type="button" class="btn btn-ghost btn-sm" id="tbBack" aria-label="Wróć">${icon('back', 19)} Wróć</button>` : ''}
    <div class="topbar-title">${esc(title)}</div>
  `;
  if (backAction) document.getElementById('tbBack').addEventListener('click', backAction);

  if (isReadOnlySnapshot()) {
    right.innerHTML = `<span class="lock-pill readonly-mode" title="Kopia tylko do odczytu">${icon('eye', 14)} Tylko wgląd</span>`;
  } else if (!state.settings.requireUnlockForEdit) {
    right.innerHTML = `<button type="button" class="lock-pill unlocked" id="tbLockBtn" title="Blokada edycji jest wyłączona w ustawieniach">${icon('unlock', 14)} Edycja</button>`;
    document.getElementById('tbLockBtn').addEventListener('click', () => {
      switchTab('more');
      nav.moreSection = 'security';
      renderAll();
    });
  } else if (editUnlocked) {
    right.innerHTML = `<button type="button" class="lock-pill unlocked" id="tbLockBtn" title="Kliknij, aby ponownie zablokować edycję">${icon('unlock', 14)} Edycja aktywna</button>`;
    document.getElementById('tbLockBtn').addEventListener('click', lockEditing);
  } else {
    right.innerHTML = `<button type="button" class="lock-pill locked" id="tbLockBtn" title="Kliknij, aby odblokować edycję">${icon('lock', 14)} Tylko podgląd</button>`;
    document.getElementById('tbLockBtn').addEventListener('click', () => {
      openUnlockModal({ state, onUnlocked: unlockEditing });
    });
  }

  // Demo or Read-Only banner
  const banner = document.getElementById('demoBanner');
  if (isReadOnlySnapshot()) {
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <span>${icon('lock', 13)} <strong>Tryb podglądu (migawka)</strong> — stan z ${esc(formatDatePL(state.readOnlySnapshot.exportedAt?.slice(0, 10)))}. Edycja jest wyłączona.</span>
      <button type="button" class="btn btn-xs" id="bannerExitRo">Wczytaj pełną kopię</button>
    `;
    document.getElementById('bannerExitRo').addEventListener('click', () => {
      nav.tab = 'more'; nav.moreSection = 'backup'; renderAll();
    });
  } else if (state.isDemo) {
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <span><strong>Tryb przykładowy:</strong> załadowano fikcyjne mieszkania i zdjęcia, żebyś mógł wszystko wypróbować.</span>
      <button type="button" class="btn btn-xs" id="bannerClearDemo">Zacznij na czysto</button>
    `;
    document.getElementById('bannerClearDemo').addEventListener('click', confirmResetToEmpty);
  } else {
    banner.classList.add('hidden');
  }
}

function switchTab(id) {
  nav.tab = id;
  nav.selectedPropertyId = null;
  nav.selectedUnitId = null;
  window.scrollTo(0, 0);
  renderAll();
}

function openUnit(unitId, subTab = 'overview') {
  nav.tab = 'properties';
  nav.selectedUnitId = unitId;
  nav.unitTab = subTab;
  window.scrollTo(0, 0);
  renderAll();
}

function openProperty(propId) {
  const prop = state.properties.find((p) => p.id === propId);
  if (!prop) return;
  const units = state.units.filter((u) => !u.deletedAt && u.propertyId === propId);
  if (prop.kind === 'single' && units.length === 1) {
    openUnit(units[0].id);
    return;
  }
  nav.tab = 'properties';
  nav.selectedPropertyId = propId;
  nav.selectedUnitId = null;
  window.scrollTo(0, 0);
  renderAll();
}

function confirmResetToEmpty() {
  openConfirmModal({
    title: 'Rozpocząć na czysto?',
    message: 'Usunie to wszystkie dane przykładowe (nieruchomości, zdjęcia i wpłaty demo), abyś mógł dodać swoje prawdziwe lokale. Zapisane szablony też zostaną wyczyszczone.',
    confirmLabel: 'Wyczyść i zacznij od zera',
    danger: true,
    onConfirm: async () => {
      await clearAllData();
      clearUrlCache();
      state = createEmptyState(false);
      appendAudit(state, 'Rozpoczęto z czystą bazą', 'Wyczyszczono dane przykładowe.');
      await saveState(state);
      editUnlocked = true;
      bumpAutoLock();
      nav.tab = 'properties';
      nav.selectedPropertyId = null;
      nav.selectedUnitId = null;
      renderAll();
      showToast('Gotowe! Możesz dodać pierwszą nieruchomość.');
    },
  });
}

// ---------- DASHBOARD ----------
function renderDashboard(el) {
  const curMonth = currentMonthKey();
  const curYear = curMonth.slice(0, 4);
  const periodLabel = nav.dashPeriod === 'month'
    ? formatMonthPL(curMonth)
    : nav.dashPeriod === 'year'
      ? `Rok ${curYear}`
      : 'Od początku (całość)';

  const summary = computeIncomeHierarchy(state, {
    period: nav.dashPeriod === 'month' ? 'month' : nav.dashPeriod === 'year' ? 'year' : 'all',
    monthKey: curMonth,
    year: curYear,
  });
  const chartData = computeIncomeHierarchy(state, { period: 'last12', refMonth: curMonth });
  const runRate = getExpectedMonthlyRunRate(state);
  const tot = summary.portfolio;

  const activeUnits = state.units.filter((u) => !u.deletedAt);
  const activeProps = state.properties.filter((p) => !p.deletedAt);
  const nowISO = todayISO();
  const threshold = state.settings.expiringAlertDays || 60;

  let occupiedCount = 0;
  let vacantCount = 0;
  const expiringList = [];
  for (const u of activeUnits) {
    const l = getActiveLeaseForUnit(state, u.id);
    if (!l) { vacantCount++; continue; }
    occupiedCount++;
    const st = getLeaseStatus(l, nowISO, threshold);
    if (st.code === 'expiring' || st.code === 'expired') {
      const prop = activeProps.find((p) => p.id === u.propertyId);
      expiringList.push({ property: prop, unit: u, lease: l, status: st });
    }
  }
  expiringList.sort((a, b) => (a.status.daysLeft ?? 999) - (b.status.daysLeft ?? 999));

  const pendingPayments = state.payments
    .filter((p) => !p.deletedAt && (p.status === 'pending' || p.status === 'partial') && activeUnits.some((u) => u.id === p.unitId))
    .sort((a, b) => a.month.localeCompare(b.month));

  const missingCurLeases = state.leases.filter((l) => {
    if (l.deletedAt || l.archivedAt) return false;
    if (!activeUnits.some((u) => u.id === l.unitId)) return false;
    if (l.startDate && l.startDate.slice(0, 7) > curMonth) return false;
    if (!l.isIndefinite && l.endDate && l.endDate.slice(0, 7) < curMonth) return false;
    return !state.payments.some((p) => !p.deletedAt && p.leaseId === l.id && p.month === curMonth);
  });

  const rentShare = tot.total > 0 ? Math.round((tot.rent / tot.total) * 100) : 0;
  const mediaShare = tot.total > 0 ? 100 - rentShare : 0;

  el.innerHTML = `
    <div class="row-between">
      <div>
        <h1 class="section-title" style="font-size:20px">Łączny przychód portfela</h1>
        <p class="section-sub">${esc(periodLabel)} • wszystkie nieruchomości i mieszkania</p>
      </div>
      <div class="segmented" role="tablist">
        <button type="button" data-dp="month" class="${nav.dashPeriod === 'month' ? 'active' : ''}">Ten miesiąc</button>
        <button type="button" data-dp="year" class="${nav.dashPeriod === 'year' ? 'active' : ''}">Rok ${esc(curYear)}</button>
        <button type="button" data-dp="all" class="${nav.dashPeriod === 'all' ? 'active' : ''}">Całość</button>
      </div>
    </div>

    <div class="hero-card">
      <div class="hero-label">Razem (najem + media) • ${tot.count ? `${pluralPL(tot.count, 'wpis', 'wpisy', 'wpisów')}` : 'brak wpisów w okresie'}</div>
      <div class="hero-amount num">${esc(formatPLN(tot.total))}</div>
      <div class="hero-split">
        <div class="hero-box">
          <div class="hero-box-label"><span class="hero-dot rent"></span>Bezpośrednio z najmu</div>
          <div class="hero-box-val num">${esc(formatPLN(tot.rent))}</div>
          <div class="hero-box-sub">${rentShare}% całości • opłac.: ${esc(formatPLN(tot.paidRent))}</div>
        </div>
        <div class="hero-box">
          <div class="hero-box-label"><span class="hero-dot media"></span>Media i opłaty</div>
          <div class="hero-box-val num">${esc(formatPLN(tot.utilities))}</div>
          <div class="hero-box-sub">${mediaShare}% całości • opłac.: ${esc(formatPLN(tot.paidUtilities))}</div>
        </div>
      </div>
      ${splitBarHtml(tot.rent, tot.utilities, false)}
      ${tot.pendingTotal > 0 ? `<div class="text-xs" style="margin-top:10px;opacity:0.92;display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#f6c453"></span><span>W tym oczekuje na wpłatę: <strong class="num">${esc(formatPLN(tot.pendingTotal))}</strong> (${pluralPL(tot.pendingCount, 'pozycja', 'pozycje', 'pozycji')})</span></div>` : ''}
    </div>

    <div class="grid-kpi">
      <div class="kpi-tile">
        <div class="kpi-val num">${activeProps.length}</div>
        <div class="kpi-label">${pluralPL(activeProps.length, 'nieruchomość', 'nieruchomości', 'nieruchomości').replace(/^\d+\s+/, '')} (${activeUnits.length} lok.)</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-val num text-ok">${occupiedCount}<span class="muted" style="font-size:14px;font-weight:600"> / ${activeUnits.length}</span></div>
        <div class="kpi-label">Wynajęte (${vacantCount} wolne)</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-val num">${esc(formatPLN(runRate.rent))}</div>
        <div class="kpi-label">Bieżący najem / mies.</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-val num">${esc(formatPLN(runRate.depositsHeld))}</div>
        <div class="kpi-label">Kaucje w depozycie</div>
      </div>
    </div>

    ${expiringList.length ? `
      <div class="card stack-sm">
        <div class="section-header">
          <h2 class="section-title">${icon('alert', 16)} Kończące się umowy (${expiringList.length})</h2>
          <span class="text-xs muted">Alerty: do ${threshold} dni przed końcem</span>
        </div>
        ${expiringList.map((item) => `
          <div class="alert-row ${item.status.tone === 'danger' ? 'danger' : ''}">
            <div style="min-width:0;flex:1">
              <strong>${esc(item.property?.kind === 'single' ? item.property.name : `${item.property?.name} — ${item.unit.name}`)}</strong>
              <div class="text-xs muted">${esc(item.lease.tenant?.name)} • koniec: <strong>${esc(formatDatePL(item.lease.endDate))}</strong> (${esc(item.status.label)})</div>
            </div>
            <div class="inline-flex">
              <button type="button" class="btn btn-xs" data-ics="${esc(item.lease.id)}" title="Dodaj przypomnienie do Kalendarza iPhone">${icon('calendar', 13)} .ics</button>
              <button type="button" class="btn btn-primary btn-xs" data-open-unit="${esc(item.unit.id)}">Otwórz</button>
            </div>
          </div>
        `).join('')}
      </div>` : ''}

    ${missingCurLeases.length && !isReadOnlySnapshot() ? `
      <div class="card card-tight row-between" style="background:var(--primary-tint);border-color:transparent">
        <div class="text-sm"><strong>${esc(formatMonthPL(curMonth))}:</strong> ${pluralPL(missingCurLeases.length, 'aktywna umowa', 'aktywne umowy', 'aktywnych umów')} nie ma jeszcze wpisu do odhaczenia.</div>
        <button type="button" class="btn btn-primary btn-xs" id="dashGenCur">${icon('plus', 13)} Nalicz stawki z umów</button>
      </div>` : ''}

    ${pendingPayments.length ? `
      <div class="card card-flush">
        <div class="prop-head">
          <div>
            <h2 class="section-title">Do odhaczenia / oczekujące wpłaty (${pendingPayments.length})</h2>
            <p class="section-sub">Odhacz całość jednym kliknięciem albo dodaj wpłatę częściową (w ratach)</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="dashGoFin">Wszystkie →</button>
        </div>
        <div class="unit-list">
          ${pendingPayments.slice(0, 8).map((p) => {
            const u = activeUnits.find((x) => x.id === p.unitId);
            const prop = u ? activeProps.find((x) => x.id === u.propertyId) : null;
            const bal = getPaymentBalance(p);
            const isPart = bal.state === 'partial';
            return `
              <div class="doc-row">
                <div class="doc-info">
                  <div class="doc-title">
                    ${esc(prop?.kind === 'single' ? prop.name : `${prop?.name} — ${u?.name}`)}
                    ${isPart ? `<span class="badge badge-warn">Część: ${esc(formatPLN(bal.paid))} / ${esc(formatPLN(bal.expected))}</span>` : ''}
                  </div>
                  <div class="doc-sub">${esc(formatMonthPL(p.month))} • Najem <span class="num text-rent">${esc(formatPLN(p.rentAmount))}</span> + Media <span class="num text-media">${esc(formatPLN(bal.utilities))}</span>${isPart ? ` • <strong>pozostało ${esc(formatPLN(bal.remaining))}</strong>` : ''}</div>
                </div>
                <div class="inline-flex">
                  <strong class="num">${esc(formatPLN(isPart ? bal.remaining : bal.expected))}</strong>
                  <button type="button" class="btn btn-xs" data-part-pay="${esc(p.id)}" title="Wpisz przelew, datę, ratę lub nadpłatę">Przelew / raty</button>
                  <button type="button" class="btn btn-soft btn-xs" data-mark-paid="${esc(p.id)}">${icon('check', 13)} ${isPart ? 'Dopłacono' : 'Opłacono'}</button>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>` : ''}

    <div class="card">
      <div class="section-header" style="margin-bottom:8px">
        <div>
          <h2 class="section-title">Przychody miesięczne (ostatnie 12 mies.)</h2>
          <p class="section-sub">Podział na czynsz najmu oraz media/opłaty</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="dashDetailFin">Szczegóły →</button>
      </div>
      ${renderStackedBarChart(chartData.byMonth)}
    </div>

    <div class="card card-flush">
      <div class="prop-head">
        <div>
          <h2 class="section-title">Podsumowanie wg nieruchomości</h2>
          <p class="section-sub">${esc(periodLabel)}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="dashAllProps">Zobacz wszystkie →</button>
      </div>
      ${summary.byProperty.length ? `
      <div class="unit-list">
        ${summary.byProperty.map(({ property, totals, units }) => `
          <div class="unit-row" data-go-prop="${esc(property.id)}">
            <div class="unit-left">
              <div class="unit-name">
                ${esc(property.name)}
                <span class="badge badge-neutral">${property.kind === 'building' ? `${units.length} lok.` : 'pojedyncza'}</span>
              </div>
              <div class="unit-meta">${esc(property.address)}</div>
              ${splitBarHtml(totals.rent, totals.utilities, true)}
            </div>
            <div class="unit-right">
              <div class="unit-income num">${esc(formatPLN(totals.total))}</div>
              <div class="unit-split num">
                <span class="text-rent">${esc(formatPLN(totals.rent))}</span> +
                <span class="text-media">${esc(formatPLN(totals.utilities))}</span>
              </div>
            </div>
          </div>
        `).join('')}
      </div>` : `<div class="empty-state"><strong>Brak nieruchomości</strong>Dodaj swoją pierwszą nieruchomość w zakładce „Lokale”.</div>`}
    </div>
  `;

  el.querySelectorAll('[data-dp]').forEach((b) => {
    b.addEventListener('click', () => { nav.dashPeriod = b.dataset.dp; renderAll(); });
  });
  el.querySelectorAll('[data-open-unit]').forEach((b) => {
    b.addEventListener('click', () => openUnit(b.dataset.openUnit));
  });
  el.querySelectorAll('[data-go-prop]').forEach((b) => {
    b.addEventListener('click', () => openProperty(b.dataset.goProp));
  });
  el.querySelectorAll('[data-ics]').forEach((b) => {
    b.addEventListener('click', () => exportIcsByLeaseId(b.dataset.ics));
  });
  document.getElementById('dashGenCur')?.addEventListener('click', () => withEditGuard(async () => {
    for (const l of missingCurLeases) state.payments.push(buildPaymentFromLease(l, curMonth, 'pending'));
    appendAudit(state, 'Naliczono stawki miesięczne', `${formatMonthPL(curMonth)} (${missingCurLeases.length} umów)`);
    await saveAndRender();
    showToast(`Dodano ${missingCurLeases.length} wpisów do odhaczenia na ${formatMonthPL(curMonth)}.`);
  }));
  el.querySelectorAll('[data-part-pay]').forEach((b) => {
    b.addEventListener('click', () => withEditGuard(() => {
      const pay = state.payments.find((x) => x.id === b.dataset.partPay);
      if (!pay) return;
      const u = activeUnits.find((x) => x.id === pay.unitId);
      const prop = u ? activeProps.find((x) => x.id === u.propertyId) : null;
      if (u && prop) openInstallmentsModal({ state, unit: u, property: prop, payment: pay, saveAndRender });
    }));
  });
  el.querySelectorAll('[data-mark-paid]').forEach((b) => {
    b.addEventListener('click', () => {
      withEditGuard(async () => {
        const pay = state.payments.find((x) => x.id === b.dataset.markPaid);
        if (!pay) return;
        const bal = getPaymentBalance(pay);
        if (bal.state === 'partial' && bal.remaining > 0) {
          if (!Array.isArray(pay.installments)) pay.installments = [];
          pay.installments.push({ id: `inst_${Date.now()}`, amount: bal.remaining, date: todayISO(), payer: '', note: 'Dopłata reszty' });
        }
        pay.status = 'paid';
        pay.paidDate = todayISO();
        appendAudit(state, 'Potwierdzono wpłatę', `${formatMonthPL(pay.month)}: ${formatPLN(pay.rentAmount + getEffectiveMediaAmount(pay))}`);
        await saveAndRender();
        showToast('Oznaczono jako opłacone ✓');
      });
    });
  });
  document.getElementById('dashGoFin')?.addEventListener('click', () => switchTab('finances'));
  document.getElementById('dashDetailFin')?.addEventListener('click', () => switchTab('finances'));
  document.getElementById('dashAllProps')?.addEventListener('click', () => switchTab('properties'));
}

function exportIcsByLeaseId(leaseId) {
  const lease = state.leases.find((l) => l.id === leaseId);
  if (!lease) return;
  const unit = state.units.find((u) => u.id === lease.unitId);
  const prop = unit ? state.properties.find((p) => p.id === unit.propertyId) : null;
  if (!unit || !prop) return;
  try {
    const ics = buildLeaseReminderIcs(prop, unit, lease);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    triggerDownload(blob, `koniec_umowy_${unit.name.replace(/[^a-z0-9]/gi, '_')}.ics`);
    showToast('Pobrano przypomnienie .ics (60 / 30 / 14 dni przed końcem).');
  } catch (err) {
    showToast(err.message);
  }
}

// ---------- PROPERTIES LIST / BUILDING DETAIL / UNIT DETAIL ----------
function renderPropertiesScreen(el) {
  if (nav.selectedUnitId) { renderUnitDetail(el); return; }
  if (nav.selectedPropertyId) { renderBuildingDetail(el); return; }

  const activeProps = state.properties.filter((p) => !p.deletedAt);
  const activeUnits = state.units.filter((u) => !u.deletedAt);
  const curMonth = currentMonthKey();
  const nowISO = todayISO();
  const threshold = state.settings.expiringAlertDays || 60;
  const allInc = computeIncomeHierarchy(state, { period: 'all' });
  const incPropMap = new Map(allInc.byProperty.map((x) => [x.property.id, x]));

  const allArchived = state.leases
    .filter((l) => !l.deletedAt && !!l.archivedAt && activeUnits.some((u) => u.id === l.unitId))
    .sort((a, b) => String(b.endDate || b.archivedAt).localeCompare(String(a.endDate || a.archivedAt)));

  const q = nav.propSearch.trim().toLowerCase();
  const filtered = activeProps.filter((p) => {
    if (!q) return true;
    if (p.name.toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q)) return true;
    const pUnits = activeUnits.filter((u) => u.propertyId === p.id);
    return pUnits.some((u) => {
      if (u.name.toLowerCase().includes(q)) return true;
      return state.leases.some((l) => !l.deletedAt && l.unitId === u.id && (l.tenant?.name || '').toLowerCase().includes(q));
    });
  });

  if (nav.propMode === 'archive') {
    const filteredArch = allArchived.filter((l) => {
      if (!q) return true;
      const u = activeUnits.find((x) => x.id === l.unitId);
      const p = u ? activeProps.find((x) => x.id === u.propertyId) : null;
      return (l.tenant?.name || '').toLowerCase().includes(q)
        || (l.tenant?.phone || '').toLowerCase().includes(q)
        || (u?.name || '').toLowerCase().includes(q)
        || (p?.name || '').toLowerCase().includes(q)
        || (p?.address || '').toLowerCase().includes(q);
    });
    el.innerHTML = `
      <div class="section-header">
        <div class="segmented">
          <button type="button" data-pm="active">Nieruchomości (${activeProps.length})</button>
          <button type="button" data-pm="archive" class="active">Archiwum lokatorów (${allArchived.length})</button>
        </div>
        <div style="flex:1;min-width:190px">
          <input type="search" id="propSearch" value="${esc(nav.propSearch)}" placeholder="Szukaj byłego najemcy, tel., adresu…" style="width:100%;padding:8px 12px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);font-family:inherit;font-size:16px" />
        </div>
      </div>
      ${filteredArch.length === 0 ? `<div class="card empty-state"><strong>${allArchived.length ? 'Brak wyników' : 'Archiwum lokatorów jest puste'}</strong>Po zakończeniu umowy lub użyciu kreatora „Zmiana najemcy” każdy były lokator trafia tutaj automatycznie (z dokumentami, zdjęciami przed/po, kaucją i przychodami).</div>` : `
        <div class="card card-flush">
          <div class="prop-head">
            <div>
              <h2 class="section-title">Wszyscy byli najemcy (${filteredArch.length})</h2>
              <p class="section-sub">Kliknij wiersz, aby zobaczyć umowę, zdjęcia przed/po, liczniki i rozliczenie kaucji</p>
            </div>
          </div>
          <div class="unit-list">
            ${filteredArch.map((l) => {
              const u = activeUnits.find((x) => x.id === l.unitId);
              const p = u ? activeProps.find((x) => x.id === u.propertyId) : null;
              const phCnt = state.photos.filter((x) => !x.deletedAt && x.leaseId === l.id).length;
              const docCnt = state.documents.filter((x) => !x.deletedAt && x.leaseId === l.id).length;
              const inc = computeIncomeHierarchy(state, { period: 'all', leaseId: l.id }).portfolio;
              return `
                <div class="unit-row" data-garch="${esc(l.id)}">
                  <div class="unit-left">
                    <div class="unit-name">
                      ${esc(l.tenant?.name || 'Najemca')}
                      <span class="badge badge-neutral">${esc(p?.kind === 'single' ? p.name : `${p?.name} • ${u?.name}`)}</span>
                    </div>
                    <div class="unit-meta">
                      ${esc(formatDatePL(l.startDate))} – ${esc(formatDatePL(l.endDate))}
                      ${l.tenant?.phone ? ` • ${esc(l.tenant.phone)}` : ''}
                      • ${phCnt} zdjęć • ${docCnt} dok.
                      ${l.depositSettlement ? ` • kaucja zwrócona: ${esc(formatPLN(l.depositSettlement.returnedAmount))}${l.depositSettlement.deductedAmount > 0 ? ` (potrącono ${esc(formatPLN(l.depositSettlement.deductedAmount))})` : ''}` : ''}
                    </div>
                  </div>
                  <div class="unit-right">
                    <div class="unit-income num">${esc(formatPLN(inc.total))}</div>
                    <div class="unit-split num"><span class="text-rent">${esc(formatPLN(inc.rent))}</span> + <span class="text-media">${esc(formatPLN(inc.utilities))}</span></div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`}
    `;
    el.querySelectorAll('[data-pm]').forEach((b) => b.addEventListener('click', () => { nav.propMode = b.dataset.pm; renderPropertiesScreen(el); }));
    document.getElementById('propSearch').addEventListener('input', (e) => {
      nav.propSearch = e.target.value;
      renderPropertiesScreen(el);
      const i = document.getElementById('propSearch'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
    });
    el.querySelectorAll('[data-garch]').forEach((row) => row.addEventListener('click', () => {
      const l = allArchived.find((x) => x.id === row.dataset.garch);
      const u = l ? activeUnits.find((x) => x.id === l.unitId) : null;
      const p = u ? activeProps.find((x) => x.id === u.propertyId) : null;
      if (l && u && p) void openArchiveLeaseModal({ state, lease: l, property: p, unit: u });
    }));
    return;
  }

  el.innerHTML = `
    <div class="section-header">
      <div class="segmented">
        <button type="button" data-pm="active" class="active">Nieruchomości (${activeProps.length})</button>
        <button type="button" data-pm="archive">Archiwum lokatorów (${allArchived.length})</button>
      </div>
      <div style="flex:1;min-width:180px">
        <input type="search" id="propSearch" value="${esc(nav.propSearch)}" placeholder="Szukaj adresu, lokalu lub najemcy…" style="width:100%;padding:8px 12px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);font-family:inherit;font-size:16px" />
      </div>
      ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-primary" id="btnAddProp">${icon('plus', 16)} Dodaj nieruchomość</button>` : ''}
    </div>

    ${filtered.length === 0 ? `
      <div class="card empty-state">
        <strong>${activeProps.length ? 'Brak wyników wyszukiwania' : 'Nie masz jeszcze żadnej nieruchomości'}</strong>
        <p>${activeProps.length ? 'Spróbuj innej frazy.' : 'Dodaj pojedyncze mieszkanie, dom, lokal usługowy lub kamienicę z wieloma mieszkaniami.'}</p>
        ${!activeProps.length && !isReadOnlySnapshot() ? `<button type="button" class="btn btn-primary" id="btnAddPropEmpty">${icon('plus', 15)} Dodaj pierwszą nieruchomość</button>` : ''}
      </div>` : ''}

    <div class="stack-md">
      ${filtered.map((prop) => {
        const units = activeUnits.filter((u) => u.propertyId === prop.id);
        const propSum = incPropMap.get(prop.id)?.totals || { rent: 0, utilities: 0, total: 0 };
        const isBuilding = prop.kind === 'building' || units.length > 1;
        const unitMap = new Map((incPropMap.get(prop.id)?.units || []).map((x) => [x.unit.id, x.totals]));

        if (!isBuilding && units.length === 1) {
          const u = units[0];
          const lease = getActiveLeaseForUnit(state, u.id);
          const st = getLeaseStatus(lease, nowISO, threshold);
          const mPay = state.payments.find((p) => !p.deletedAt && p.unitId === u.id && p.month === curMonth);
          return `
            <div class="prop-card">
              <div class="prop-head prop-head-clickable" data-open-unit="${esc(u.id)}">
                <div style="min-width:0;flex:1">
                  <div class="unit-name">
                    ${esc(prop.name)}
                    <span class="badge badge-${st.tone}">${esc(st.label)}</span>
                    ${mPay?.status === 'pending' ? '<span class="badge badge-warn">Brak wpłaty</span>' : ''}
                  </div>
                  <div class="prop-addr">${esc(prop.address)}${u.area ? ` • ${u.area} m²` : ''}</div>
                  <div class="text-sm muted" style="margin-top:6px">
                    ${lease
                      ? `Najemca: <strong>${esc(lease.tenant?.name)}</strong> • ${esc(formatDatePL(lease.startDate))} – ${lease.isIndefinite ? 'nieokreślony' : esc(formatDatePL(lease.endDate))}`
                      : '<em>Lokal wolny — kliknij, aby dodać nową umowę</em>'}
                  </div>
                </div>
                <div class="unit-right">
                  ${lease ? `
                    <div class="unit-income num">${esc(formatPLN(lease.monthlyRent + lease.monthlyUtilities))}<span class="muted text-xs"> /m</span></div>
                    <div class="unit-split num"><span class="text-rent">${esc(formatPLN(lease.monthlyRent))}</span> + <span class="text-media">${esc(formatPLN(lease.monthlyUtilities))}</span></div>
                  ` : ''}
                  <div class="text-xs muted num" style="margin-top:4px">Łącznie: ${esc(formatPLN(propSum.total))}</div>
                </div>
              </div>
            </div>`;
        }

        // Building / Kamienica with multiple apartments
        const occupied = units.filter((u) => !!getActiveLeaseForUnit(state, u.id)).length;
        const monthlyRentSum = units.reduce((acc, u) => {
          const l = getActiveLeaseForUnit(state, u.id);
          return acc + (l ? Number(l.monthlyRent) || 0 : 0);
        }, 0);
        const monthlyMediaSum = units.reduce((acc, u) => {
          const l = getActiveLeaseForUnit(state, u.id);
          return acc + (l ? Number(l.monthlyUtilities) || 0 : 0);
        }, 0);

        return `
          <div class="prop-card">
            <div class="prop-head prop-head-clickable" data-open-prop="${esc(prop.id)}">
              <div style="min-width:0;flex:1">
                <div class="unit-name">
                  ${esc(prop.name)}
                  <span class="badge badge-rent">Kamienica • ${occupied}/${units.length} zajęte</span>
                </div>
                <div class="prop-addr">${esc(prop.address)}</div>
              </div>
              <div class="unit-right">
                <div class="unit-income num">${esc(formatPLN(monthlyRentSum + monthlyMediaSum))}<span class="muted text-xs"> /m</span></div>
                <div class="unit-split num">
                  Łącznie: <strong class="text-rent">${esc(formatPLN(propSum.rent))}</strong> + <strong class="text-media">${esc(formatPLN(propSum.utilities))}</strong>
                </div>
              </div>
            </div>
            <div class="unit-list">
              ${units.map((u) => {
                const l = getActiveLeaseForUnit(state, u.id);
                const st = getLeaseStatus(l, nowISO, threshold);
                const ut = unitMap.get(u.id) || { rent: 0, utilities: 0, total: 0 };
                return `
                  <div class="unit-row" data-open-unit="${esc(u.id)}">
                    <div class="unit-left">
                      <div class="unit-name">
                        ${esc(u.name)}
                        <span class="badge badge-${st.tone}">${esc(st.label)}</span>
                      </div>
                      <div class="unit-meta">
                        ${l ? `${esc(l.tenant?.name)} • ${esc(formatDatePL(l.startDate))} – ${l.isIndefinite ? 'nieokr.' : esc(formatDatePL(l.endDate))}` : 'Brak aktywnej umowy (pustostan)'}
                        ${u.area ? ` • ${u.area} m²` : ''}
                      </div>
                    </div>
                    <div class="unit-right">
                      <div class="unit-income num">${l ? esc(formatPLN(l.monthlyRent + l.monthlyUtilities)) + '/m' : '—'}</div>
                      <div class="unit-split num">Suma: ${esc(formatPLN(ut.total))}</div>
                    </div>
                  </div>`;
              }).join('')}
              ${!isReadOnlySnapshot() ? `
                <div style="padding:8px 16px;background:var(--surface-2);border-top:1px solid var(--border);display:flex;justify-content:flex-end">
                  <button type="button" class="btn btn-ghost btn-xs" data-add-unit-to="${esc(prop.id)}">${icon('plus', 13)} Dodaj mieszkanie w tej nieruchomości</button>
                </div>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>
  `;

  el.querySelectorAll('[data-pm]').forEach((b) => b.addEventListener('click', () => { nav.propMode = b.dataset.pm; renderPropertiesScreen(el); }));
  document.getElementById('propSearch').addEventListener('input', (e) => {
    nav.propSearch = e.target.value;
    renderPropertiesScreen(el);
    const input = document.getElementById('propSearch');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  const addHandler = () => withEditGuard(() => openPropertyModal({
    state,
    saveAndRender,
    onCreated: (prop, firstUnit) => {
      if (prop.kind === 'single' && firstUnit) openUnit(firstUnit.id);
      else openProperty(prop.id);
    },
  }));
  document.getElementById('btnAddProp')?.addEventListener('click', addHandler);
  document.getElementById('btnAddPropEmpty')?.addEventListener('click', addHandler);
  el.querySelectorAll('[data-open-prop]').forEach((b) => {
    b.addEventListener('click', () => { nav.selectedPropertyId = b.dataset.openProp; renderAll(); });
  });
  el.querySelectorAll('[data-open-unit]').forEach((b) => {
    b.addEventListener('click', () => openUnit(b.dataset.openUnit));
  });
  el.querySelectorAll('[data-add-unit-to]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const prop = state.properties.find((p) => p.id === b.dataset.addUnitTo);
      if (prop) withEditGuard(() => openUnitModal({ state, property: prop, saveAndRender }));
    });
  });
}

function renderBuildingDetail(el) {
  const prop = state.properties.find((p) => p.id === nav.selectedPropertyId && !p.deletedAt);
  if (!prop) { nav.selectedPropertyId = null; renderPropertiesScreen(el); return; }
  const units = state.units.filter((u) => !u.deletedAt && u.propertyId === prop.id);
  const nowISO = todayISO();
  const threshold = state.settings.expiringAlertDays || 60;
  const hierarchy = computeIncomeHierarchy(state, { period: 'all', propertyId: prop.id });
  const propTotals = hierarchy.portfolio;
  const monthInc = computeIncomeHierarchy(state, { period: 'month', monthKey: currentMonthKey(), propertyId: prop.id }).portfolio;
  const chartData = computeIncomeHierarchy(state, { period: 'last12', refMonth: currentMonthKey(), propertyId: prop.id });

  el.innerHTML = `
    <div class="card">
      <div class="row-between">
        <div>
          <h1 class="section-title" style="font-size:19px">${esc(prop.name)}</h1>
          <div class="prop-addr">${esc(prop.address)} • ${pluralPL(units.length, 'lokal', 'lokale', 'lokali')}</div>
          ${prop.notes ? `<p class="text-sm muted" style="margin:6px 0 0">${esc(prop.notes)}</p>` : ''}
        </div>
        ${!isReadOnlySnapshot() ? `
        <div class="inline-flex" style="flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="bdEditProp">${icon('edit', 14)} Edytuj</button>
          <button type="button" class="btn btn-primary btn-sm" id="bdAddUnit">${icon('plus', 14)} Dodaj lokal</button>
          <button type="button" class="btn btn-danger btn-sm" id="bdDelProp" aria-label="Usuń budynek">${icon('trash', 14)}</button>
        </div>` : ''}
      </div>
      <div class="grid-kpi" style="margin-top:14px">
        <div class="kpi-tile"><div class="kpi-val num">${esc(formatPLN(propTotals.total))}</div><div class="kpi-label">Łącznie (od pocz.)</div></div>
        <div class="kpi-tile"><div class="kpi-val num text-rent">${esc(formatPLN(propTotals.rent))}</div><div class="kpi-label">Z najmu (czynsz)</div></div>
        <div class="kpi-tile"><div class="kpi-val num text-media">${esc(formatPLN(propTotals.utilities))}</div><div class="kpi-label">Z mediów / opłat</div></div>
        <div class="kpi-tile"><div class="kpi-val num">${esc(formatPLN(monthInc.total))}</div><div class="kpi-label">Ten miesiąc</div></div>
      </div>
      ${splitBarHtml(propTotals.rent, propTotals.utilities, true)}
    </div>

    <div class="card card-flush">
      <div class="prop-head">
        <h2 class="section-title">Mieszkania / lokale w tej nieruchomości</h2>
      </div>
      <div class="unit-list">
        ${units.map((u) => {
          const l = getActiveLeaseForUnit(state, u.id);
          const st = getLeaseStatus(l, nowISO, threshold);
          const uSum = computeIncomeHierarchy(state, { period: 'all', unitId: u.id }).portfolio;
          return `
            <div class="unit-row" data-open-unit="${esc(u.id)}">
              <div class="unit-left">
                <div class="unit-name">${esc(u.name)} <span class="badge badge-${st.tone}">${esc(st.label)}</span></div>
                <div class="unit-meta">
                  ${l ? `${esc(l.tenant?.name)} • ${esc(formatDatePL(l.startDate))} – ${l.isIndefinite ? 'nieokreślony' : esc(formatDatePL(l.endDate))}` : 'Pustostan — kliknij, aby dodać najemcę'}
                  ${u.area ? ` • ${u.area} m²` : ''}
                </div>
              </div>
              <div class="unit-right">
                <div class="unit-income num">${esc(formatPLN(uSum.total))}</div>
                <div class="unit-split num"><span class="text-rent">${esc(formatPLN(uSum.rent))}</span> + <span class="text-media">${esc(formatPLN(uSum.utilities))}</span></div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>

    <div class="card">
      <h2 class="section-title" style="margin-bottom:8px">Przychód tej nieruchomości (ostatnie 12 mies.)</h2>
      ${renderStackedBarChart(chartData.byMonth)}
    </div>
  `;

  el.querySelectorAll('[data-open-unit]').forEach((b) => b.addEventListener('click', () => openUnit(b.dataset.openUnit)));
  document.getElementById('bdEditProp')?.addEventListener('click', () => withEditGuard(() => openPropertyModal({ state, existing: prop, saveAndRender })));
  document.getElementById('bdAddUnit')?.addEventListener('click', () => withEditGuard(() => openUnitModal({ state, property: prop, saveAndRender })));
  document.getElementById('bdDelProp')?.addEventListener('click', () => withEditGuard(() => {
    openConfirmModal({
      title: 'Przenieść nieruchomość do Kosza?',
      message: `„${prop.name}” trafi do Kosza (możesz ją przywrócić w zakładce Więcej → Kosz).`,
      confirmLabel: 'Do Kosza',
      danger: true,
      onConfirm: async () => {
        prop.deletedAt = new Date().toISOString();
        appendAudit(state, 'Przeniesiono nieruchomość do kosza', prop.name);
        nav.selectedPropertyId = null;
        await saveAndRender();
        showToast('Przeniesiono do Kosza.');
      },
    });
  }));
}

function renderUnitDetail(el) {
  const unit = state.units.find((u) => u.id === nav.selectedUnitId && !u.deletedAt);
  const prop = unit ? state.properties.find((p) => p.id === unit.propertyId && !p.deletedAt) : null;
  if (!unit || !prop) { nav.selectedUnitId = null; renderPropertiesScreen(el); return; }

  const activeLease = getActiveLeaseForUnit(state, unit.id);
  const archivedLeases = getArchivedLeasesForUnit(state, unit.id);
  const nowISO = todayISO();
  const threshold = state.settings.expiringAlertDays || 60;
  const st = getLeaseStatus(activeLease, nowISO, threshold);
  const unitTotals = computeIncomeHierarchy(state, { period: 'all', unitId: unit.id }).portfolio;
  const leasePhotos = activeLease ? state.photos.filter((p) => !p.deletedAt && p.leaseId === activeLease.id) : [];
  const leaseDocs = activeLease ? state.documents.filter((d) => !d.deletedAt && d.leaseId === activeLease.id) : [];

  const subtabs = [
    { id: 'overview', label: 'Najemca i umowa' },
    { id: 'payments', label: 'Przychody' },
    { id: 'photos', label: `Zdjęcia (${leasePhotos.length})` },
    { id: 'docs', label: `Dokumenty (${leaseDocs.length})` },
    { id: 'history', label: `Historia (${archivedLeases.length})` },
  ];

  el.innerHTML = `
    <div class="card">
      <div class="row-between">
        <div>
          <div class="unit-name" style="font-size:18px">
            ${esc(prop.kind === 'single' ? prop.name : unit.name)}
            <span class="badge badge-${st.tone}">${esc(st.label)}</span>
          </div>
          <div class="prop-addr">
            ${esc(prop.kind === 'single' ? prop.address : `${prop.name} • ${prop.address}`)}
            ${unit.area ? ` • ${unit.area} m²` : ''}${unit.rooms ? ` • ${pluralPL(unit.rooms, 'pokój', 'pokoje', 'pokoi')}` : ''}${unit.floor ? ` • ${esc(unit.floor)}` : ''}
          </div>
        </div>
        ${!isReadOnlySnapshot() ? `
        <div class="inline-flex" style="flex-wrap:wrap">
          ${activeLease
            ? `<button type="button" class="btn btn-primary btn-sm" id="uTurnover">${icon('swap', 14)} Zmiana najemcy</button>`
            : `<button type="button" class="btn btn-primary btn-sm" id="uNewLease">${icon('plus', 14)} Nowa umowa</button>`}
          <button type="button" class="btn btn-sm" id="uEditUnit">${icon('edit', 14)} Dane lokalu / PPE</button>
          ${prop.kind === 'single' ? `<button type="button" class="btn btn-sm" id="uEditProp">Adres / budynek</button><button type="button" class="btn btn-sm" id="uAddSibling" title="Dodaj kolejne mieszkanie pod tym samym adresem">${icon('plus', 14)} Dodaj lokal</button>` : ''}
        </div>` : ''}
      </div>

      <div class="grid-kpi" style="margin-top:12px">
        <div class="kpi-tile">
          <div class="kpi-val num" style="font-size:18px">${esc(formatPLN(unitTotals.total))}</div>
          <div class="kpi-label">Przychód łącznie</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-val num text-rent" style="font-size:18px">${esc(formatPLN(unitTotals.rent))}</div>
          <div class="kpi-label">Z najmu (czynsz)</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-val num text-media" style="font-size:18px">${esc(formatPLN(unitTotals.utilities))}</div>
          <div class="kpi-label">Z mediów / opłat</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-val num" style="font-size:18px">${activeLease ? esc(formatPLN(activeLease.monthlyRent + activeLease.monthlyUtilities)) : '—'}</div>
          <div class="kpi-label">Stawka / mies.</div>
        </div>
      </div>
    </div>

    <div class="subtabs" role="tablist">
      ${subtabs.map((t) => `<button type="button" class="subtab ${nav.unitTab === t.id ? 'active' : ''}" data-utab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>

    <div id="unitSubContent" class="stack-md"></div>
  `;

  el.querySelectorAll('[data-utab]').forEach((b) => {
    b.addEventListener('click', () => { nav.unitTab = b.dataset.utab; renderUnitDetail(el); });
  });
  document.getElementById('uEditUnit')?.addEventListener('click', () => withEditGuard(() => openUnitModal({ state, property: prop, existing: unit, saveAndRender })));
  document.getElementById('uEditProp')?.addEventListener('click', () => withEditGuard(() => openPropertyModal({ state, existing: prop, saveAndRender })));
  document.getElementById('uAddSibling')?.addEventListener('click', () => withEditGuard(() => openUnitModal({ state, property: prop, saveAndRender })));
  document.getElementById('uNewLease')?.addEventListener('click', () => withEditGuard(() => openLeaseModal({ state, unit, property: prop, saveAndRender })));
  document.getElementById('uTurnover')?.addEventListener('click', () => withEditGuard(() => {
    openTurnoverWizard({ state, property: prop, unit, oldLease: activeLease, saveAndRender });
  }));

  const sub = document.getElementById('unitSubContent');
  if (nav.unitTab === 'overview') renderUnitOverview(sub, prop, unit, activeLease, st);
  else if (nav.unitTab === 'payments') renderUnitPayments(sub, prop, unit, activeLease);
  else if (nav.unitTab === 'photos') renderUnitPhotos(sub, prop, unit, activeLease, leasePhotos);
  else if (nav.unitTab === 'docs') renderUnitDocs(sub, prop, unit, activeLease, leaseDocs);
  else if (nav.unitTab === 'history') renderUnitHistory(sub, prop, unit, archivedLeases);
}

function renderUnitOverview(sub, prop, unit, lease, st) {
  if (!lease) {
    sub.innerHTML = `
      <div class="card empty-state">
        <strong>Lokal aktualnie jest pustostanem</strong>
        <p>Nie ma przypisanej aktywnej umowy najmu. Poprzednie umowy i ich przychody nadal znajdziesz w zakładce <em>Historia</em>.</p>
        ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-primary" id="ovStartLease">${icon('plus', 15)} Dodaj nową umowę najmu</button>` : ''}
      </div>
      ${unit.baseInventory ? `
        <div class="card">
          <div class="section-title" style="font-size:14px">Stałe wyposażenie lokalu</div>
          <p class="text-sm muted" style="margin:6px 0 0">${esc(unit.baseInventory)}</p>
        </div>` : ''}
    `;
    document.getElementById('ovStartLease')?.addEventListener('click', () => withEditGuard(() => openLeaseModal({ state, unit, property: prop, saveAndRender })));
    return;
  }

  const t = lease.tenant || {};
  const telHref = t.phone ? `tel:${t.phone.replace(/[^\d+]/g, '')}` : '';
  const smsHref = t.phone ? `sms:${t.phone.replace(/[^\d+]/g, '')}` : '';
  const bd = lease.utilitiesBreakdown || {};
  const bdItems = UTILITY_KEYS.filter(({ key }) => (Number(bd[key]) || 0) > 0);

  sub.innerHTML = `
    <div class="grid-2">
      <div class="card stack-sm">
        <div class="row-between">
          <h3 class="section-title">Dane kontaktowe najemcy</h3>
          ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-xs" id="ovEditLease">${icon('edit', 13)} Edytuj</button>` : ''}
        </div>
        <div style="font-size:17px;font-weight:700">${esc(t.name)}</div>
        <div class="kv-grid">
          <div><div class="kv-label">Telefon</div><div class="kv-val">${esc(t.phone || '—')}</div></div>
          <div><div class="kv-label">E-mail</div><div class="kv-val">${esc(t.email || '—')}</div></div>
          ${t.address ? `<div><div class="kv-label">Adres korespondencyjny</div><div class="kv-val">${esc(t.address)}</div></div>` : ''}
          ${t.emergencyContact ? `<div><div class="kv-label">Kontakt zapasowy / współnajemca</div><div class="kv-val">${esc(t.emergencyContact)}</div></div>` : ''}
          ${t.bankAccount ? `<div><div class="kv-label">Konto do zwrotu kaucji</div><div class="kv-val text-xs">${esc(t.bankAccount)}</div></div>` : ''}
          ${t.idInfo ? `<div><div class="kv-label">Identyfikacja / tryb</div><div class="kv-val text-sm">${esc(t.idInfo)}</div></div>` : ''}
        </div>
        ${t.notes ? `<div class="text-sm muted" style="background:var(--surface-2);padding:8px 10px;border-radius:8px">${esc(t.notes)}</div>` : ''}
        <div class="action-chips">
          ${t.phone ? `<a class="btn btn-soft btn-sm" href="${esc(telHref)}">${icon('phone', 14)} Zadzwoń</a>` : ''}
          ${t.phone ? `<a class="btn btn-sm" href="${esc(smsHref)}">${icon('sms', 14)} SMS</a>` : ''}
          ${t.email ? `<a class="btn btn-sm" href="mailto:${esc(t.email)}">${icon('mail', 14)} E-mail</a>` : ''}
        </div>
      </div>

      <div class="card stack-sm">
        <div class="row-between">
          <h3 class="section-title">Daty i warunki umowy</h3>
          ${!lease.isIndefinite && lease.endDate ? `<button type="button" class="btn btn-xs" id="ovIcs">${icon('calendar', 13)} Przypomnienie .ics</button>` : ''}
        </div>
        <div class="kv-grid">
          <div><div class="kv-label">Początek najmu</div><div class="kv-val">${esc(formatDatePL(lease.startDate))}</div></div>
          <div><div class="kv-label">Koniec najmu</div><div class="kv-val">${lease.isIndefinite ? 'Czas nieokreślony' : esc(formatDatePL(lease.endDate))}</div></div>
          <div><div class="kv-label">Okres wypowiedzenia</div><div class="kv-val">${lease.noticePeriodDays || 30} dni</div></div>
          <div><div class="kv-label">Dzień płatności</div><div class="kv-val">do ${lease.paymentDay || 10}. dnia mies.</div></div>
        </div>
        ${st.progress !== null ? `
          <div style="margin-top:4px">
            <div class="row-between text-xs muted" style="margin-bottom:4px">
              <span>Upływ okresu umowy</span>
              <span><strong>${st.progress}%</strong> ${st.daysLeft !== null ? (st.daysLeft >= 0 ? `(zostało ${st.daysLeft} dni)` : `(po terminie ${Math.abs(st.daysLeft)} dni)`) : ''}</span>
            </div>
            <div class="lease-progress">
              <div class="lease-progress-fill ${st.tone === 'warn' ? 'warn' : st.tone === 'danger' ? 'danger' : ''}" style="width:${st.progress}%"></div>
            </div>
          </div>` : ''}
        <div class="card card-tight" style="background:var(--surface-2);margin-top:4px">
          <div class="row-between text-sm"><span>Czynsz najmu (odstępne)</span><strong class="num text-rent">${esc(formatPLN(lease.monthlyRent))}</strong></div>
          <div class="row-between text-sm" style="margin-top:4px"><span>Media / opłaty</span><strong class="num text-media">${esc(formatPLN(lease.monthlyUtilities))}</strong></div>
          ${bdItems.length ? `<div class="text-xs muted" style="margin-top:3px">${bdItems.map((i) => `${i.label}: ${formatPLN(bd[i.key])}`).join(' • ')}</div>` : ''}
          <div class="row-between text-sm" style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><span>Kaucja zwrotna <span class="text-xs muted">(poza przychodem)</span></span><strong class="num">${esc(formatPLN(lease.depositAmount))} ${lease.depositPaid ? '✓' : '(nieopł.)'}</strong></div>
        </div>
        ${lease.notes ? `<div class="text-xs muted">${esc(lease.notes)}</div>` : ''}
      </div>
    </div>

    <div class="card stack-sm">
      <div class="row-between">
        <div>
          <h3 class="section-title">Media — nr PPE, gazomierz, wodomierz i umowy</h3>
          <p class="section-sub">Stuknij „Kopiuj”, gdy potrzebujesz podać numer na infolinii dostawcy</p>
        </div>
        ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-xs" id="ovEditMedia">${icon('edit', 12)} Edytuj numery</button>` : ''}
      </div>
      ${(() => {
        const uc = unit.utilityContracts || {};
        const copyBtn = (val) => val && val !== '—'
          ? ` <button type="button" class="btn btn-ghost btn-xs" data-copy="${esc(val)}" style="padding:1px 5px;min-height:20px;font-size:10.5px">Kopiuj</button>`
          : '';
        return `<div class="kv-grid">
          <div><div class="kv-label">Nr PPE (prąd)</div><div class="kv-val text-sm">${esc(uc.pradPpe || '—')}${copyBtn(uc.pradPpe)}</div></div>
          <div><div class="kv-label">Prąd — dostawca / nr umowy</div><div class="kv-val text-sm">${esc([uc.pradProvider, uc.pradContract].filter(Boolean).join(' • ') || '—')}${copyBtn(uc.pradContract)}</div></div>
          <div><div class="kv-label">Nr licznika prądu</div><div class="kv-val text-sm">${esc(unit.meterIds?.prad || '—')}${copyBtn(unit.meterIds?.prad)}</div></div>
          <div><div class="kv-label">Nr gazomierza / PPG</div><div class="kv-val text-sm">${esc([unit.meterIds?.gaz, uc.gazPpg].filter((v) => v && v !== '—').join(' • ') || '—')}${copyBtn(uc.gazPpg || unit.meterIds?.gaz)}</div></div>
          <div><div class="kv-label">Gaz — dostawca / nr umowy</div><div class="kv-val text-sm">${esc([uc.gazProvider, uc.gazContract].filter(Boolean).join(' • ') || '—')}${copyBtn(uc.gazContract)}</div></div>
          <div><div class="kv-label">Woda — wodomierz / umowa</div><div class="kv-val text-sm">${esc([unit.meterIds?.woda, uc.wodaProvider, uc.wodaContract].filter((v) => v && v !== '—').join(' • ') || '—')}${copyBtn(uc.wodaContract)}</div></div>
          <div><div class="kv-label">Ciepło / ogrzewanie</div><div class="kv-val text-sm">${esc([unit.meterIds?.cieplo, uc.cieploProvider, uc.cieploContract].filter((v) => v && v !== '—').join(' • ') || '—')}</div></div>
          <div><div class="kv-label">Wspólnota / ID lokalu</div><div class="kv-val text-sm">${esc([uc.wspolnotaName, uc.wspolnotaId].filter(Boolean).join(' • ') || '—')}${copyBtn(uc.wspolnotaId)}</div></div>
        </div>
        ${uc.otherNotes ? `<div class="text-xs muted" style="margin-top:4px">${esc(uc.otherNotes)}</div>` : ''}`;
      })()}
    </div>

    <div class="grid-2">
      <div class="card card-flush">
        <div class="prop-head" style="padding:12px 14px">
          <div>
            <h3 class="section-title">Stan liczników (start i zdanie)</h3>
            <div class="text-xs muted">
              ${lease.startMetersDate ? `Start: ${esc(formatDatePL(lease.startMetersDate))}` : `Start: ${esc(formatDatePL(lease.startDate))}`}
              ${lease.endMetersDate ? ` • Zdanie: ${esc(formatDatePL(lease.endMetersDate))}` : ''}
            </div>
          </div>
          ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-soft btn-xs" id="ovEditMeters">${icon('edit', 12)} Edytuj stany</button>` : ''}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Medium</th><th>Początek</th><th>Zdanie / koniec</th><th class="r">Zużycie</th></tr>
            </thead>
            <tbody>
              ${[
                ['Prąd', 'prad', 'kWh', unit.meterIds?.prad],
                ['Woda', 'woda', 'm³', unit.meterIds?.woda],
                ['Gaz', 'gaz', 'm³', unit.meterIds?.gaz],
                ['Ciepło', 'cieplo', 'GJ', unit.meterIds?.cieplo],
              ].map(([lbl, key, ufx, nr]) => {
                const sv = lease.startMeters?.[key] || '';
                const ev = lease.endMeters?.[key] || '';
                const delta = computeMeterDelta(sv, ev, ufx);
                return `<tr>
                  <td><strong>${lbl}</strong>${nr && nr !== '—' ? `<div class="text-xs muted">${esc(nr)}</div>` : ''}</td>
                  <td class="num text-sm">${esc(sv || '—')}</td>
                  <td class="num text-sm">${esc(ev || '—')}</td>
                  <td class="r num text-xs muted">${esc(delta || '—')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card stack-sm">
        <h3 class="section-title">Spis zawartości / wyposażenia</h3>
        <div class="text-sm" style="white-space:pre-line">${esc(lease.inventoryNote || unit.baseInventory || 'Brak wpisanego wykazu wyposażenia.')}</div>
      </div>
    </div>

    ${!isReadOnlySnapshot() ? `
      <div style="text-align:right">
        ${prop.kind === 'building'
          ? `<button type="button" class="btn btn-danger btn-xs" id="ovDelUnit">${icon('trash', 13)} Przenieś lokal do kosza</button>`
          : `<button type="button" class="btn btn-danger btn-xs" id="ovDelProp">${icon('trash', 13)} Przenieś nieruchomość do kosza</button>`}
      </div>` : ''}
  `;

  document.getElementById('ovEditLease')?.addEventListener('click', () => withEditGuard(() => openLeaseModal({ state, unit, property: prop, existing: lease, saveAndRender })));
  document.getElementById('ovEditMedia')?.addEventListener('click', () => withEditGuard(() => openUnitModal({ state, property: prop, existing: unit, saveAndRender })));
  document.getElementById('ovEditMeters')?.addEventListener('click', () => withEditGuard(() => openMetersModal({ state, property: prop, unit, lease, saveAndRender })));
  sub.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const val = b.dataset.copy;
    try { await navigator.clipboard.writeText(val); showToast(`Skopiowano: ${val}`); }
    catch { showToast(val); }
  }));
  document.getElementById('ovIcs')?.addEventListener('click', () => exportIcsByLeaseId(lease.id));
  document.getElementById('ovDelProp')?.addEventListener('click', () => withEditGuard(() => {
    openConfirmModal({
      title: 'Przenieść nieruchomość do Kosza?',
      message: `„${prop.name}” trafi do Kosza (możesz ją przywrócić w zakładce Więcej → Kosz).`,
      confirmLabel: 'Do Kosza',
      danger: true,
      onConfirm: async () => {
        prop.deletedAt = new Date().toISOString();
        appendAudit(state, 'Przeniesiono nieruchomość do kosza', prop.name);
        nav.selectedUnitId = null;
        nav.selectedPropertyId = null;
        await saveAndRender();
        showToast('Przeniesiono do Kosza.');
      },
    });
  }));
  document.getElementById('ovDelUnit')?.addEventListener('click', () => withEditGuard(() => {
    openConfirmModal({
      title: 'Przenieść lokal do Kosza?',
      message: `Lokal „${unit.name}” zostanie przeniesiony do Kosza. Historię i wpłaty możesz odzyskać w Więcej → Kosz.`,
      confirmLabel: 'Do Kosza',
      danger: true,
      onConfirm: async () => {
        unit.deletedAt = new Date().toISOString();
        appendAudit(state, 'Przeniesiono lokal do kosza', `${prop.name} / ${unit.name}`);
        nav.selectedUnitId = null;
        await saveAndRender();
        showToast('Przeniesiono lokal do Kosza.');
      },
    });
  }));
}

function renderUnitPayments(sub, prop, unit, activeLease) {
  const unitPays = state.payments
    .filter((p) => !p.deletedAt && p.unitId === unit.id)
    .sort((a, b) => b.month.localeCompare(a.month));
  const leaseMap = new Map(state.leases.map((l) => [l.id, l]));
  const missing = activeLease ? missingMonthsForLease(activeLease, state.payments, currentMonthKey()) : [];
  const totals = computeIncomeHierarchy(state, { period: 'all', unitId: unit.id }).portfolio;
  const chart = computeIncomeHierarchy(state, { period: 'last12', refMonth: currentMonthKey(), unitId: unit.id });

  sub.innerHTML = `
    <div class="row-between">
      <div class="text-sm muted">
        Łącznie: <strong class="num text-rent">Najem ${esc(formatPLN(totals.rent))}</strong> + <strong class="num text-media">Media ${esc(formatPLN(totals.utilities))}</strong> = <strong class="num">${esc(formatPLN(totals.total))}</strong>
      </div>
      ${!isReadOnlySnapshot() ? `
      <div class="inline-flex" style="flex-wrap:wrap">
        ${missing.length ? `<button type="button" class="btn btn-soft btn-sm" id="upGenMissing">${icon('plus', 14)} Uzupełnij ${pluralPL(missing.length, 'miesiąc', 'miesiące', 'miesięcy')}</button>` : ''}
        <button type="button" class="btn btn-primary btn-sm" id="upAddPay">${icon('plus', 14)} Dodaj wpłatę</button>
      </div>` : ''}
    </div>

    ${chart.byMonth.length ? `<div class="card">${renderStackedBarChart(chart.byMonth, { height: 156 })}</div>` : ''}

    <div class="card card-flush">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Miesiąc</th>
              <th>Najemca</th>
              <th class="r">Najem</th>
              <th class="r">Media</th>
              <th class="r">Razem</th>
              <th>Status</th>
              ${!isReadOnlySnapshot() ? '<th class="r">Akcje</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${unitPays.length === 0 ? `<tr><td colspan="7" class="empty-state">Brak wpisów płatności dla tego lokalu.</td></tr>` : unitPays.map((p) => {
              const l = leaseMap.get(p.leaseId);
              const media = getEffectiveMediaAmount(p);
              const bdList = p.useBreakdown && p.utilitiesBreakdown
                ? UTILITY_KEYS.filter(({ key }) => (p.utilitiesBreakdown[key] || 0) > 0).map((k) => `${k.label}: ${formatPLN(p.utilitiesBreakdown[k.key])}`).join(', ')
                : '';
              const bal = getPaymentBalance(p);
              const instList = Array.isArray(p.installments) ? p.installments : [];
              return `
                <tr>
                  <td>
                    <strong>${esc(formatMonthPL(p.month))}</strong>
                    ${p.note ? `<div class="text-xs muted">${esc(p.note)}</div>` : ''}
                    ${instList.length ? `<div class="text-xs muted" style="margin-top:3px">${instList.map((it) => `• ${formatDatePL(it.date)}: <span class="num">${formatPLN(it.amount)}</span>${it.payer ? ` (${esc(it.payer)})` : ''}`).join('<br>')}</div>` : ''}
                  </td>
                  <td class="text-xs muted">${esc(l?.tenant?.name || '—')}${l?.archivedAt ? ' (arch.)' : ''}</td>
                  <td class="r num text-rent fw-700">${esc(formatPLN(p.rentAmount))}</td>
                  <td class="r num text-media fw-700" title="${esc(bdList)}">
                    ${esc(formatPLN(media))}
                    ${bdList ? `<div class="text-xs muted" style="font-weight:400">rozpisano</div>` : ''}
                  </td>
                  <td class="r num fw-700">${esc(formatPLN(p.rentAmount + media))}</td>
                  <td>
                    ${bal.state === 'paid'
                      ? `<span class="badge badge-ok">Opłacone</span><div class="text-xs muted">${esc(formatDatePL(p.paidDate))}</div>`
                      : bal.state === 'partial'
                        ? `<span class="badge badge-warn">Część: ${esc(formatPLN(bal.paid))}</span><div class="text-xs muted">brak: ${esc(formatPLN(bal.remaining))}</div>`
                        : `<span class="badge badge-warn">Oczekuje</span>`}
                  </td>
                  ${!isReadOnlySnapshot() ? `
                  <td class="r" style="white-space:nowrap">
                    ${bal.state !== 'paid' ? `<button type="button" class="btn btn-soft btn-xs" data-pay-ok="${esc(p.id)}">${bal.state === 'partial' ? 'Dopłacono' : 'Opłacono'}</button>` : ''}
                    <button type="button" class="btn btn-xs" data-pay-part="${esc(p.id)}" title="Wpłaty z datą, raty lub nadpłata">Przelew${instList.length ? ` (${instList.length})` : ''}</button>
                    <button type="button" class="btn btn-xs" data-pay-edit="${esc(p.id)}" aria-label="Edytuj">${icon('edit', 12)}</button>
                    <button type="button" class="btn btn-danger btn-xs" data-pay-del="${esc(p.id)}" aria-label="Usuń">${icon('trash', 12)}</button>
                  </td>` : ''}
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('upAddPay')?.addEventListener('click', () => withEditGuard(() => openPaymentModal({ state, unit, property: prop, lease: activeLease, saveAndRender })));
  document.getElementById('upGenMissing')?.addEventListener('click', () => withEditGuard(async () => {
    for (const mk of missing) state.payments.push(buildPaymentFromLease(activeLease, mk, 'pending'));
    appendAudit(state, 'Wygenerowano brakujące miesiące', `${prop.name} / ${unit.name}: ${missing.length} szt.`);
    await saveAndRender();
    showToast(`Dodano ${missing.length} brakujących miesięcy ze stawek umowy.`);
  }));
  sub.querySelectorAll('[data-pay-ok]').forEach((b) => b.addEventListener('click', () => withEditGuard(async () => {
    const p = state.payments.find((x) => x.id === b.dataset.payOk);
    if (!p) return;
    const bal = getPaymentBalance(p);
    if (bal.state === 'partial' && bal.remaining > 0) {
      if (!Array.isArray(p.installments)) p.installments = [];
      p.installments.push({ id: `inst_${Date.now()}`, amount: bal.remaining, date: todayISO(), payer: '', note: 'Dopłata reszty' });
    }
    p.status = 'paid';
    p.paidDate = todayISO();
    appendAudit(state, 'Potwierdzono wpłatę', `${prop.name} / ${unit.name} (${p.month})`);
    await saveAndRender();
    showToast('Oznaczono jako opłacone ✓');
  })));
  sub.querySelectorAll('[data-pay-part]').forEach((b) => b.addEventListener('click', () => withEditGuard(() => {
    const p = state.payments.find((x) => x.id === b.dataset.payPart);
    if (p) openInstallmentsModal({ state, unit, property: prop, payment: p, saveAndRender });
  })));
  sub.querySelectorAll('[data-pay-edit]').forEach((b) => b.addEventListener('click', () => withEditGuard(() => {
    const p = state.payments.find((x) => x.id === b.dataset.payEdit);
    if (p) {
      const payLease = leaseMap.get(p.leaseId) || activeLease;
      openPaymentModal({ state, unit, property: prop, lease: payLease, existing: p, saveAndRender });
    }
  })));
  sub.querySelectorAll('[data-pay-del]').forEach((b) => b.addEventListener('click', () => withEditGuard(() => {
    const p = state.payments.find((x) => x.id === b.dataset.payDel);
    if (!p) return;
    openConfirmModal({
      title: 'Przenieść wpis płatności do Kosza?',
      message: `Wpis za ${formatMonthPL(p.month)} (${formatPLN(p.rentAmount + getEffectiveMediaAmount(p))}) zostanie przeniesiony do Kosza.`,
      confirmLabel: 'Do Kosza',
      danger: true,
      onConfirm: async () => {
        p.deletedAt = new Date().toISOString();
        appendAudit(state, 'Usunięto wpłatę do kosza', `${prop.name} / ${unit.name} (${p.month})`);
        await saveAndRender();
        showToast('Przeniesiono do Kosza.');
      },
    });
  })));
}

function renderUnitPhotos(sub, prop, unit, activeLease, leasePhotos) {
  if (!activeLease) {
    sub.innerHTML = `<div class="card empty-state"><strong>Brak aktywnej umowy</strong>Zdjęcia poprzednich umów znajdziesz w zakładce <em>Historia</em>.</div>`;
    return;
  }
  const hasStart = leasePhotos.some((p) => p.stage === 'start');
  const hasEndOrDuring = leasePhotos.some((p) => p.stage === 'end' || p.stage === 'during');
  const shown = nav.photoFilter === 'all' ? leasePhotos : leasePhotos.filter((p) => p.stage === nav.photoFilter);

  sub.innerHTML = `
    <div class="row-between">
      <div class="segmented">
        <button type="button" data-pf="all" class="${nav.photoFilter === 'all' ? 'active' : ''}">Wszystkie (${leasePhotos.length})</button>
        ${PHOTO_STAGES.map((s) => {
          const c = leasePhotos.filter((p) => p.stage === s.id).length;
          return `<button type="button" data-pf="${s.id}" class="${nav.photoFilter === s.id ? 'active' : ''}">${esc(s.short)} (${c})</button>`;
        }).join('')}
      </div>
      <div class="inline-flex" style="flex-wrap:wrap">
        ${hasStart && hasEndOrDuring ? `<button type="button" class="btn btn-soft btn-sm" id="phCompare">${icon('compare', 15)} Porównaj przed / po</button>` : ''}
        ${!isReadOnlySnapshot() ? `
          <button type="button" class="btn btn-primary btn-sm" id="phCamera">${icon('camera', 15)} Zrób zdjęcie</button>
          <button type="button" class="btn btn-sm" id="phAlbum">${icon('photo', 15)} Z albumu</button>
        ` : ''}
      </div>
    </div>

    ${shown.length === 0 ? `
      <div class="card empty-state">
        <strong>Brak zdjęć w tej kategorii</strong>
        Dodaj zdjęcia z albumu lub zrób je bezpośrednio aparatem telefonu przy wydaniu albo zdaniu mieszkania.
      </div>` : `
      <div class="photo-grid" id="photoGrid">
        ${shown.slice().sort((a, b) => String(b.takenAt).localeCompare(String(a.takenAt))).map((p) => {
          const stageObj = PHOTO_STAGES.find((s) => s.id === p.stage);
          return `
            <div class="photo-card">
              <div class="photo-thumb-wrap" data-view-ph="${esc(p.id)}">
                <img data-blob-key="${esc(p.thumbKey || p.blobKey)}" alt="${esc(p.room)}" loading="lazy" />
                <span class="photo-stage-tag">${esc(stageObj?.short || p.stage)}</span>
              </div>
              <div class="photo-meta">
                <span class="photo-room">${esc(p.room)}</span>
                <span class="photo-note">${esc(formatDatePL(p.takenAt))}${p.note ? ` • ${esc(p.note)}` : ''}</span>
              </div>
            </div>`;
        }).join('')}
      </div>`}
  `;

  void hydrateImages(sub);
  sub.querySelectorAll('[data-pf]').forEach((b) => b.addEventListener('click', () => {
    nav.photoFilter = b.dataset.pf;
    renderUnitPhotos(sub, prop, unit, activeLease, leasePhotos);
  }));
  document.getElementById('phCamera')?.addEventListener('click', () => withEditGuard(() => openAddPhotoModal({
    state, unit, property: prop, lease: activeLease,
    defaultStage: nav.photoFilter === 'end' ? 'end' : nav.photoFilter === 'during' ? 'during' : 'start',
    mode: 'camera', saveAndRender,
  })));
  document.getElementById('phAlbum')?.addEventListener('click', () => withEditGuard(() => openAddPhotoModal({
    state, unit, property: prop, lease: activeLease,
    defaultStage: nav.photoFilter === 'end' ? 'end' : nav.photoFilter === 'during' ? 'during' : 'start',
    mode: 'album', saveAndRender,
  })));
  document.getElementById('phCompare')?.addEventListener('click', () => {
    void openComparePhotosModal({ photos: leasePhotos });
  });
  sub.querySelectorAll('[data-view-ph]').forEach((card) => card.addEventListener('click', () => {
    const photo = leasePhotos.find((p) => p.id === card.dataset.viewPh);
    if (!photo) return;
    void openPhotoViewerModal({
      photo,
      canEdit: !isReadOnlySnapshot(),
      onDelete: (ph) => withEditGuard(() => openConfirmModal({
        title: 'Przenieść zdjęcie do Kosza?',
        message: `Zdjęcie „${ph.room}” z ${formatDatePL(ph.takenAt)} trafi do Kosza.`,
        confirmLabel: 'Do Kosza',
        danger: true,
        onConfirm: async () => {
          ph.deletedAt = new Date().toISOString();
          appendAudit(state, 'Usunięto zdjęcie do kosza', `${prop.name} / ${unit.name}: ${ph.room}`);
          await saveAndRender();
          showToast('Przeniesiono zdjęcie do Kosza.');
        },
      })),
    });
  }));
}

function renderUnitDocs(sub, prop, unit, activeLease, leaseDocs) {
  if (!activeLease) {
    sub.innerHTML = `<div class="card empty-state"><strong>Brak aktywnej umowy</strong>Podpisane dokumenty poprzednich umów są bezpieczne w zakładce <em>Historia</em>.</div>`;
    return;
  }

  const requiredCats = DOC_CATEGORIES.filter((c) => c.required);
  const doneReq = requiredCats.filter((c) => leaseDocs.some((d) => d.category === c.id)).length;

  sub.innerHTML = `
    <div class="card stack-sm">
      <div class="row-between">
        <div>
          <h3 class="section-title">Kompletność podpisanych dokumentów (${doneReq}/${requiredCats.length})</h3>
          <p class="section-sub">Wszystkie dokumenty przypięte do umowy z: ${esc(activeLease.tenant?.name)}</p>
        </div>
        ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-primary btn-sm" id="docAddBtn">${icon('plus', 14)} Dołącz dokument</button>` : ''}
      </div>
      <div class="stack-sm" style="margin-top:4px">
        ${requiredCats.map((cat) => {
          const present = leaseDocs.some((d) => d.category === cat.id);
          return `
            <div class="row-between text-sm" style="padding:7px 10px;border-radius:9px;background:var(--surface-2)">
              <span class="inline-flex"><span style="display:inline-flex;width:18px;height:18px;border-radius:50%;align-items:center;justify-content:center;font-size:11px;font-weight:800;background:${present ? 'var(--ok-bg)' : 'var(--border)'};color:${present ? 'var(--ok)' : 'var(--text-muted)'}">${present ? '✓' : '•'}</span><strong>${esc(cat.label)}</strong></span>
              ${present
                ? '<span class="badge badge-ok">Dołączono</span>'
                : (!isReadOnlySnapshot() ? `<button type="button" class="btn btn-xs btn-soft" data-add-cat="${esc(cat.id)}">+ Dodaj</button>` : '<span class="badge badge-warn">Brak</span>')}
            </div>`;
        }).join('')}
      </div>
    </div>

    <div class="card card-flush">
      <div class="prop-head">
        <h3 class="section-title">Załączone pliki (${leaseDocs.length})</h3>
        <button type="button" class="btn btn-ghost btn-xs" id="docGoTpl">Szablony in blanco →</button>
      </div>
      ${leaseDocs.length === 0 ? `<div class="empty-state">Brak dołączonych dokumentów. Dodaj PDF/skan umowy, protokołu zdawczo-odbiorczego lub wyposażenia.</div>` : `
        <div class="unit-list">
          ${leaseDocs.map((d) => {
            const cat = DOC_CATEGORIES.find((c) => c.id === d.category);
            return `
              <div class="doc-row">
                <div class="doc-icon">${esc(cat?.short || 'PL')}</div>
                <div class="doc-info">
                  <div class="doc-title">${esc(d.title)}</div>
                  <div class="doc-sub">${esc(cat?.label || d.category)} • ${esc(d.fileName)} (${esc(formatBytes(d.size))}) • ${esc(formatDatePL(d.signedDate))}</div>
                </div>
                <div class="inline-flex">
                  <button type="button" class="btn btn-xs" data-doc-view="${esc(d.id)}">${icon('eye', 13)} Podgląd</button>
                  <button type="button" class="btn btn-soft btn-xs" data-doc-dl="${esc(d.id)}">${icon('download', 13)}</button>
                </div>
              </div>`;
          }).join('')}
        </div>`}
    </div>
  `;

  document.getElementById('docAddBtn')?.addEventListener('click', () => withEditGuard(() => openAddDocumentModal({ state, unit, property: prop, lease: activeLease, saveAndRender })));
  document.getElementById('docGoTpl')?.addEventListener('click', () => switchTab('templates'));
  sub.querySelectorAll('[data-add-cat]').forEach((b) => b.addEventListener('click', () => withEditGuard(() => openAddDocumentModal({
    state, unit, property: prop, lease: activeLease, defaultCategory: b.dataset.addCat, saveAndRender,
  }))));
  sub.querySelectorAll('[data-doc-view]').forEach((b) => b.addEventListener('click', () => {
    const doc = leaseDocs.find((x) => x.id === b.dataset.docView);
    if (!doc) return;
    void openDocumentPreviewModal({
      doc,
      canEdit: !isReadOnlySnapshot(),
      onDelete: (dd) => withEditGuard(() => openConfirmModal({
        title: 'Przenieść dokument do Kosza?',
        message: `Dokument „${dd.title}” trafi do Kosza.`,
        confirmLabel: 'Do Kosza',
        danger: true,
        onConfirm: async () => {
          dd.deletedAt = new Date().toISOString();
          appendAudit(state, 'Usunięto dokument do kosza', `${prop.name} / ${unit.name}: ${dd.title}`);
          await saveAndRender();
          showToast('Przeniesiono do Kosza.');
        },
      })),
    });
  }));
  sub.querySelectorAll('[data-doc-dl]').forEach((b) => b.addEventListener('click', async () => {
    const doc = leaseDocs.find((x) => x.id === b.dataset.docDl);
    if (!doc) return;
    const blob = await getBlob(doc.blobKey);
    if (blob) await shareOrDownloadBlob(blob, doc.fileName || 'dokument.pdf', doc.title);
  }));
}

function renderUnitHistory(sub, prop, unit, archivedLeases) {
  const addArchBtn = !isReadOnlySnapshot()
    ? `<button type="button" class="btn btn-sm" id="histAddOld">${icon('plus', 13)} Dodaj dawną umowę (wstecz)</button>`
    : '';
  if (!archivedLeases.length) {
    sub.innerHTML = `<div class="card empty-state"><strong>Brak archiwalnych umów</strong>Po zamknięciu umowy lub użyciu kreatora „Zmiana najemcy” każdy poprzedni najemca pojawi się tutaj wraz ze wszystkimi zdjęciami, dokumentami i rozliczeniem kaucji.<div style="margin-top:12px">${addArchBtn}</div></div>`;
    document.getElementById('histAddOld')?.addEventListener('click', () => withEditGuard(() => openLeaseModal({ state, unit, property: prop, isArchivedCreate: true, saveAndRender })));
    return;
  }
  sub.innerHTML = `
    <div class="card card-flush">
      <div class="prop-head">
        <div>
          <h3 class="section-title">Poprzedni najemcy (${archivedLeases.length})</h3>
          <p class="section-sub">Kliknij umowę, aby otworzyć jej zdjęcia przed/po, dokumenty, wpłaty i kaucję</p>
        </div>
        ${addArchBtn}
      </div>
      <div class="unit-list">
        ${archivedLeases.map((l) => {
          const phCnt = state.photos.filter((p) => !p.deletedAt && p.leaseId === l.id).length;
          const docCnt = state.documents.filter((d) => !d.deletedAt && d.leaseId === l.id).length;
          const payTotals = computeIncomeHierarchy(state, { period: 'all', leaseId: l.id }).portfolio;
          return `
            <div class="unit-row" data-arch="${esc(l.id)}">
              <div class="unit-left">
                <div class="unit-name">${esc(l.tenant?.name)} <span class="badge badge-neutral">Archiwum</span></div>
                <div class="unit-meta">
                  ${esc(formatDatePL(l.startDate))} – ${esc(formatDatePL(l.endDate))} • ${phCnt} zdjęć • ${docCnt} dok.
                  ${l.depositSettlement ? ` • Kaucja zwrócona: ${esc(formatPLN(l.depositSettlement.returnedAmount))}` : ''}
                </div>
              </div>
              <div class="unit-right">
                <div class="unit-income num">${esc(formatPLN(payTotals.total))}</div>
                <div class="unit-split num"><span class="text-rent">${esc(formatPLN(payTotals.rent))}</span> + <span class="text-media">${esc(formatPLN(payTotals.utilities))}</span></div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
  document.getElementById('histAddOld')?.addEventListener('click', () => withEditGuard(() => openLeaseModal({ state, unit, property: prop, isArchivedCreate: true, saveAndRender })));
  sub.querySelectorAll('[data-arch]').forEach((row) => row.addEventListener('click', () => {
    const l = archivedLeases.find((x) => x.id === row.dataset.arch);
    if (l) void openArchiveLeaseModal({ state, lease: l, property: prop, unit });
  }));
}

// ---------- FINANCES (3-level hierarchy: Portfolio → Property → Unit) ----------
function renderFinances(el) {
  const years = getAvailableYears();
  const months = getAvailableMonths();
  if (!months.includes(nav.finMonth)) nav.finMonth = months[0] || currentMonthKey();
  if (!years.includes(nav.finYear)) nav.finYear = years[0] || String(new Date().getFullYear());

  const filter = {
    period: nav.finPeriod,
    monthKey: nav.finMonth,
    year: nav.finYear,
    refMonth: currentMonthKey(),
    status: nav.finStatus,
  };
  const h = computeIncomeHierarchy(state, filter);
  const tot = h.portfolio;
  const bdItems = UTILITY_KEYS.filter(({ key }) => (tot.breakdown[key] || 0) > 0);

  el.innerHTML = `
    <div class="card stack-md">
      <div class="row-between">
        <div class="segmented">
          <button type="button" data-fp="month" class="${nav.finPeriod === 'month' ? 'active' : ''}">Miesiąc</button>
          <button type="button" data-fp="year" class="${nav.finPeriod === 'year' ? 'active' : ''}">Rok</button>
          <button type="button" data-fp="last12" class="${nav.finPeriod === 'last12' ? 'active' : ''}">Ostatnie 12 m.</button>
          <button type="button" data-fp="all" class="${nav.finPeriod === 'all' ? 'active' : ''}">Całość</button>
        </div>
        <div class="inline-flex" style="flex-wrap:wrap">
          ${nav.finPeriod === 'month' ? `
            <select id="finMonthSel" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);font-family:inherit;font-size:13px">
              ${months.map((m) => `<option value="${esc(m)}" ${m === nav.finMonth ? 'selected' : ''}>${esc(formatMonthPL(m))}</option>`).join('')}
            </select>` : ''}
          ${nav.finPeriod === 'year' ? `
            <select id="finYearSel" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);font-family:inherit;font-size:13px">
              ${years.map((y) => `<option value="${esc(y)}" ${y === nav.finYear ? 'selected' : ''}>Rok ${esc(y)}</option>`).join('')}
            </select>` : ''}
          <select id="finStatusSel" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text);font-family:inherit;font-size:13px">
            <option value="all" ${nav.finStatus === 'all' ? 'selected' : ''}>Wszystkie wpisy</option>
            <option value="paid" ${nav.finStatus === 'paid' ? 'selected' : ''}>Tylko opłacone</option>
            <option value="pending" ${nav.finStatus === 'pending' ? 'selected' : ''}>Tylko oczekujące</option>
          </select>
          <button type="button" class="btn btn-sm" id="btnExportCsv">${icon('download', 14)} Eksport CSV</button>
        </div>
      </div>

      <div class="grid-3">
        <div class="kpi-tile" style="border-top:3px solid var(--rent-color)">
          <div class="kpi-val num text-rent">${esc(formatPLN(tot.rent))}</div>
          <div class="kpi-label">Przychód z najmu (czynsz)</div>
          <div class="text-xs muted" style="margin-top:2px">Opłacone: ${esc(formatPLN(tot.paidRent))}</div>
        </div>
        <div class="kpi-tile" style="border-top:3px solid var(--media-color)">
          <div class="kpi-val num text-media">${esc(formatPLN(tot.utilities))}</div>
          <div class="kpi-label">Przychód z mediów / opłat</div>
          <div class="text-xs muted" style="margin-top:2px">Opłacone: ${esc(formatPLN(tot.paidUtilities))}</div>
        </div>
        <div class="kpi-tile" style="border-top:3px solid var(--text)">
          <div class="kpi-val num">${esc(formatPLN(tot.total))}</div>
          <div class="kpi-label">Łącznie (${pluralPL(tot.count, 'wpis', 'wpisy', 'wpisów')})</div>
          <div class="text-xs muted" style="margin-top:2px">${tot.pendingTotal > 0 ? `Oczekuje: ${formatPLN(tot.pendingTotal)}` : 'Wszystko opłacone ✓'}</div>
        </div>
      </div>

      ${bdItems.length ? `
        <div class="text-xs muted" style="background:var(--surface-2);padding:8px 12px;border-radius:9px">
          <strong>Rozpisane media:</strong> ${bdItems.map((k) => `${k.label}: <span class="num">${esc(formatPLN(tot.breakdown[k.key]))}</span>`).join(' • ')}
        </div>` : ''}
    </div>

    <div class="card card-flush">
      <div class="prop-head">
        <div>
          <h2 class="section-title">Zestawienie hierarchiczne (3 poziomy)</h2>
          <p class="section-sub">Portfel → Nieruchomość / kamienica → Pojedyncze mieszkania</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nieruchomość / Mieszkanie</th>
              <th class="r" style="color:var(--rent-color)">Najem</th>
              <th class="r" style="color:var(--media-color)">Media</th>
              <th class="r">Razem</th>
              <th class="r">Udział</th>
            </tr>
          </thead>
          <tbody>
            ${h.byProperty.length === 0 ? `<tr><td colspan="5" class="empty-state">Brak nieruchomości do zestawienia.</td></tr>` : h.byProperty.map(({ property, totals, units }) => {
              const pct = tot.total > 0 ? Math.round((totals.total / tot.total) * 100) : 0;
              const isMulti = property.kind === 'building' || units.length > 1;
              const isCollapsed = isMulti && nav.collapsedFinProps.has(property.id);
              return `
                <tr class="row-prop" style="cursor:pointer" data-fin-prop="${esc(property.id)}">
                  <td>
                    ${isMulti ? `<button type="button" class="prop-chevron ${isCollapsed ? 'collapsed' : ''}" data-fin-toggle="${esc(property.id)}" aria-label="${isCollapsed ? 'Rozwiń lokale' : 'Zwiń lokale'}" title="${isCollapsed ? 'Rozwiń mieszkania' : 'Zwiń mieszkania'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>` : ''}
                    ${esc(property.name)}
                    <span class="text-xs muted" style="font-weight:400">${isMulti ? ` (${units.length} lok.)` : ''} • ${esc(property.address)}</span>
                  </td>
                  <td class="r num text-rent">${esc(formatPLN(totals.rent))}</td>
                  <td class="r num text-media">${esc(formatPLN(totals.utilities))}</td>
                  <td class="r num">${esc(formatPLN(totals.total))}</td>
                  <td class="r num muted">${pct}%</td>
                </tr>
                ${(isMulti && !isCollapsed) ? units.map(({ unit, totals: ut }, idx) => {
                  const uPct = tot.total > 0 ? Math.round((ut.total / tot.total) * 100) : 0;
                  const isLast = idx === units.length - 1;
                  return `
                    <tr class="row-unit ${isLast ? 'row-unit-last' : ''}" style="cursor:pointer" data-fin-unit="${esc(unit.id)}">
                      <td>${esc(unit.name)}</td>
                      <td class="r num text-rent">${esc(formatPLN(ut.rent))}</td>
                      <td class="r num text-media">${esc(formatPLN(ut.utilities))}</td>
                      <td class="r num">${esc(formatPLN(ut.total))}</td>
                      <td class="r num muted">${uPct}%</td>
                    </tr>`;
                }).join('') : ''}`;
            }).join('')}
            ${h.byProperty.length ? `
              <tr class="row-total">
                <td>SUMA WSZYSTKICH NIERUCHOMOŚCI</td>
                <td class="r num text-rent">${esc(formatPLN(tot.rent))}</td>
                <td class="r num text-media">${esc(formatPLN(tot.utilities))}</td>
                <td class="r num">${esc(formatPLN(tot.total))}</td>
                <td class="r num">100%</td>
              </tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h2 class="section-title" style="margin-bottom:8px">Wykres miesięczny (wybrany okres)</h2>
      ${renderStackedBarChart(h.byMonth)}
    </div>
  `;

  el.querySelectorAll('[data-fp]').forEach((b) => b.addEventListener('click', () => { nav.finPeriod = b.dataset.fp; renderAll(); }));
  document.getElementById('finMonthSel')?.addEventListener('change', (e) => { nav.finMonth = e.target.value; renderAll(); });
  document.getElementById('finYearSel')?.addEventListener('change', (e) => { nav.finYear = e.target.value; renderAll(); });
  document.getElementById('finStatusSel')?.addEventListener('change', (e) => { nav.finStatus = e.target.value; renderAll(); });
  document.getElementById('btnExportCsv')?.addEventListener('click', () => {
    const csv = exportPaymentsCsv(state, filter);
    triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `przychody_najem_${todayISO()}.csv`);
    showToast('Pobrano plik CSV (gotowy do Excela / Numbers).');
  });
  el.querySelectorAll('[data-fin-toggle]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = b.dataset.finToggle;
    if (nav.collapsedFinProps.has(id)) nav.collapsedFinProps.delete(id);
    else nav.collapsedFinProps.add(id);
    renderFinances(el);
  }));
  el.querySelectorAll('[data-fin-prop]').forEach((r) => r.addEventListener('click', () => openProperty(r.dataset.finProp)));
  el.querySelectorAll('[data-fin-unit]').forEach((r) => r.addEventListener('click', () => openUnit(r.dataset.finUnit, 'payments')));
}

// ---------- TEMPLATES (in blanco) ----------
function renderTemplates(el) {
  const templates = state.templates.filter((t) => !t.deletedAt);

  el.innerHTML = `
    <div class="section-header">
      <div>
        <h1 class="section-title" style="font-size:19px">Szablony dokumentów in blanco</h1>
        <p class="section-sub">Wgraj swoje puste wzory (PDF, DOCX, Pages) — zawsze pod ręką do pobrania, wydruku lub wysłania najemcy.</p>
      </div>
      ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-primary btn-sm" id="tplAdd">${icon('plus', 15)} Dodaj własny wzór</button>` : ''}
    </div>

    ${templates.length === 0 ? `
      <div class="card empty-state">
        <strong>Brak szablonów in blanco</strong>
        Dodaj swoje puste umowy najmu, protokoły zdawczo-odbiorcze oraz protokół wyposażenia, żeby móc je pobrać w dowolnej chwili z telefonu.
      </div>` : `
      <div class="stack-md">
        ${TEMPLATE_CATEGORIES.map((cat) => {
          const items = templates.filter((t) => t.category === cat.id);
          if (!items.length) return '';
          return `
            <div class="card card-flush">
              <div class="prop-head" style="padding:11px 14px;background:var(--surface-2)">
                <strong class="text-sm">${esc(cat.label)}</strong>
              </div>
              <div class="unit-list">
                ${items.map((t) => {
                  const ext = (t.fileName.split('.').pop() || 'PDF').toUpperCase().slice(0, 4);
                  return `
                    <div class="doc-row">
                      <div class="doc-icon">${esc(ext)}</div>
                      <div class="doc-info">
                        <div class="doc-title">${esc(t.title)}</div>
                        <div class="doc-sub">${esc(t.fileName)} • ${esc(formatBytes(t.size))} • akt. ${esc(formatDatePL(t.updatedAt))}</div>
                        ${t.description ? `<div class="text-xs muted" style="margin-top:2px">${esc(t.description)}</div>` : ''}
                      </div>
                      <div class="inline-flex" style="flex-wrap:wrap">
                        <button type="button" class="btn btn-xs" data-tpl-view="${esc(t.id)}">${icon('eye', 13)} Podgląd</button>
                        <button type="button" class="btn btn-primary btn-xs" data-tpl-dl="${esc(t.id)}">${icon('download', 13)} Pobierz / Wyślij</button>
                        ${!isReadOnlySnapshot() ? `
                          <button type="button" class="btn btn-xs" data-tpl-edit="${esc(t.id)}" aria-label="Podmień / edytuj">${icon('edit', 13)}</button>
                          <button type="button" class="btn btn-danger btn-xs" data-tpl-del="${esc(t.id)}" aria-label="Usuń">${icon('trash', 13)}</button>
                        ` : ''}
                      </div>
                    </div>`;
                }).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>`}
  `;

  document.getElementById('tplAdd')?.addEventListener('click', () => withEditGuard(() => openAddTemplateModal({ state, saveAndRender })));
  el.querySelectorAll('[data-tpl-view]').forEach((b) => b.addEventListener('click', () => {
    const t = templates.find((x) => x.id === b.dataset.tplView);
    if (t) void openDocumentPreviewModal({ doc: { ...t, signedDate: t.updatedAt }, canEdit: false, label: 'Szablon in blanco' });
  }));
  el.querySelectorAll('[data-tpl-dl]').forEach((b) => b.addEventListener('click', async () => {
    const t = templates.find((x) => x.id === b.dataset.tplDl);
    if (!t) return;
    const blob = await getBlob(t.blobKey);
    if (blob) await shareOrDownloadBlob(blob, t.fileName || 'szablon.pdf', t.title);
  }));
  el.querySelectorAll('[data-tpl-edit]').forEach((b) => b.addEventListener('click', () => withEditGuard(() => {
    const t = templates.find((x) => x.id === b.dataset.tplEdit);
    if (t) openAddTemplateModal({ state, existing: t, saveAndRender });
  })));
  el.querySelectorAll('[data-tpl-del]').forEach((b) => b.addEventListener('click', () => withEditGuard(() => {
    const t = templates.find((x) => x.id === b.dataset.tplDel);
    if (!t) return;
    openConfirmModal({
      title: 'Przenieść szablon do Kosza?',
      message: `Szablon „${t.title}” trafi do Kosza (możesz go przywrócić w zakładce Więcej → Kosz).`,
      confirmLabel: 'Do Kosza',
      danger: true,
      onConfirm: async () => {
        t.deletedAt = new Date().toISOString();
        appendAudit(state, 'Usunięto szablon do kosza', t.title);
        await saveAndRender();
        showToast('Przeniesiono do Kosza.');
      },
    });
  })));
}

// ---------- MORE (Backup ZIP, Security / PIN, Audit Log, Trash, iOS guide) ----------
async function renderMore(el) {
  const s = state.settings;
  const trashCount =
    state.properties.filter((x) => x.deletedAt).length +
    state.units.filter((x) => x.deletedAt).length +
    state.payments.filter((x) => x.deletedAt).length +
    state.photos.filter((x) => x.deletedAt).length +
    state.documents.filter((x) => x.deletedAt).length +
    state.templates.filter((x) => x.deletedAt).length;

  el.innerHTML = `
    <div class="segmented" style="width:100%">
      <button type="button" data-ms="backup" class="${nav.moreSection === 'backup' ? 'active' : ''}">Kopia ZIP</button>
      <button type="button" data-ms="security" class="${nav.moreSection === 'security' ? 'active' : ''}">Blokada / PIN</button>
      <button type="button" data-ms="audit" class="${nav.moreSection === 'audit' ? 'active' : ''}">Historia zmian</button>
      <button type="button" data-ms="trash" class="${nav.moreSection === 'trash' ? 'active' : ''}">Kosz (${trashCount})</button>
      <button type="button" data-ms="install" class="${nav.moreSection === 'install' ? 'active' : ''}">iPhone / PWA</button>
    </div>
    <div id="moreBody" class="stack-md"></div>
  `;

  el.querySelectorAll('[data-ms]').forEach((b) => b.addEventListener('click', () => {
    nav.moreSection = b.dataset.ms;
    void renderMore(el);
  }));

  const body = document.getElementById('moreBody');

  if (nav.moreSection === 'backup') {
    const info = await getStorageInfo();
    const lastBk = s.lastBackupAt ? formatDatePL(s.lastBackupAt.slice(0, 10)) : 'jeszcze nie wykonano';
    body.innerHTML = `
      <div class="card stack-md">
        <div>
          <h2 class="section-title">Kopia zapasowa (ZIP) — 100% Twoich plików</h2>
          <p class="section-sub">Ponieważ aplikacja działa wyłącznie lokalnie na jednym urządzeniu, regularna kopia <strong>.zip</strong> chroni dane przed awarią lub czyszczeniem pamięci Safari. Po rozpakowaniu archiwum każde zdjęcie i PDF otworzysz normalnie na komputerze!</p>
        </div>
        <div class="kv-grid">
          <div><div class="kv-label">Ostatnia kopia</div><div class="kv-val">${esc(lastBk)}</div></div>
          <div><div class="kv-label">Zapisane załączniki</div><div class="kv-val">${info.count} plików (${esc(formatBytes(info.totalBytes))})</div></div>
          <div><div class="kv-label">Ochrona pamięci Safari</div><div class="kv-val">${info.persisted ? 'Aktywna ✓' : 'Standardowa'}</div></div>
        </div>
        <div class="inline-flex" style="flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="btnZipExport">${icon('download', 15)} Pobierz pełną kopię (.zip)</button>
          <label class="btn" style="cursor:pointer">
            ${icon('upload', 15)} Przywróć z kopii (.zip)
            <input type="file" id="zipImportInput" accept=".zip,application/zip" class="sr-only" />
          </label>
        </div>
        <div class="card card-tight stack-sm" style="background:var(--surface-2)">
          <strong class="text-sm">Opcja na przyszłość: podgląd „tylko do odczytu” dla drugiej osoby</strong>
          <p class="text-xs muted" style="margin:0">Jeśli kiedyś zechcesz pokazać komuś aktualne finanse bez możliwości edycji, wygeneruj poniżej migawkę <em>read-only</em> i prześlij ją do wczytania na drugim telefonie:</p>
          <div class="inline-flex" style="flex-wrap:wrap">
            <button type="button" class="btn btn-sm" id="btnSnapFin">${icon('eye', 14)} Migawka finansów (bez skanów/zdjęć)</button>
            <button type="button" class="btn btn-sm" id="btnSnapFull">${icon('eye', 14)} Pełna migawka (ze zdjęciami)</button>
          </div>
        </div>
      </div>

      <div class="card stack-sm">
        <h3 class="section-title">Dane aplikacji</h3>
        <div class="inline-flex" style="flex-wrap:wrap">
          <button type="button" class="btn btn-sm" id="btnLoadDemo">Przywróć dane przykładowe (demo)</button>
          <button type="button" class="btn btn-danger btn-sm" id="btnClearAll">Wyczyść wszystko i zacznij od zera</button>
        </div>
      </div>
    `;

    document.getElementById('btnZipExport').addEventListener('click', async () => {
      const btn = document.getElementById('btnZipExport');
      btn.disabled = true; btn.textContent = 'Pakowanie archiwum…';
      try {
        state.settings.lastBackupAt = new Date().toISOString();
        await saveState(state);
        const bytes = await exportFullBackupZip(state, { readOnlySnapshot: false, includeAttachments: true });
        await shareOrDownloadBlob(new Blob([bytes], { type: 'application/zip' }), `moj_najem_kopia_${todayISO()}.zip`, 'Kopia zapasowa Mój Najem');
        showToast('Wyeksportowano pełną kopię .zip ✓');
        renderChrome();
        void renderMore(el);
      } catch (err) {
        btn.disabled = false;
        showToast(`Błąd eksportu: ${err.message}`);
      }
    });
    document.getElementById('btnSnapFin').addEventListener('click', async () => {
      const bytes = await exportFullBackupZip(state, { readOnlySnapshot: true, includeAttachments: false });
      await shareOrDownloadBlob(new Blob([bytes], { type: 'application/zip' }), `moj_najem_podglad_finanse_${todayISO()}.zip`, 'Podgląd finansów');
      showToast('Wyeksportowano lekką migawkę finansów (tylko do odczytu).');
    });
    document.getElementById('btnSnapFull').addEventListener('click', async () => {
      const bytes = await exportFullBackupZip(state, { readOnlySnapshot: true, includeAttachments: true });
      await shareOrDownloadBlob(new Blob([bytes], { type: 'application/zip' }), `moj_najem_podglad_pelny_${todayISO()}.zip`, 'Pełny podgląd');
      showToast('Wyeksportowano pełną migawkę (tylko do odczytu).');
    });
    document.getElementById('zipImportInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      void openImportZipModal({
        file,
        onRestored: async (newState) => {
          state = newState;
          editUnlocked = false;
          applyTheme();
          renderAll();
        },
      });
      e.target.value = '';
    });
    document.getElementById('btnLoadDemo').addEventListener('click', () => openConfirmModal({
      title: 'Załadować dane przykładowe?',
      message: 'Zastąpi to obecne dane w przeglądarce przykładowym zestawem (1 kamienica + 2 pojedyncze lokale, zdjęcia przed/po i wzory PDF).',
      confirmLabel: 'Załaduj demo',
      danger: true,
      onConfirm: async () => {
        await clearAllData();
        clearUrlCache();
        state = await createDemoData();
        await saveState(state);
        editUnlocked = false;
        nav.tab = 'dashboard';
        renderAll();
        showToast('Załadowano dane przykładowe.');
      },
    }));
    document.getElementById('btnClearAll').addEventListener('click', confirmResetToEmpty);
  } else if (nav.moreSection === 'security') {
    body.innerHTML = `
      <div class="card stack-md">
        <h2 class="section-title">${icon('shield', 17)} Ochrona przed edycją „niechcący”</h2>
        <label class="field-check">
          <input type="checkbox" id="optLock" ${s.requireUnlockForEdit ? 'checked' : ''} ${isReadOnlySnapshot() ? 'disabled' : ''} />
          Otwieraj aplikację w trybie <strong>tylko do podglądu</strong> (zalecane)
        </label>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Automatyczna ponowna blokada po (min)</label>
            <input type="number" min="1" max="120" id="optAutoMin" value="${s.autoLockMinutes || 5}" ${isReadOnlySnapshot() ? 'disabled' : ''} />
          </div>
          <div class="field">
            <label>Alert przed końcem umowy (dni)</label>
            <input type="number" min="7" max="180" id="optAlertDays" value="${s.expiringAlertDays || 60}" ${isReadOnlySnapshot() ? 'disabled' : ''} />
          </div>
        </div>
        <div class="row-between" style="background:var(--surface-2);padding:11px 14px;border-radius:10px">
          <div>
            <strong>4-cyfrowy PIN do odblokowania edycji</strong>
            <div class="text-xs muted">${s.pinHash ? 'Ustawiony ✓ (wymagany przy włączaniu edycji)' : 'Nie ustawiono (odblokowanie samym potwierdzeniem)'}</div>
          </div>
          ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-sm" id="btnSetPin">${s.pinHash ? 'Zmień / usuń PIN' : 'Ustaw PIN'}</button>` : ''}
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:0">
        <div class="form-grid cols-2">
          <div class="field">
            <label>Motyw kolorystyczny</label>
            <select id="optTheme">
              <option value="system" ${s.theme === 'system' ? 'selected' : ''}>Jak w systemie (auto)</option>
              <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Jasny</option>
              <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Ciemny</option>
            </select>
          </div>
          <div class="field">
            <label>Optymalizacja zdjęć</label>
            <select id="optCompress" ${isReadOnlySnapshot() ? 'disabled' : ''}>
              <option value="1" ${s.compressPhotos ? 'selected' : ''}>Kompresuj (maks. 1920 px JPEG — zalecane)</option>
              <option value="0" ${!s.compressPhotos ? 'selected' : ''}>Oryginał bez zmiany rozmiaru</option>
            </select>
          </div>
        </div>
      </div>
    `;
    document.getElementById('optLock').addEventListener('change', (e) => {
      const next = e.target.checked;
      e.target.checked = !next;
      withEditGuard(async () => {
        state.settings.requireUnlockForEdit = next;
        await saveAndRender();
        showToast(next ? 'Domyślna blokada włączona.' : 'Domyślna blokada wyłączona.');
      });
    });
    document.getElementById('optAutoMin').addEventListener('change', async (e) => {
      state.settings.autoLockMinutes = Math.max(1, Math.min(120, Number(e.target.value) || 5));
      await saveState(state); bumpAutoLock(); showToast('Zapisano czas blokady.');
    });
    document.getElementById('optAlertDays').addEventListener('change', async (e) => {
      state.settings.expiringAlertDays = Math.max(7, Math.min(180, Number(e.target.value) || 60));
      await saveAndRender(); showToast('Zapisano próg alertów.');
    });
    document.getElementById('optTheme').addEventListener('change', async (e) => {
      state.settings.theme = e.target.value;
      applyTheme();
      await saveState(state);
    });
    document.getElementById('optCompress').addEventListener('change', async (e) => {
      state.settings.compressPhotos = e.target.value === '1';
      await saveState(state);
      showToast('Zapisano ustawienie zdjęć.');
    });
    document.getElementById('btnSetPin')?.addEventListener('click', () => withEditGuard(() => openSetPinModal({ state, saveAndRender })));
  } else if (nav.moreSection === 'audit') {
    const logs = state.auditLog || [];
    body.innerHTML = `
      <div class="card card-flush">
        <div class="prop-head">
          <div>
            <h2 class="section-title">${icon('history', 16)} Historia zmian (${logs.length})</h2>
            <p class="section-sub">Rejestr operacji wykonanych w aplikacji</p>
          </div>
        </div>
        ${logs.length === 0 ? '<div class="empty-state">Brak wpisów w historii.</div>' : `
          <div class="unit-list">
            ${logs.slice(0, 80).map((l) => `
              <div class="doc-row">
                <div class="doc-info">
                  <div class="doc-title">${esc(l.action)}</div>
                  <div class="doc-sub">${esc(l.details)}</div>
                </div>
                <span class="text-xs muted num">${esc(l.at.slice(0, 16).replace('T', ' '))}</span>
              </div>`).join('')}
          </div>`}
      </div>
    `;
  } else if (nav.moreSection === 'trash') {
    const entries = [
      ...state.properties.filter((x) => x.deletedAt).map((x) => ({ kind: 'Nieruchomość', label: x.name, deletedAt: x.deletedAt, col: 'properties', item: x })),
      ...state.units.filter((x) => x.deletedAt).map((x) => ({ kind: 'Lokal', label: x.name, deletedAt: x.deletedAt, col: 'units', item: x })),
      ...state.payments.filter((x) => x.deletedAt).map((x) => ({ kind: 'Wpłata', label: `${formatMonthPL(x.month)} (${formatPLN(x.rentAmount + getEffectiveMediaAmount(x))})`, deletedAt: x.deletedAt, col: 'payments', item: x })),
      ...state.photos.filter((x) => x.deletedAt).map((x) => ({ kind: 'Zdjęcie', label: `${x.room} (${formatDatePL(x.takenAt)})`, deletedAt: x.deletedAt, col: 'photos', item: x })),
      ...state.documents.filter((x) => x.deletedAt).map((x) => ({ kind: 'Dokument', label: x.title, deletedAt: x.deletedAt, col: 'documents', item: x })),
      ...state.templates.filter((x) => x.deletedAt).map((x) => ({ kind: 'Szablon', label: x.title, deletedAt: x.deletedAt, col: 'templates', item: x })),
    ].sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));

    body.innerHTML = `
      <div class="card card-flush">
        <div class="prop-head">
          <div>
            <h2 class="section-title">Kosz (${entries.length})</h2>
            <p class="section-sub">Usunięte elementy można przywrócić albo skasować na stałe</p>
          </div>
          ${entries.length && !isReadOnlySnapshot() ? `<button type="button" class="btn btn-danger btn-xs" id="btnPurgeTrash">Opróżnij kosz</button>` : ''}
        </div>
        ${entries.length === 0 ? '<div class="empty-state">Kosz jest pusty.</div>' : `
          <div class="unit-list">
            ${entries.map((e, idx) => `
              <div class="doc-row">
                <div class="doc-info">
                  <div class="doc-title">${esc(e.label)} <span class="badge badge-neutral">${esc(e.kind)}</span></div>
                  <div class="doc-sub">Usunięto: ${esc(formatDatePL(e.deletedAt.slice(0, 10)))}</div>
                </div>
                ${!isReadOnlySnapshot() ? `<button type="button" class="btn btn-soft btn-xs" data-restore="${idx}">Przywróć</button>` : ''}
              </div>`).join('')}
          </div>`}
      </div>
    `;
    body.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => withEditGuard(async () => {
      const e = entries[Number(b.dataset.restore)];
      e.item.deletedAt = null;
      appendAudit(state, `Przywrócono z kosza (${e.kind})`, e.label);
      await saveAndRender();
      showToast('Przywrócono z Kosza ✓');
    })));
    document.getElementById('btnPurgeTrash')?.addEventListener('click', () => withEditGuard(() => openConfirmModal({
      title: 'Opróżnić Kosz na stałe?',
      message: `Trwale usunie ${entries.length} elementów wraz z przypisanymi plikami z pamięci urządzenia.`,
      confirmLabel: 'Usuń trwale',
      danger: true,
      onConfirm: async () => {
        const keepRef = new Set();
        for (const p of state.photos) if (!p.deletedAt) { keepRef.add(p.blobKey); keepRef.add(p.thumbKey); }
        for (const d of state.documents) if (!d.deletedAt) keepRef.add(d.blobKey);
        for (const t of state.templates) if (!t.deletedAt) keepRef.add(t.blobKey);
        const delKey = async (k) => { if (k && !keepRef.has(k)) await deleteBlob(k); };
        for (const p of state.photos.filter((x) => x.deletedAt)) { await delKey(p.blobKey); await delKey(p.thumbKey); }
        for (const d of state.documents.filter((x) => x.deletedAt)) await delKey(d.blobKey);
        for (const t of state.templates.filter((x) => x.deletedAt)) await delKey(t.blobKey);
        state.properties = state.properties.filter((x) => !x.deletedAt);
        state.units = state.units.filter((x) => !x.deletedAt);
        state.payments = state.payments.filter((x) => !x.deletedAt);
        state.photos = state.photos.filter((x) => !x.deletedAt);
        state.documents = state.documents.filter((x) => !x.deletedAt);
        state.templates = state.templates.filter((x) => !x.deletedAt);
        appendAudit(state, 'Opróżniono kosz', `Usunięto trwale ${entries.length} elementów.`);
        await saveAndRender();
        showToast('Kosz został opróżniony.');
      },
    })));
  } else if (nav.moreSection === 'install') {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    body.innerHTML = `
      <div class="card stack-md">
        <h2 class="section-title">Jak dodać „Mój Najem” na ekran główny iPhone’a</h2>
        <div class="badge ${isStandalone ? 'badge-ok' : 'badge-neutral'}" style="align-self:flex-start">
          ${isStandalone ? '✓ Uruchomiona jako samodzielna aplikacja' : 'Uruchomiona w oknie przeglądarki'}
        </div>
        <ol class="text-sm stack-sm" style="margin:0;padding-left:20px">
          <li>Umieść folder z aplikacją na darmowym, statycznym hostingu HTTPS — np. <strong>Cloudflare Pages</strong>, <strong>GitHub Pages</strong> lub <strong>Netlify Drop</strong> (tam leży wyłącznie <em>pusty kod</em>; żadne Twoje prywatne dane, zdjęcia ani umowy nie są wysyłane na serwer!).</li>
          <li>Otwórz swój adres w przeglądarce <strong>Safari na iPhonie</strong>.</li>
          <li>Stuknij przycisk <strong>Udostępnij</strong> (kwadrat ze strzałką w górę na dole ekranu).</li>
          <li>Wybierz <strong>„Do ekranu początkowego”</strong> → <strong>Dodaj</strong>.</li>
          <li>Otwieraj aplikację z nowej ikony na pulpicie — zadziała na pełnym ekranie <strong>bez paska adresu</strong> i będzie działać także <strong>offline</strong> (np. w piwnicy przy spisywaniu liczników).</li>
        </ol>
        <div class="card card-tight" style="background:var(--warn-bg);color:var(--text);border-color:rgba(217,130,15,0.25)">
          <strong class="text-sm">Ważna zasada bezpieczeństwa:</strong>
          <p class="text-xs" style="margin:4px 0 0">Raz w miesiącu (lub po zmianie najemcy) kliknij w <em>Więcej → Kopia ZIP → Pobierz pełną kopię</em> i zapisz plik w iCloud Drive albo na komputerze. Jeśli zgubisz telefon lub wyczyścisz pamięć Safari, przywrócisz wszystko w 10 sekund.</p>
        </div>
        <div class="card card-tight" style="background:var(--surface-2)">
          <strong class="text-sm">Skanowanie papierowej umowy na iPhonie:</strong>
          <p class="text-xs muted" style="margin:4px 0 0">Otwórz wbudowaną aplikację <strong>Pliki</strong> (lub <strong>Notatki</strong>) → dotknij ikony <strong>⋯ / aparatu</strong> → <em>Skanuj dokumenty</em>. Gotowy, wielostronicowy PDF dołączysz w zakładce <em>Dokumenty</em> konkretnego mieszkania.</p>
        </div>
      </div>
    `;
  }
}

function renderAll() {
  if (!state) return;
  renderChrome();
  const main = document.getElementById('mainContent');
  if (nav.tab === 'dashboard') renderDashboard(main);
  else if (nav.tab === 'properties') renderPropertiesScreen(main);
  else if (nav.tab === 'finances') renderFinances(main);
  else if (nav.tab === 'templates') renderTemplates(main);
  else if (nav.tab === 'more') void renderMore(main);
}

async function boot() {
  const stage = (txt) => { if (window.__mnSetStage) window.__mnSetStage(txt); };
  try {
    stage('Otwieranie lokalnej bazy danych…');
    void requestPersistentStorage();
    let loaded = await loadState();
    if (!loaded) {
      stage('Tworzenie przykładowych danych i miniatur…');
      loaded = await createDemoData();
      stage('Zapisywanie w pamięci telefonu…');
      await saveState(loaded);
    }
    stage('Uruchamianie interfejsu…');
    state = loaded;
    window.__mnReady = true;
    applyTheme();
    renderAll();

    // Register Service Worker for offline PWA use (HTTPS or localhost)
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* optional offline cache */ });
    }

    // Track user activity to extend auto-lock cleanly while actively editing
    ['pointerdown', 'keydown'].forEach((ev) => {
      window.addEventListener(ev, () => {
        if (editUnlocked) bumpAutoLock();
      }, { passive: true });
    });
  } catch (err) {
    console.error(err);
    window.__mnReady = true;
    document.getElementById('mainContent').innerHTML = `
      <div class="card empty-state" style="text-align:left;max-width:540px;margin:20px auto">
        <strong style="color:var(--danger)">Nie udało się uruchomić lokalnej bazy danych</strong>
        <p class="text-sm">${esc(err?.message || err)}</p>
        <p class="text-xs muted">Etap: ${esc(window.__mnStage || '—')}. Sprawdź, czy nie używasz trybu prywatnego Safari z zablokowanym IndexedDB.</p>
        <div class="inline-flex" style="margin-top:10px;flex-wrap:wrap">
          <button type="button" class="btn btn-sm" onclick="location.reload()">Odśwież</button>
          <button type="button" class="btn btn-primary btn-sm" id="bootEmptyBtn">Uruchom na czysto (bez demo)</button>
        </div>
      </div>`;
    document.getElementById('bootEmptyBtn')?.addEventListener('click', async () => {
      state = createEmptyState(false);
      try { await saveState(state); } catch { /* in-memory fallback */ }
      applyTheme();
      renderAll();
    });
  }
}

void boot();
