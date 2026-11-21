// Pure domain logic for "Mój Najem" (zero DOM / browser dependencies for Node unit testing).

export const SCHEMA_VERSION = 1;

export const UTILITY_KEYS = [
  { key: 'czynszAdm', label: 'Czynsz adm. / wspólnota' },
  { key: 'prad', label: 'Prąd' },
  { key: 'woda', label: 'Woda i ścieki' },
  { key: 'gaz', label: 'Gaz' },
  { key: 'ogrzewanie', label: 'Ogrzewanie' },
  { key: 'smieci', label: 'Śmieci / odpady' },
  { key: 'internet', label: 'Internet / TV' },
  { key: 'inne', label: 'Inne opłaty' },
];

export const DOC_CATEGORIES = [
  { id: 'umowa', label: 'Umowa najmu', required: true, short: 'UM' },
  { id: 'protokol_wydania', label: 'Protokół zdawczo-odbiorczy (wydanie)', required: true, short: 'PW' },
  { id: 'protokol_wyposazenia', label: 'Protokół zawartości / wyposażenia', required: true, short: 'WZ' },
  { id: 'protokol_zdania', label: 'Protokół zdawczo-odbiorczy (zdanie)', required: false, short: 'PZ' },
  { id: 'aneks', label: 'Aneks / wypowiedzenie', required: false, short: 'AN' },
  { id: 'kaucja', label: 'Potwierdzenie kaucji / polisa', required: false, short: 'KA' },
  { id: 'inne', label: 'Inny dokument', required: false, short: 'IN' },
];

export const TEMPLATE_CATEGORIES = [
  { id: 'umowa', label: 'Umowa najmu (in blanco)' },
  { id: 'protokol_zdawczy', label: 'Protokół zdawczo-odbiorczy' },
  { id: 'protokol_wyposazenia', label: 'Protokół zawartości / wyposażenia' },
  { id: 'aneks', label: 'Aneks / wypowiedzenie' },
  { id: 'inne', label: 'Inny wzór dokumentu' },
];

export const PHOTO_STAGES = [
  { id: 'start', label: 'Początek najmu (wydanie)', short: 'Początek' },
  { id: 'during', label: 'W trakcie najmu', short: 'W trakcie' },
  { id: 'end', label: 'Koniec najmu (zdanie)', short: 'Koniec' },
];

export const DEFAULT_ROOMS = [
  'Salon / Pokój',
  'Kuchnia',
  'Łazienka',
  'Sypialnia',
  'Przedpokój',
  'Balkon / Taras',
  'Liczniki',
  'Klucze / Wejście',
  'Garaż / Piwnica',
  'Lokal — widok ogólny',
  'Inne',
];

export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`;
}

export function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function sumBreakdown(breakdown) {
  if (!breakdown || typeof breakdown !== 'object') return 0;
  let total = 0;
  for (const { key } of UTILITY_KEYS) {
    total += Number(breakdown[key]) || 0;
  }
  return roundMoney(total);
}

export function emptyBreakdown() {
  const obj = {};
  for (const { key } of UTILITY_KEYS) obj[key] = 0;
  return obj;
}

export function hasNonZeroBreakdown(breakdown) {
  if (!breakdown) return false;
  return UTILITY_KEYS.some(({ key }) => (Number(breakdown[key]) || 0) > 0);
}

export function formatPLN(amount, showDecimals = false) {
  const val = roundMoney(amount);
  const decimals = showDecimals || Math.abs(val % 1) > 0.001 ? 2 : 0;
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(val) + ' zł';
}

export function formatPLNPlain(amount) {
  return roundMoney(amount).toFixed(2).replace('.', ',');
}

export function formatDatePL(isoDate) {
  if (!isoDate) return '—';
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return isoDate;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function formatMonthPL(monthKey) {
  if (!monthKey) return '—';
  const parts = monthKey.split('-');
  if (parts.length !== 2) return monthKey;
  const names = [
    'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
    'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
  ];
  const idx = Number(parts[1]) - 1;
  return idx >= 0 && idx < 12 ? `${names[idx]} ${parts[0]}` : monthKey;
}

export function formatMonthShort(monthKey) {
  const parts = String(monthKey || '').split('-');
  if (parts.length !== 2) return monthKey || '';
  const names = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  const idx = Number(parts[1]) - 1;
  return idx >= 0 && idx < 12 ? `${names[idx]} ${parts[0].slice(2)}` : monthKey;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function pluralPL(n, one, few, many) {
  const abs = Math.abs(Math.trunc(n));
  if (abs === 1) return `${n} ${one}`;
  const last2 = abs % 100;
  const last = abs % 10;
  if (last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentMonthKey(date = new Date()) {
  return todayISO(date).slice(0, 7);
}

export function parseISODateUTC(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function daysBetweenISO(fromISO, toISO) {
  const a = parseISODateUTC(fromISO);
  const b = parseISODateUTC(toISO);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000);
}

export function addMonthsToKey(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function daysInMonthKey(monthKey) {
  const parts = String(monthKey || '').split('-').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return 30;
  return new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
}

/**
 * Calculates pro-rata (inclusive) amounts for a partial rental month.
 */
export function calculateProRata(monthlyAmount, monthKey, fromDay = 1, toDay = null) {
  const totalDays = daysInMonthKey(monthKey);
  const start = Math.max(1, Math.min(totalDays, Math.trunc(Number(fromDay) || 1)));
  const end = toDay == null ? totalDays : Math.max(start, Math.min(totalDays, Math.trunc(Number(toDay) || totalDays)));
  const activeDays = end - start + 1;
  const amount = roundMoney((Number(monthlyAmount) || 0) * (activeDays / totalDays));
  return { amount, activeDays, totalDays, fromDay: start, toDay: end };
}

export function getMonthSequence(fromMonthKey, toMonthKey) {
  if (!fromMonthKey || !toMonthKey || fromMonthKey > toMonthKey) return [];
  const list = [];
  let cur = fromMonthKey;
  let guard = 0;
  while (cur <= toMonthKey && guard < 240) {
    list.push(cur);
    cur = addMonthsToKey(cur, 1);
    guard++;
  }
  return list;
}

export function createEmptyState(isDemo = false) {
  return {
    schemaVersion: SCHEMA_VERSION,
    isDemo,
    readOnlySnapshot: null, // if non-null: { exportedAt, note }
    settings: {
      requireUnlockForEdit: true,
      autoLockMinutes: 5,
      expiringAlertDays: 60,
      theme: 'system', // 'system' | 'light' | 'dark'
      pinHash: null,
      pinSalt: null,
      compressPhotos: true,
      lastBackupAt: null,
      currency: 'PLN',
    },
    properties: [],
    units: [],
    leases: [],
    payments: [],
    photos: [],
    documents: [],
    templates: [],
    auditLog: [],
  };
}

export function getLeaseStatus(lease, refISO = todayISO(), expiringDays = 60) {
  if (!lease || lease.deletedAt) return { code: 'vacant', label: 'Pustostan', tone: 'neutral', daysLeft: null, progress: 0 };
  if (lease.archivedAt) {
    return { code: 'archived', label: 'Archiwum', tone: 'neutral', daysLeft: null, progress: 100 };
  }
  const startDays = daysBetweenISO(refISO, lease.startDate);
  if (startDays != null && startDays > 0) {
    return { code: 'upcoming', label: `Od ${formatDatePL(lease.startDate)}`, tone: 'neutral', daysLeft: startDays, progress: 0 };
  }
  if (lease.isIndefinite || !lease.endDate) {
    return { code: 'indefinite', label: 'Czas nieokreślony', tone: 'ok', daysLeft: null, progress: null };
  }
  const left = daysBetweenISO(refISO, lease.endDate);
  const total = daysBetweenISO(lease.startDate, lease.endDate) || 1;
  const elapsed = daysBetweenISO(lease.startDate, refISO) || 0;
  const progress = Math.max(0, Math.min(100, Math.round((elapsed / Math.max(1, total)) * 100)));
  if (left < 0) {
    return { code: 'expired', label: `Po terminie (${Math.abs(left)} dni)`, tone: 'danger', daysLeft: left, progress: 100 };
  }
  if (left === 0) {
    return { code: 'expiring', label: 'Kończy się dziś', tone: 'danger', daysLeft: 0, progress: 100 };
  }
  if (left <= expiringDays) {
    return { code: 'expiring', label: `Wygasa za ${left} dni`, tone: 'warn', daysLeft: left, progress };
  }
  return { code: 'active', label: 'Aktywny', tone: 'ok', daysLeft: left, progress };
}

export function getActiveLeaseForUnit(state, unitId) {
  return state.leases.find((l) => l.unitId === unitId && !l.deletedAt && !l.archivedAt) || null;
}

export function getArchivedLeasesForUnit(state, unitId) {
  return state.leases
    .filter((l) => l.unitId === unitId && !l.deletedAt && !!l.archivedAt)
    .sort((a, b) => String(b.endDate || b.archivedAt).localeCompare(String(a.endDate || a.archivedAt)));
}

export function getEffectiveMediaAmount(payment) {
  if (!payment) return 0;
  if (payment.useBreakdown && payment.utilitiesBreakdown) {
    return sumBreakdown(payment.utilitiesBreakdown);
  }
  return roundMoney(payment.utilitiesAmount);
}

/**
 * Returns total amount already received for a payment entry (handles full `paid`,
 * empty `pending`, and multi-person `installments` / partial transfers).
 */
export function getPaymentPaidAmount(payment) {
  if (!payment) return 0;
  const expected = roundMoney(roundMoney(payment.rentAmount) + getEffectiveMediaAmount(payment));
  const inst = Array.isArray(payment.installments) ? payment.installments : [];
  if (inst.length > 0) {
    return roundMoney(inst.reduce((sum, item) => sum + (Number(item.amount) || 0), 0));
  }
  return payment.status === 'paid' ? expected : 0;
}

export function getPaymentBalance(payment) {
  const rent = roundMoney(payment?.rentAmount);
  const utilities = getEffectiveMediaAmount(payment);
  const expected = roundMoney(rent + utilities);
  const paid = getPaymentPaidAmount(payment);
  const remaining = roundMoney(Math.max(0, expected - paid));
  const overpaid = roundMoney(Math.max(0, paid - expected));
  let state = 'pending';
  if (payment?.status === 'paid' || (expected > 0 && paid >= expected - 0.005)) {
    state = 'paid';
  } else if (paid > 0) {
    state = 'partial';
  }
  return { rent, utilities, expected, paid, remaining, overpaid, state };
}

export function syncPaymentStatusFromInstallments(payment) {
  if (!payment) return;
  const inst = Array.isArray(payment.installments) ? payment.installments : [];
  if (inst.length === 0) return;
  const expected = roundMoney(roundMoney(payment.rentAmount) + getEffectiveMediaAmount(payment));
  const sum = roundMoney(inst.reduce((a, b) => a + (Number(b.amount) || 0), 0));
  if (sum <= 0) {
    payment.status = 'pending';
    payment.paidDate = '';
  } else if (sum >= expected - 0.005) {
    payment.status = 'paid';
    const lastDate = inst.map((x) => x.date).filter(Boolean).sort().pop();
    payment.paidDate = lastDate || todayISO();
  } else {
    payment.status = 'partial';
    payment.paidDate = '';
  }
}

/**
 * Parses numeric value from a Polish meter reading string (e.g. "4 812,4 kWh" -> 4812.4).
 */
export function parseMeterReading(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/\u00A0/g, ' ').trim();
  if (!cleaned || cleaned === '—' || cleaned === '-') return null;
  const match = cleaned.match(/-?\d[\d\s]*([.,]\d+)?/);
  if (!match) return null;
  const num = Number(match[0].replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : null;
}

export function computeMeterDelta(startRaw, endRaw, unitSuffix = '') {
  const a = parseMeterReading(startRaw);
  const b = parseMeterReading(endRaw);
  if (a == null || b == null) return null;
  const diff = Math.round((b - a) * 100) / 100;
  const formatted = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(diff);
  return unitSuffix ? `${formatted} ${unitSuffix}` : formatted;
}

/**
 * Records a bank transfer against `payment`. If `amount` exceeds what remains due on `payment`
 * and `carryOverpayment === true`, automatically cascades the surplus into consecutive future
 * months as `installments` (creating expected monthly rows from `lease` if needed).
 * Returns `{ applied: Array<{month, amount, status, isCarryover}>, unallocated: number }`.
 */
export function applyTransferWithOverpayment(state, opts) {
  const {
    payment,
    lease = null,
    amount,
    date = todayISO(),
    payer = '',
    note = '',
    carryOverpayment = true,
    maxCarryMonths = 24,
  } = opts;

  let left = roundMoney(amount);
  if (left <= 0) throw new Error('Kwota przelewu musi być większa niż 0 zł.');
  if (!payment) throw new Error('Brak wpisu płatności.');

  const applied = [];
  const sourceMonth = payment.month;
  const ensureInst = (p) => { if (!Array.isArray(p.installments)) p.installments = []; };

  // Non-cascading mode: put full transfer on this payment directly
  if (!carryOverpayment) {
    ensureInst(payment);
    payment.installments.push({ id: uid('inst'), amount: left, date, payer, note });
    syncPaymentStatusFromInstallments(payment);
    applied.push({ month: payment.month, amount: left, status: payment.status, isCarryover: false });
    return { applied, unallocated: 0 };
  }

  let target = payment;
  let curMonth = payment.month;
  let step = 0;

  while (left > 0.005 && step <= maxCarryMonths) {
    const isCarry = step > 0;
    if (!target) {
      // Find existing non-deleted entry for same unit + month
      target = state.payments.find(
        (p) => !p.deletedAt && p.unitId === payment.unitId && p.month === curMonth
      ) || null;
      if (!target) {
        const srcLease = lease || state.leases.find((l) => l.id === payment.leaseId && !l.deletedAt);
        if (!srcLease) break;
        target = buildPaymentFromLease(srcLease, curMonth, 'pending');
        target.note = `Utworzono z nadpłaty (${formatMonthShort(sourceMonth)})`;
        state.payments.push(target);
      }
    }

    ensureInst(target);
    // If target was manually marked 'paid' without itemized installments, don't double-apply on top
    const bal = getPaymentBalance(target);
    const need = bal.state === 'paid' ? 0 : bal.remaining;

    if (need > 0.005) {
      const slice = roundMoney(Math.min(left, need));
      target.installments.push({
        id: uid('inst'),
        amount: slice,
        date,
        payer,
        note: isCarry
          ? `Nadpłata z ${formatMonthShort(sourceMonth)}${note ? ` (${note})` : ''}`
          : (left > need + 0.005
            ? `${note ? `${note} • ` : ''}przelew ${formatPLN(amount)} (nadpłata przeniesiona dalej)`
            : note),
        isCarryover: isCarry,
        sourcePaymentId: isCarry ? payment.id : undefined,
      });
      syncPaymentStatusFromInstallments(target);
      applied.push({ month: target.month, amount: slice, status: target.status, isCarryover: isCarry });
      left = roundMoney(left - slice);
    }

    if (left <= 0.005) break;
    curMonth = addMonthsToKey(curMonth, 1);
    target = null;
    step += 1;
  }

  // Fallback: if anything couldn't be carried forward (no lease or hit cap), retain on original payment
  if (left > 0.005) {
    ensureInst(payment);
    payment.installments.push({
      id: uid('inst'),
      amount: left,
      date,
      payer,
      note: 'Nierozliczona nadpłata',
    });
    syncPaymentStatusFromInstallments(payment);
    applied.push({ month: payment.month, amount: left, status: payment.status, isCarryover: false, leftover: true });
    return { applied, unallocated: left };
  }

  return { applied, unallocated: 0 };
}

export function addBucketTotals(acc, payment) {
  const rent = roundMoney(payment.rentAmount);
  const util = getEffectiveMediaAmount(payment);
  const sum = roundMoney(rent + util);
  acc.rent = roundMoney(acc.rent + rent);
  acc.utilities = roundMoney(acc.utilities + util);
  acc.total = roundMoney(acc.total + sum);
  acc.count += 1;

  const bal = getPaymentBalance(payment);
  if (bal.state === 'paid') {
    acc.paidRent = roundMoney(acc.paidRent + rent);
    acc.paidUtilities = roundMoney(acc.paidUtilities + util);
    acc.paidTotal = roundMoney(acc.paidTotal + sum);
    acc.paidCount += 1;
  } else if (bal.state === 'partial' && sum > 0) {
    const ratio = Math.min(1, bal.paid / sum);
    const paidR = roundMoney(rent * ratio);
    const paidU = roundMoney(bal.paid - paidR);
    acc.paidRent = roundMoney(acc.paidRent + paidR);
    acc.paidUtilities = roundMoney(acc.paidUtilities + paidU);
    acc.paidTotal = roundMoney(acc.paidTotal + bal.paid);
    acc.pendingRent = roundMoney(acc.pendingRent + (rent - paidR));
    acc.pendingUtilities = roundMoney(acc.pendingUtilities + (util - paidU));
    acc.pendingTotal = roundMoney(acc.pendingTotal + bal.remaining);
    acc.partialCount = (acc.partialCount || 0) + 1;
    acc.pendingCount += 1;
  } else {
    acc.pendingRent = roundMoney(acc.pendingRent + rent);
    acc.pendingUtilities = roundMoney(acc.pendingUtilities + util);
    acc.pendingTotal = roundMoney(acc.pendingTotal + sum);
    acc.pendingCount += 1;
  }
  if (payment.utilitiesBreakdown) {
    for (const { key } of UTILITY_KEYS) {
      acc.breakdown[key] = roundMoney((acc.breakdown[key] || 0) + (Number(payment.utilitiesBreakdown[key]) || 0));
    }
  }
}

export function makeEmptyTotals() {
  return {
    rent: 0,
    utilities: 0,
    total: 0,
    paidRent: 0,
    paidUtilities: 0,
    paidTotal: 0,
    pendingRent: 0,
    pendingUtilities: 0,
    pendingTotal: 0,
    count: 0,
    paidCount: 0,
    partialCount: 0,
    pendingCount: 0,
    breakdown: emptyBreakdown(),
  };
}

/**
 * Filter:
 *  - period: 'month' | 'year' | 'last12' | 'all'
 *  - monthKey: 'YYYY-MM' (for period === 'month')
 *  - year: 'YYYY' (for period === 'year')
 *  - refMonth: 'YYYY-MM' (anchor for 'last12')
 *  - status: 'all' | 'paid' | 'pending'
 *  - propertyId / unitId / leaseId (optional)
 */
export function filterPayments(state, filter = {}) {
  const {
    period = 'all',
    monthKey = currentMonthKey(),
    year = String(new Date().getFullYear()),
    refMonth = currentMonthKey(),
    status = 'all',
    propertyId = null,
    unitId = null,
    leaseId = null,
  } = filter;

  const min12 = addMonthsToKey(refMonth, -11);
  const unitMap = new Map(state.units.filter((u) => !u.deletedAt).map((u) => [u.id, u]));
  const propMap = new Map(state.properties.filter((p) => !p.deletedAt).map((p) => [p.id, p]));

  return state.payments.filter((p) => {
    if (p.deletedAt) return false;
    const unit = unitMap.get(p.unitId);
    if (!unit || !propMap.get(unit.propertyId)) return false;
    if (propertyId && unit.propertyId !== propertyId) return false;
    if (unitId && p.unitId !== unitId) return false;
    if (leaseId && p.leaseId !== leaseId) return false;
    if (status === 'paid' && p.status !== 'paid') return false;
    if (status === 'pending' && p.status === 'paid') return false;
    if (period === 'month' && p.month !== monthKey) return false;
    if (period === 'year' && !String(p.month || '').startsWith(`${year}-`)) return false;
    if (period === 'last12' && (p.month < min12 || p.month > refMonth)) return false;
    return true;
  });
}

export function computeIncomeHierarchy(state, filter = {}) {
  const activeProps = state.properties.filter((p) => !p.deletedAt);
  const activeUnits = state.units.filter((u) => !u.deletedAt);
  const matching = filterPayments(state, filter);

  const unitTotalsMap = new Map();
  for (const u of activeUnits) unitTotalsMap.set(u.id, makeEmptyTotals());

  const monthMap = new Map();
  const portfolio = makeEmptyTotals();

  for (const p of matching) {
    addBucketTotals(portfolio, p);
    const uBucket = unitTotalsMap.get(p.unitId);
    if (uBucket) addBucketTotals(uBucket, p);
    if (!monthMap.has(p.month)) monthMap.set(p.month, { month: p.month, ...makeEmptyTotals() });
    addBucketTotals(monthMap.get(p.month), p);
  }

  const byProperty = activeProps.map((prop) => {
    const propTotals = makeEmptyTotals();
    const propUnits = activeUnits
      .filter((u) => u.propertyId === prop.id)
      .map((u) => {
        const totals = unitTotalsMap.get(u.id) || makeEmptyTotals();
        return { unit: u, totals };
      });
    for (const entry of matching) {
      const unit = activeUnits.find((u) => u.id === entry.unitId);
      if (unit && unit.propertyId === prop.id) addBucketTotals(propTotals, entry);
    }
    return {
      property: prop,
      totals: propTotals,
      units: propUnits,
    };
  });

  const byMonth = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  return { portfolio, byProperty, byMonth, matching };
}

export function getExpectedMonthlyRunRate(state) {
  const totals = { rent: 0, utilities: 0, total: 0, activeLeases: 0, depositsHeld: 0 };
  const validUnits = new Set(state.units.filter((u) => !u.deletedAt).map((u) => u.id));
  for (const l of state.leases) {
    if (l.deletedAt || l.archivedAt || !validUnits.has(l.unitId)) continue;
    totals.rent = roundMoney(totals.rent + (Number(l.monthlyRent) || 0));
    const util = l.useUtilitiesBreakdown ? sumBreakdown(l.utilitiesBreakdown) : roundMoney(l.monthlyUtilities);
    totals.utilities = roundMoney(totals.utilities + util);
    totals.total = roundMoney(totals.rent + totals.utilities);
    totals.activeLeases += 1;
    totals.depositsHeld = roundMoney(totals.depositsHeld + (Number(l.depositAmount) || 0));
  }
  return totals;
}

export function missingMonthsForLease(lease, existingPayments, upToMonth = currentMonthKey()) {
  if (!lease || !lease.startDate) return [];
  const startMonth = lease.startDate.slice(0, 7);
  const endBound = (!lease.isIndefinite && lease.endDate && lease.endDate.slice(0, 7) < upToMonth)
    ? lease.endDate.slice(0, 7)
    : upToMonth;
  if (startMonth > endBound) return [];
  const existingSet = new Set(
    existingPayments
      .filter((p) => !p.deletedAt && p.leaseId === lease.id)
      .map((p) => p.month)
  );
  return getMonthSequence(startMonth, endBound).filter((m) => !existingSet.has(m));
}

export function buildPaymentFromLease(lease, monthKey, status = 'pending', paidDate = '') {
  const breakdown = lease.utilitiesBreakdown ? { ...emptyBreakdown(), ...lease.utilitiesBreakdown } : emptyBreakdown();
  const useBreakdown = !!lease.useUtilitiesBreakdown && hasNonZeroBreakdown(breakdown);
  const utilAmount = useBreakdown ? sumBreakdown(breakdown) : roundMoney(lease.monthlyUtilities);
  return {
    id: uid('pay'),
    unitId: lease.unitId,
    leaseId: lease.id,
    month: monthKey,
    rentAmount: roundMoney(lease.monthlyRent),
    utilitiesAmount: utilAmount,
    useBreakdown,
    utilitiesBreakdown: breakdown,
    status,
    installments: [],
    paidDate: status === 'paid' ? (paidDate || todayISO()) : '',
    note: '',
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
}

/**
 * Generates payment entries triggered directly by a lease's startDate (supports backdated and future leases).
 * @param {object} lease
 * @param {{ mode?: 'all_to_now'|'first_only'|'none', markPastPaid?: boolean, prorateFirst?: boolean, refMonth?: string }} opts
 */
export function generateLeasePayments(lease, opts = {}) {
  const {
    mode = 'all_to_now',
    markPastPaid = false,
    prorateFirst = true,
    refMonth = currentMonthKey(),
  } = opts;
  if (!lease?.startDate || mode === 'none') return [];
  const startMonth = lease.startDate.slice(0, 7);
  const startDay = Number(lease.startDate.slice(8, 10)) || 1;
  const endMonth = (!lease.isIndefinite && lease.endDate) ? lease.endDate.slice(0, 7) : null;
  const endDay = (!lease.isIndefinite && lease.endDate) ? (Number(lease.endDate.slice(8, 10)) || daysInMonthKey(endMonth)) : null;

  let months;
  if (mode === 'first_only') {
    months = [startMonth];
  } else {
    // all_to_now: from startMonth to min(endMonth, refMonth); if future lease -> just startMonth
    if (startMonth > refMonth) {
      months = [startMonth];
    } else {
      const bound = (endMonth && endMonth < refMonth) ? endMonth : refMonth;
      months = getMonthSequence(startMonth, bound);
    }
  }

  const payDay = Math.max(1, Math.min(28, Number(lease.paymentDay) || 10));
  return months.map((mk) => {
    const isPastMonth = mk < refMonth || (!!lease.archivedAt);
    const status = (markPastPaid && isPastMonth) ? 'paid' : 'pending';
    const dStr = `${mk}-${String(Math.min(payDay, daysInMonthKey(mk))).padStart(2, '0')}`;
    const p = buildPaymentFromLease(lease, mk, status, status === 'paid' ? dStr : '');

    // Optional pro-rata for the first month if the lease started after day 1
    if (prorateFirst && mk === startMonth && startDay > 1) {
      const lastD = (endMonth === mk && endDay) ? endDay : daysInMonthKey(mk);
      const rPr = calculateProRata(lease.monthlyRent || 0, mk, startDay, lastD);
      const mPr = calculateProRata(getEffectiveMediaAmount(p), mk, startDay, lastD);
      p.rentAmount = rPr.amount;
      p.utilitiesAmount = mPr.amount;
      p.useBreakdown = false;
      p.note = `Niepełny pierwszy mies.: ${rPr.activeDays}/${rPr.totalDays} dni (od ${rPr.fromDay}.)`;
    } else if (prorateFirst && endMonth === mk && endDay && endDay < daysInMonthKey(mk)) {
      const rPr = calculateProRata(lease.monthlyRent || 0, mk, 1, endDay);
      const mPr = calculateProRata(getEffectiveMediaAmount(p), mk, 1, endDay);
      p.rentAmount = rPr.amount;
      p.utilitiesAmount = mPr.amount;
      p.useBreakdown = false;
      p.note = `Niepełny ostatni mies.: ${rPr.activeDays}/${rPr.totalDays} dni (do ${rPr.toDay}.)`;
    }
    return p;
  });
}

/**
 * Smart Tenant Turnover transition.
 * Mutates a shallow copy of arrays inside `state` (returns summary object).
 */
export function performTenantTurnover(state, opts) {
  const {
    unitId,
    oldLeaseId,
    handoverDate,
    endMeters = {},
    depositOutcome = 'returned', // 'returned' | 'partial' | 'retained'
    depositReturnedAmount = 0,
    depositNote = '',
    createNewLease = false,
    newLeaseData = null,
    carryMeters = true,
    carryInventory = true,
    carryPhotoIds = [],
  } = opts;

  const nowIso = new Date().toISOString();
  const unit = state.units.find((u) => u.id === unitId && !u.deletedAt);
  if (!unit) throw new Error('Nie znaleziono lokalu.');

  let oldLease = null;
  if (oldLeaseId) {
    oldLease = state.leases.find((l) => l.id === oldLeaseId && l.unitId === unitId && !l.deletedAt);
    if (!oldLease) throw new Error('Nie znaleziono zamykanej umowy.');
    oldLease.endDate = handoverDate || oldLease.endDate || todayISO();
    oldLease.isIndefinite = false;
    oldLease.archivedAt = nowIso;
    oldLease.endMeters = { ...endMeters };
    oldLease.depositSettlement = {
      outcome: depositOutcome,
      returnedAmount: roundMoney(depositReturnedAmount),
      deductedAmount: roundMoney(Math.max(0, (Number(oldLease.depositAmount) || 0) - Number(depositReturnedAmount || 0))),
      settledDate: handoverDate || todayISO(),
      note: depositNote || '',
    };
  }

  let createdLease = null;
  let carriedPhotosCount = 0;

  if (createNewLease && newLeaseData) {
    const startMeters = carryMeters ? { ...endMeters } : { ...(newLeaseData.startMeters || {}) };
    const breakdown = { ...emptyBreakdown(), ...(newLeaseData.utilitiesBreakdown || {}) };
    const useBd = !!newLeaseData.useUtilitiesBreakdown && hasNonZeroBreakdown(breakdown);
    createdLease = {
      id: uid('lease'),
      unitId,
      tenant: {
        name: (newLeaseData.tenant?.name || '').trim(),
        phone: (newLeaseData.tenant?.phone || '').trim(),
        email: (newLeaseData.tenant?.email || '').trim(),
        address: (newLeaseData.tenant?.address || '').trim(),
        idInfo: (newLeaseData.tenant?.idInfo || '').trim(),
        emergencyContact: (newLeaseData.tenant?.emergencyContact || '').trim(),
        bankAccount: (newLeaseData.tenant?.bankAccount || '').trim(),
        notes: (newLeaseData.tenant?.notes || '').trim(),
      },
      startDate: newLeaseData.startDate || handoverDate || todayISO(),
      endDate: newLeaseData.isIndefinite ? '' : (newLeaseData.endDate || ''),
      isIndefinite: !!newLeaseData.isIndefinite,
      noticePeriodDays: Number(newLeaseData.noticePeriodDays) || 30,
      paymentDay: Number(newLeaseData.paymentDay) || 10,
      monthlyRent: roundMoney(newLeaseData.monthlyRent),
      monthlyUtilities: useBd ? sumBreakdown(breakdown) : roundMoney(newLeaseData.monthlyUtilities),
      useUtilitiesBreakdown: useBd,
      utilitiesBreakdown: breakdown,
      depositAmount: roundMoney(newLeaseData.depositAmount),
      depositPaid: !!newLeaseData.depositPaid,
      startMeters,
      endMeters: {},
      depositSettlement: null,
      inventoryNote: carryInventory && oldLease
        ? (newLeaseData.inventoryNote || oldLease.inventoryNote || unit.baseInventory || '')
        : (newLeaseData.inventoryNote || unit.baseInventory || ''),
      notes: newLeaseData.notes || '',
      createdAt: nowIso,
      archivedAt: null,
      deletedAt: null,
    };
    state.leases.push(createdLease);

    // Reference existing blobs safely so the user doesn't duplicate MBs on disk
    if (Array.isArray(carryPhotoIds) && carryPhotoIds.length > 0 && oldLease) {
      for (const pid of carryPhotoIds) {
        const src = state.photos.find((p) => p.id === pid && !p.deletedAt);
        if (!src) continue;
        state.photos.push({
          id: uid('photo'),
          unitId,
          leaseId: createdLease.id,
          stage: 'start',
          room: src.room,
          takenAt: handoverDate || todayISO(),
          note: src.note ? `${src.note} (przeniesione ze zdania poprz. umowy)` : 'Przeniesione ze zdania poprzedniej umowy',
          fileName: src.fileName,
          mimeType: src.mimeType,
          blobKey: src.blobKey,
          thumbKey: src.thumbKey,
          size: src.size,
          sharedBlob: true,
          createdAt: nowIso,
          deletedAt: null,
        });
        carriedPhotosCount += 1;
      }
    }
  }

  return { oldLease, createdLease, carriedPhotosCount };
}

export function appendAudit(state, action, details) {
  state.auditLog.unshift({
    id: uid('log'),
    at: new Date().toISOString(),
    action,
    details,
  });
  if (state.auditLog.length > 500) state.auditLog.length = 500;
}

export function exportPaymentsCsv(state, filter = {}) {
  const rows = filterPayments(state, filter).slice().sort((a, b) => a.month.localeCompare(b.month));
  const propMap = new Map(state.properties.map((p) => [p.id, p]));
  const unitMap = new Map(state.units.map((u) => [u.id, u]));
  const leaseMap = new Map(state.leases.map((l) => [l.id, l]));

  const esc = (v) => {
    const s = String(v ?? '').replace(/\r?\n/g, ' ');
    return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const headers = [
    'Miesiąc', 'Nieruchomość', 'Adres', 'Lokal', 'Najemca', 'Status umowy',
    'Najem (PLN)', 'Media (PLN)', 'Razem (PLN)', 'Status wpłaty', 'Data wpłaty',
    ...UTILITY_KEYS.map((u) => `${u.label} (PLN)`),
    'Uwagi',
  ];

  const lines = [headers.map(esc).join(';')];
  for (const p of rows) {
    const u = unitMap.get(p.unitId);
    const prop = u ? propMap.get(u.propertyId) : null;
    const lease = leaseMap.get(p.leaseId);
    const rent = roundMoney(p.rentAmount);
    const util = getEffectiveMediaAmount(p);
    const bd = p.utilitiesBreakdown || {};
    const statusLabel = p.status === 'paid'
      ? 'Opłacone'
      : p.status === 'partial'
        ? `Częściowo (${formatPLNPlain(getPaymentPaidAmount(p))} / ${formatPLNPlain(rent + util)})`
        : 'Oczekujące';
    lines.push([
      p.month,
      prop?.name || '',
      prop?.address || '',
      u?.name || '',
      lease?.tenant?.name || '',
      lease?.archivedAt ? 'Archiwum' : 'Aktywna',
      formatPLNPlain(rent),
      formatPLNPlain(util),
      formatPLNPlain(rent + util),
      statusLabel,
      p.paidDate || '',
      ...UTILITY_KEYS.map((k) => formatPLNPlain(bd[k] || 0)),
      p.note || '',
    ].map(esc).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n');
}

function escapeICS(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

export function buildLeaseReminderIcs(property, unit, lease) {
  if (!lease?.endDate || lease.isIndefinite) {
    throw new Error('Umowa nie ma określonej daty zakończenia.');
  }
  const dateCompact = lease.endDate.replace(/-/g, '');
  // Next day for all-day DTEND
  const utcEnd = parseISODateUTC(lease.endDate);
  const nextDay = new Date(utcEnd + 86400000);
  const nextCompact = `${nextDay.getUTCFullYear()}${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}${String(nextDay.getUTCDate()).padStart(2, '0')}`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const label = property.kind === 'single' ? property.name : `${property.name} — ${unit.name}`;
  const desc = [
    `Nieruchomość: ${label}`,
    `Adres: ${property.address || ''}`,
    `Najemca: ${lease.tenant?.name || '—'}`,
    lease.tenant?.phone ? `Tel: ${lease.tenant.phone}` : '',
    `Czynsz najmu: ${formatPLN(lease.monthlyRent)} | Media: ${formatPLN(lease.monthlyUtilities)}`,
    `Okres wypowiedzenia: ${lease.noticePeriodDays || 30} dni`,
  ].filter(Boolean).join('\n');

  const alarm = (days, text) => [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeICS(text)}`,
    `TRIGGER:-P${days}D`,
    'END:VALARM',
  ].join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Moj Najem PWA//PL',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${lease.id}@moj-najem.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${dateCompact}`,
    `DTEND;VALUE=DATE:${nextCompact}`,
    `SUMMARY:${escapeICS(`Koniec umowy najmu: ${label} (${lease.tenant?.name || 'Najemca'})`)}`,
    `DESCRIPTION:${escapeICS(desc)}`,
    alarm(60, `Za 60 dni kończy się umowa najmu: ${label}`),
    alarm(30, `Za 30 dni kończy się umowa najmu: ${label}`),
    alarm(14, `Za 14 dni kończy się umowa najmu: ${label}`),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

// ---------- Minimal standard ZIP (STORE + UTF-8 filenames + real CRC-32) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function sanitizePathSegment(name, fallback = 'plik') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return cleaned.slice(0, 96) || fallback;
}

function dosTimeDate(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosTime, dosDate };
}

/**
 * Build an uncompressed (STORE) ZIP archive compatible with Windows, macOS, Linux and iOS Files.
 * @param {Array<{name: string, data: Uint8Array|string, date?: Date}>} entries
 * @returns {Uint8Array}
 */
export function buildZip(entries) {
  const enc = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const safeName = String(entry.name || 'file').replace(/^\/+/, '').replace(/\\/g, '/');
    const nameBytes = enc.encode(safeName);
    const dataBytes = typeof entry.data === 'string'
      ? enc.encode(entry.data)
      : (entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data));
    const crc = crc32(dataBytes);
    const size = dataBytes.length;
    const { dosTime, dosDate } = dosTimeDate(entry.date || new Date());

    // Local file header (30 bytes + name)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, 0x0800, true);      // UTF-8 filename flag
    lv.setUint16(8, 0, true);           // STORE (no compression)
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    localChunks.push(lh, dataBytes);

    // Central directory header (46 bytes + name)
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 0x031e, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);      // UTF-8 filename flag
    cv.setUint16(10, 0, true);          // STORE
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centralChunks.push(ch);

    offset += lh.length + dataBytes.length;
  }

  let cdSize = 0;
  for (const c of centralChunks) cdSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const out = new Uint8Array(offset + cdSize + 22);
  let pos = 0;
  for (const chunk of localChunks) { out.set(chunk, pos); pos += chunk.length; }
  for (const chunk of centralChunks) { out.set(chunk, pos); pos += chunk.length; }
  out.set(eocd, pos);
  return out;
}

/**
 * Reads STORE (method 0) and DEFLATE (method 8, if DecompressionStream is present) ZIP files.
 * @param {Uint8Array} bytes
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function parseZip(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dec = new TextDecoder('utf-8');

  // Find End of Central Directory (0x06054b50) searching backwards
  let eocdOffset = -1;
  const minPos = Math.max(0, data.length - 65557);
  for (let i = data.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Nieprawidłowy plik ZIP (brak nagłówka EOCD).');

  const count = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const files = new Map();

  let cur = cdOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cur, true) !== 0x02014b50) {
      throw new Error('Uszkodzony katalog centralny pliku ZIP.');
    }
    const method = view.getUint16(cur + 10, true);
    const expectedCrc = view.getUint32(cur + 16, true);
    const compSize = view.getUint32(cur + 20, true);
    const nameLen = view.getUint16(cur + 28, true);
    const extraLen = view.getUint16(cur + 30, true);
    const commentLen = view.getUint16(cur + 32, true);
    const localOffset = view.getUint32(cur + 42, true);
    const name = dec.decode(data.subarray(cur + 46, cur + 46 + nameLen));
    cur += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(`Uszkodzony wpis ZIP: ${name}`);
    }
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const payloadStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = data.subarray(payloadStart, payloadStart + compSize);

    let extracted;
    if (method === 0) {
      extracted = raw.slice();
    } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(raw);
      writer.close();
      const resp = new Response(ds.readable);
      extracted = new Uint8Array(await resp.arrayBuffer());
    } else {
      throw new Error(`Nieobsługiwana metoda kompresji ZIP (${method}) dla pliku ${name}`);
    }

    if (crc32(extracted) !== expectedCrc) {
      throw new Error(`Błąd sumy kontrolnej CRC dla pliku: ${name}`);
    }
    files.set(name, extracted);
  }
  return files;
}

export async function hashPin(pin, saltHex = null) {
  const bytes = new Uint8Array(16);
  let salt = saltHex;
  if (!salt) {
    crypto.getRandomValues(bytes);
    salt = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pin}`));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { hash, salt };
}
