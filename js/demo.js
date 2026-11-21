// Realistic Polish sample dataset so the user can test every workflow (including Before/After photo slider & PDFs).
import { addMonthsToKey, createEmptyState, currentMonthKey, emptyBreakdown, todayISO } from './domain.js';
import { putBlob } from './db.js';
import { buildSimplePdfBytes } from './pdf_demo.js';

function addDaysISO(baseISO, days) {
  const [y, m, d] = baseISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function dataUrlToBlob(dataUrl, fallbackType = 'image/jpeg') {
  const parts = dataUrl.split(',');
  const mime = (parts[0].match(/:(.*?);/) || [])[1] || fallbackType;
  const bin = atob(parts[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function canvasToJpegSafe(canvas, quality) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      if (blob) return resolve(blob);
      try {
        resolve(dataUrlToBlob(canvas.toDataURL('image/jpeg', quality)));
      } catch {
        resolve(new Blob([], { type: 'image/jpeg' }));
      }
    };
    const timer = setTimeout(() => finish(null), 1500);
    if (typeof canvas.toBlob === 'function') {
      try {
        canvas.toBlob((b) => { clearTimeout(timer); finish(b); }, 'image/jpeg', quality);
        return;
      } catch { /* fallback below */ }
    }
    clearTimeout(timer);
    finish(null);
  });
}

function renderSampleRoomPhoto(roomLabel, stageLabel, dateText, variant) {
  return (async () => {
    const w = 960;
    const h = 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');

    // Warm wall & floor illustration so before/after slider shows clear realistic comparison
    const isEnd = variant === 'end';
    const isKitchen = roomLabel.includes('Kuchnia');
    const isMeter = roomLabel.includes('Liczniki');

    if (isMeter) {
      c.fillStyle = '#dde3e6';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      c.fillRect(210, 130, 540, 440);
      c.strokeStyle = '#334155';
      c.lineWidth = 6;
      c.strokeRect(210, 130, 540, 440);
      c.fillStyle = '#0f172a';
      c.fillRect(280, 260, 400, 96);
      c.fillStyle = '#34d399';
      c.font = 'bold 54px monospace';
      c.textAlign = 'center';
      c.fillText(isEnd ? '04 812,4' : '02 190,0', w / 2, 326);
      c.fillStyle = '#334155';
      c.font = 'bold 26px sans-serif';
      c.fillText('LICZNIK ENERGII (kWh)', w / 2, 210);
      c.font = '20px sans-serif';
      c.fillStyle = '#64748b';
      c.fillText(isEnd ? 'Stan zdania lokalu' : 'Stan wydania lokalu', w / 2, 425);
    } else {
      // Wall gradient
      const wallGrad = c.createLinearGradient(0, 0, 0, h * 0.7);
      wallGrad.addColorStop(0, isKitchen ? '#edf2f4' : '#f4efe6');
      wallGrad.addColorStop(1, isKitchen ? '#d9e3e8' : '#e6dfd3');
      c.fillStyle = wallGrad;
      c.fillRect(0, 0, w, h * 0.68);
      // Floor
      c.fillStyle = isKitchen ? '#c2c8cc' : '#b78e65';
      c.fillRect(0, h * 0.68, w, h * 0.32);
      // Floor planks / tiles
      c.strokeStyle = 'rgba(0,0,0,0.12)';
      c.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        const y = h * 0.68 + i * 24;
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
      }
      // Window with daylight
      c.fillStyle = isEnd ? '#bfd8ea' : '#cfe7f7';
      c.fillRect(520, 100, 270, 250);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 14;
      c.strokeRect(520, 100, 270, 250);
      c.beginPath(); c.moveTo(655, 100); c.lineTo(655, 350); c.stroke();

      if (isKitchen) {
        // Cabinets
        c.fillStyle = '#ffffff';
        c.fillRect(80, 320, 400, 200);
        c.strokeStyle = '#94a3b8'; c.lineWidth = 3;
        c.strokeRect(80, 320, 400, 200);
        c.fillStyle = '#334155';
        c.fillRect(72, 308, 416, 18);
        c.fillStyle = '#e2e8f0';
        c.fillRect(80, 110, 400, 130);
        c.strokeRect(80, 110, 400, 130);
      } else {
        // Sofa / sideboard illustration
        c.fillStyle = '#365558';
        c.fillRect(120, 340, 360, 160);
        c.fillStyle = '#284043';
        c.fillRect(100, 400, 400, 100);
        // Picture frame
        c.fillStyle = '#ffffff';
        c.fillRect(180, 135, 220, 150);
        c.strokeStyle = '#8b6e4e'; c.lineWidth = 8;
        c.strokeRect(180, 135, 220, 150);
        c.fillStyle = '#0f5d56';
        c.beginPath(); c.arc(290, 210, 42, 0, Math.PI * 2); c.fill();
      }

      if (isEnd) {
        // Draw subtle wear/scuff marker for comparison demo
        c.fillStyle = 'rgba(130, 88, 60, 0.28)';
        c.beginPath(); c.ellipse(340, 275, 42, 18, -0.2, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#dc2626';
        c.lineWidth = 4;
        c.setLineDash([10, 8]);
        c.beginPath(); c.arc(340, 275, 62, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#b91c1c';
        c.font = 'bold 20px sans-serif';
        c.fillText('Drobne otarcie ściany', 235, 362);
      }
    }

    // Bottom info watermark pill
    c.fillStyle = 'rgba(15, 23, 42, 0.78)';
    c.fillRect(28, h - 98, 520, 72);
    c.fillStyle = '#ffffff';
    c.textAlign = 'left';
    c.font = 'bold 24px sans-serif';
    c.fillText(`${roomLabel} — ${stageLabel}`, 48, h - 63);
    c.fillStyle = '#cbd5e1';
    c.font = '18px sans-serif';
    c.fillText(`Zdjęcie przykładowe • ${dateText}`, 48, h - 38);

    const mainBlob = await canvasToJpegSafe(canvas, 0.85);
    const thumb = document.createElement('canvas');
    thumb.width = 360; thumb.height = 270;
    thumb.getContext('2d').drawImage(canvas, 0, 0, 360, 270);
    const thumbBlob = await canvasToJpegSafe(thumb, 0.78);
    return { mainBlob, thumbBlob };
  })();
}

export async function createDemoData() {
  const nowISO = todayISO();
  const curMonth = currentMonthKey();
  const state = createEmptyState(true);

  // Properties
  const propKamienica = {
    id: 'prop_kamienica',
    name: 'Kamienica „Pod Kasztanem”',
    address: 'ul. Długa 14, 31-146 Kraków',
    kind: 'building', // 'single' | 'building'
    notes: 'Kamienica po remoncie elewacji w 2023 r. Zarząd wspólny, ogrzewanie miejskie.',
    createdAt: '2024-01-10T10:00:00Z',
    deletedAt: null,
  };
  const propMokotow = {
    id: 'prop_mokotow',
    name: 'Apartament Mokotów',
    address: 'ul. Woronicza 22/18, 02-640 Warszawa',
    kind: 'single',
    notes: 'Miejsce postojowe nr 14 w garażu podziemnym + komórka lokatorska.',
    createdAt: '2024-06-01T10:00:00Z',
    deletedAt: null,
  };
  const propLokal = {
    id: 'prop_lokal',
    name: 'Lokal usługowy „Słoneczny”',
    address: 'ul. Piotrkowska 88, 90-103 Łódź',
    kind: 'single',
    notes: 'Parter z witryną od ulicy. Osobny licznik prądu i wody.',
    createdAt: '2023-09-01T10:00:00Z',
    deletedAt: null,
  };
  state.properties.push(propKamienica, propMokotow, propLokal);

  // Units
  const uK1 = {
    id: 'unit_k1', propertyId: propKamienica.id, name: 'Mieszkanie 1 (parter)',
    area: 48, rooms: 2, floor: 'Parter',
    meterIds: { prad: 'PGE-104482', woda: 'ZW-88321', gaz: '—', cieplo: 'MPEC-221' },
    utilityContracts: {
      pradPpe: 'PL_TAUR_1208_004812_01', pradProvider: 'Tauron / PGE', pradContract: 'KL-440281 / UM-2023/114',
      wodaProvider: 'Wodociągi Krak.', wodaContract: 'UM-W/88321/2021',
      gazPpg: '', gazProvider: '', gazContract: '',
      cieploProvider: 'MPEC Kraków', cieploContract: 'OB-221-K',
      wspolnotaName: 'Zarząd Nieruchomości sp. z o.o.', wspolnotaId: 'LOK-14/1',
      otherNotes: '',
    },
    baseInventory: 'Kuchnia w zabudowie, lodówka Bosch, pralka LG, sofa rozkładana, stół + 4 krzesła, szafa w przedpokoju, 2 komplety kluczy + pilot do bramy.',
    notes: 'Po odświeżeniu ścian w 2025 r.',
    deletedAt: null,
  };
  const uK2 = {
    id: 'unit_k2', propertyId: propKamienica.id, name: 'Mieszkanie 2 (I piętro)',
    area: 62, rooms: 3, floor: 'I piętro',
    meterIds: { prad: 'PGE-104490', woda: 'ZW-88329', gaz: 'PSG-4410', cieplo: 'MPEC-222' },
    utilityContracts: {
      pradPpe: 'PL_TAUR_1208_004813_02', pradProvider: 'Tauron / PGE', pradContract: 'KL-440282 / UM-2023/115',
      wodaProvider: 'Wodociągi Krak.', wodaContract: 'UM-W/88329/2021',
      gazPpg: 'PL_PSG_004410_82', gazProvider: 'PGNiG', gazContract: 'GN-772109',
      cieploProvider: 'MPEC Kraków', cieploContract: 'OB-222-K',
      wspolnotaName: 'Zarząd Nieruchomości sp. z o.o.', wspolnotaId: 'LOK-14/2',
      otherNotes: '',
    },
    baseInventory: 'Aneks kuchenny, zmywarka, piekarnik, łóżko 160x200, biurko, regał, pralka, 2 komplety kluczy.',
    notes: 'Balkon od strony podwórza.',
    deletedAt: null,
  };
  const uK3 = {
    id: 'unit_k3', propertyId: propKamienica.id, name: 'Kawalerka 3 (poddasze)',
    area: 31, rooms: 1, floor: 'II piętro',
    meterIds: { prad: 'PGE-104511', woda: 'ZW-88340', gaz: '—', cieplo: 'MPEC-223' },
    utilityContracts: {
      pradPpe: 'PL_TAUR_1208_004814_03', pradProvider: 'Tauron / PGE', pradContract: 'KL-440283',
      wodaProvider: 'Wodociągi Krak.', wodaContract: 'UM-W/88340/2021',
      gazPpg: '', gazProvider: '', gazContract: '',
      cieploProvider: 'MPEC Kraków', cieploContract: 'OB-223-K',
      wspolnotaName: 'Zarząd Nieruchomości sp. z o.o.', wspolnotaId: 'LOK-14/3',
      otherNotes: '',
    },
    baseInventory: 'Płyta indukcyjna, mała lodówka, rozkładana kanapa, szafa PAX, stolik kawowy, pralka.',
    notes: 'Pustostan — gotowe do przekazania nowemu najemcy po drobnym malowaniu.',
    deletedAt: null,
  };
  const uMok = {
    id: 'unit_mok', propertyId: propMokotow.id, name: 'Apartament 18',
    area: 54, rooms: 2, floor: 'IV piętro',
    meterIds: { prad: 'STOEN-7741', woda: 'MPWIK-902', gaz: '—', cieplo: 'VEC-114' },
    utilityContracts: {
      pradPpe: 'PL_STOE_000018_7741', pradProvider: 'E.ON / Stoen', pradContract: 'NK-9021882',
      wodaProvider: 'MPWiK Warszawa', wodaContract: 'WM-902/18',
      gazPpg: '', gazProvider: '', gazContract: '',
      cieploProvider: 'Veolia (przez wspólnotę)', cieploContract: '—',
      wspolnotaName: 'Wspólnota Woronicza 22', wspolnotaId: '18-GAR14',
      otherNotes: 'Internet światłowodowy: nr klienta 551092',
    },
    baseInventory: 'Pełne wyposażenie AGD, TV 55", klimatyzacja, miejsce garażowe (pilot #14).',
    notes: '',
    deletedAt: null,
  };
  const uLok = {
    id: 'unit_lok', propertyId: propLokal.id, name: 'Lokal handlowo-usługowy',
    area: 72, rooms: 2, floor: 'Parter',
    meterIds: { prad: 'PGE-55192', woda: 'ZWiK-3302', gaz: '—', cieplo: 'VEC-901' },
    utilityContracts: {
      pradPpe: '590322400100551922', pradProvider: 'PGE Obrót', pradContract: 'FK/2023/55192 (klient: 10944821)',
      wodaProvider: 'ZWiK Łódź', wodaContract: 'ZW-3302/U',
      gazPpg: '', gazProvider: '', gazContract: '',
      cieploProvider: 'Veolia Łódź', cieploContract: 'VL-901',
      wspolnotaName: 'Wspólnota Piotrkowska 88', wspolnotaId: 'LU-01',
      otherNotes: '',
    },
    baseInventory: 'Witryna z roletą antywłamaniową, klimatyzator, aneks socjalny, alarm (kod zresetowany).',
    notes: '',
    deletedAt: null,
  };
  state.units.push(uK1, uK2, uK3, uMok, uLok);

  // Active & historical leases
  const k1PrevStart = addDaysISO(nowISO, -710);
  const k1PrevEnd = addDaysISO(nowISO, -345);
  const k1CurStart = addDaysISO(nowISO, -327);
  const k1CurEnd = addDaysISO(nowISO, 38); // Wygasa wkrótce!

  const leaseK1Old = {
    id: 'lease_k1_old',
    unitId: uK1.id,
    tenant: {
      name: 'Katarzyna Kowalczyk',
      phone: '+48 501 224 810',
      email: 'k.kowalczyk.demo@example.pl',
      address: 'ul. Wiosenna 8, 30-100 Kraków',
      idInfo: 'Dane przykładowe (bez prawdziwego PESEL)',
      emergencyContact: 'Tomasz Kowalczyk, +48 501 224 811',
      bankAccount: 'PL 12 1020 0000 0000 0000 0000 1234',
      notes: 'Punktualna najemczyni, lokal zdany w dobrym stanie (drobne otarcie ściany w salonie).',
    },
    startDate: k1PrevStart,
    endDate: k1PrevEnd,
    isIndefinite: false,
    noticePeriodDays: 30,
    paymentDay: 10,
    monthlyRent: 2450,
    monthlyUtilities: 690,
    useUtilitiesBreakdown: true,
    utilitiesBreakdown: { ...emptyBreakdown(), czynszAdm: 420, prad: 110, woda: 90, smieci: 35, internet: 35 },
    depositAmount: 2500,
    depositPaid: true,
    startMeters: { prad: '2190,0 kWh', woda: '112,4 m³', cieplo: '18,2 GJ' },
    endMeters: { prad: '4812,4 kWh', woda: '164,8 m³', cieplo: '29,6 GJ' },
    depositSettlement: {
      outcome: 'partial',
      returnedAmount: 2250,
      deductedAmount: 250,
      settledDate: k1PrevEnd,
      note: 'Potrącono 250 zł na punktowe zamalowanie otarcia w salonie (uzgodnione w protokole zdania).',
    },
    inventoryNote: uK1.baseInventory,
    notes: 'Poprzednia umowa — zarchiwizowana po zmianie najemcy.',
    createdAt: `${k1PrevStart}T10:00:00Z`,
    archivedAt: `${k1PrevEnd}T14:00:00Z`,
    deletedAt: null,
  };

  const leaseK1Cur = {
    id: 'lease_k1_cur',
    unitId: uK1.id,
    tenant: {
      name: 'Michał Wiśniewski',
      phone: '+48 604 331 920',
      email: 'm.wisniewski.demo@example.pl',
      address: 'ul. Szkolna 11/4, Tarnów',
      idInfo: 'Umowa najmu okazjonalnego (przykład)',
      emergencyContact: 'Anna Wiśniewska, +48 604 331 921',
      bankAccount: 'PL 44 1140 0000 0000 0000 0000 5678',
      notes: 'Pytał o możliwość przedłużenia o kolejny rok.',
    },
    startDate: k1CurStart,
    endDate: k1CurEnd,
    isIndefinite: false,
    noticePeriodDays: 30,
    paymentDay: 10,
    monthlyRent: 2700,
    monthlyUtilities: 760,
    useUtilitiesBreakdown: true,
    utilitiesBreakdown: { ...emptyBreakdown(), czynszAdm: 460, prad: 130, woda: 100, smieci: 35, internet: 35 },
    depositAmount: 3000,
    depositPaid: true,
    startMeters: { prad: '4812,4 kWh', woda: '164,8 m³', cieplo: '29,6 GJ' },
    endMeters: {},
    depositSettlement: null,
    inventoryNote: uK1.baseInventory,
    notes: 'Umowa kończy się wkrótce — zaplanować kontakt w sprawie przedłużenia lub zmiany najemcy.',
    createdAt: `${k1CurStart}T10:00:00Z`,
    archivedAt: null,
    deletedAt: null,
  };

  const leaseK2 = {
    id: 'lease_k2_cur',
    unitId: uK2.id,
    tenant: {
      name: 'Joanna i Piotr Zielińscy',
      phone: '+48 512 889 102',
      email: 'zielinscy.demo@example.pl',
      address: 'ul. Leśna 3, Wieliczka',
      idInfo: 'Dwie osoby na umowie',
      emergencyContact: 'Maria Zielińska, +48 509 110 220',
      bankAccount: 'PL 90 1050 0000 0000 0000 0000 3311',
      notes: 'Brak zwierząt, płacą zawsze 5. dnia miesiąca.',
    },
    startDate: addDaysISO(nowISO, -240),
    endDate: addDaysISO(nowISO, 155),
    isIndefinite: false,
    noticePeriodDays: 30,
    paymentDay: 5,
    monthlyRent: 3400,
    monthlyUtilities: 920,
    useUtilitiesBreakdown: true,
    utilitiesBreakdown: { ...emptyBreakdown(), czynszAdm: 560, prad: 150, woda: 110, gaz: 65, smieci: 35 },
    depositAmount: 3500,
    depositPaid: true,
    startMeters: { prad: '7120,0 kWh', woda: '204,1 m³', gaz: '1012 m³' },
    endMeters: {},
    depositSettlement: null,
    inventoryNote: uK2.baseInventory,
    notes: '',
    createdAt: `${addDaysISO(nowISO, -240)}T10:00:00Z`,
    archivedAt: null,
    deletedAt: null,
  };

  const k3End = addDaysISO(nowISO, -18);
  const leaseK3Old = {
    id: 'lease_k3_old',
    unitId: uK3.id,
    tenant: {
      name: 'Jakub Dąbrowski',
      phone: '+48 790 442 180',
      email: 'j.dabrowski.demo@example.pl',
      address: 'ul. Słoneczna 7, Rzeszów',
      idInfo: '',
      emergencyContact: '',
      bankAccount: '',
      notes: 'Student — wyprowadził się po ukończeniu studiów.',
    },
    startDate: addDaysISO(nowISO, -383),
    endDate: k3End,
    isIndefinite: false,
    noticePeriodDays: 30,
    paymentDay: 10,
    monthlyRent: 1950,
    monthlyUtilities: 480,
    useUtilitiesBreakdown: false,
    utilitiesBreakdown: emptyBreakdown(),
    depositAmount: 2000,
    depositPaid: true,
    startMeters: { prad: '1120,0 kWh', woda: '55,0 m³' },
    endMeters: { prad: '2044,5 kWh', woda: '78,2 m³' },
    depositSettlement: {
      outcome: 'returned',
      returnedAmount: 2000,
      deductedAmount: 0,
      settledDate: k3End,
      note: 'Kaucja zwrócona w całości przelewem.',
    },
    inventoryNote: uK3.baseInventory,
    notes: 'Zakończona umowa — lokal czeka na nowego najemcę.',
    createdAt: `${addDaysISO(nowISO, -383)}T10:00:00Z`,
    archivedAt: `${k3End}T12:00:00Z`,
    deletedAt: null,
  };

  const leaseMok = {
    id: 'lease_mok_cur',
    unitId: uMok.id,
    tenant: {
      name: 'Marta Lewandowska',
      phone: '+48 600 992 411',
      email: 'm.lewandowska.demo@example.pl',
      address: 'ul. Polna 12, Gdańsk',
      idInfo: '',
      emergencyContact: '',
      bankAccount: '',
      notes: 'Kontrakt korporacyjny, miejsce garażowe w cenie najmu.',
    },
    startDate: addDaysISO(nowISO, -180),
    endDate: addDaysISO(nowISO, 185),
    isIndefinite: false,
    noticePeriodDays: 60,
    paymentDay: 10,
    monthlyRent: 4100,
    monthlyUtilities: 1050,
    useUtilitiesBreakdown: true,
    utilitiesBreakdown: { ...emptyBreakdown(), czynszAdm: 760, prad: 160, woda: 90, internet: 40 },
    depositAmount: 4500,
    depositPaid: true,
    startMeters: { prad: '3310,2 kWh', woda: '88,0 m³' },
    endMeters: {},
    depositSettlement: null,
    inventoryNote: uMok.baseInventory,
    notes: '',
    createdAt: `${addDaysISO(nowISO, -180)}T10:00:00Z`,
    archivedAt: null,
    deletedAt: null,
  };

  const leaseLok = {
    id: 'lease_lok_cur',
    unitId: uLok.id,
    tenant: {
      name: 'Studio Optyczne „Klara” sp. z o.o.',
      phone: '+48 42 600 12 34',
      email: 'biuro.klara.demo@example.pl',
      address: 'ul. Piotrkowska 88, Łódź',
      idInfo: 'NIP (przykładowy): 725-000-00-00',
      emergencyContact: 'Piotr Nowak (Prezes), +48 601 234 567',
      bankAccount: '',
      notes: 'Umowa na czas nieokreślony z 3-miesięcznym wypowiedzeniem.',
    },
    startDate: addDaysISO(nowISO, -480),
    endDate: '',
    isIndefinite: true,
    noticePeriodDays: 90,
    paymentDay: 15,
    monthlyRent: 4800,
    monthlyUtilities: 1240,
    useUtilitiesBreakdown: true,
    utilitiesBreakdown: { ...emptyBreakdown(), czynszAdm: 490, prad: 390, woda: 80, ogrzewanie: 210, smieci: 70 },
    depositAmount: 6000,
    depositPaid: true,
    startMeters: { prad: '14220 kWh', woda: '310 m³' },
    endMeters: {},
    depositSettlement: null,
    inventoryNote: uLok.baseInventory,
    notes: 'Waloryzacja coroczna o wskaźnik GUS w styczniu.',
    createdAt: `${addDaysISO(nowISO, -480)}T10:00:00Z`,
    archivedAt: null,
    deletedAt: null,
  };

  state.leases.push(leaseK1Old, leaseK1Cur, leaseK2, leaseK3Old, leaseMok, leaseLok);

  // Generate 10 months of historical + current month payments
  const addPay = (lease, monthOffset, status = 'paid', utilDelta = 0, note = '') => {
    const mk = addMonthsToKey(curMonth, monthOffset);
    const bd = { ...emptyBreakdown(), ...(lease.utilitiesBreakdown || {}) };
    if (lease.useUtilitiesBreakdown && utilDelta !== 0) {
      bd.prad = Math.max(0, (bd.prad || 0) + utilDelta);
    }
    const baseUtil = lease.useUtilitiesBreakdown
      ? Object.values(bd).reduce((a, b) => a + (Number(b) || 0), 0)
      : lease.monthlyUtilities + utilDelta;
    state.payments.push({
      id: `pay_${lease.id}_${mk}`,
      unitId: lease.unitId,
      leaseId: lease.id,
      month: mk,
      rentAmount: lease.monthlyRent,
      utilitiesAmount: Math.round(baseUtil * 100) / 100,
      useBreakdown: !!lease.useUtilitiesBreakdown,
      utilitiesBreakdown: bd,
      status,
      paidDate: status === 'paid' ? `${mk}-${String(lease.paymentDay || 10).padStart(2, '0')}` : '',
      note,
      createdAt: `${mk}-02T09:00:00Z`,
      deletedAt: null,
    });
  };

  // M1 old tenant (11..10 months ago) + new tenant (-9..0)
  addPay(leaseK1Old, -11, 'paid', 20, 'Rozliczenie zimowe');
  addPay(leaseK1Old, -10, 'paid', -15, 'Ostatni miesiąc poprz. umowy');
  for (let i = -9; i <= 0; i++) {
    addPay(leaseK1Cur, i, i === 0 ? 'pending' : 'paid', i % 3 === 0 ? 35 : 0, i === 0 ? 'Oczekuje na przelew' : '');
  }
  // M2 active (latest month split between two roommates: Joanna paid 1/2, Piotr pending)
  for (let i = -7; i <= -1; i++) {
    addPay(leaseK2, i, 'paid', i === -1 ? 45 : 0);
  }
  state.payments.push({
    id: `pay_${leaseK2.id}_${curMonth}`,
    unitId: leaseK2.unitId,
    leaseId: leaseK2.id,
    month: curMonth,
    rentAmount: leaseK2.monthlyRent,
    utilitiesAmount: leaseK2.monthlyUtilities,
    useBreakdown: true,
    utilitiesBreakdown: { ...emptyBreakdown(), ...leaseK2.utilitiesBreakdown },
    status: 'partial',
    installments: [
      { id: 'inst_k2_1', amount: 2160, date: `${curMonth}-05`, payer: 'Joanna Zielińska', note: '1/2 przelewu' },
    ],
    paidDate: '',
    note: 'Wpłata w 2 częściach (czekamy na drugą połowę od Piotra)',
    createdAt: `${curMonth}-02T09:00:00Z`,
    deletedAt: null,
  });
  // M3 archived last month
  for (let i = -9; i <= -1; i++) {
    addPay(leaseK3Old, i, 'paid', 0, i === -1 ? 'Ostatni miesiąc przed zdaniem' : '');
  }
  // Mokotow
  for (let i = -5; i <= 0; i++) {
    addPay(leaseMok, i, 'paid', i === -2 ? 60 : 0);
  }
  // Lokal usługowy
  for (let i = -11; i <= 0; i++) {
    addPay(leaseLok, i, i === 0 ? 'pending' : 'paid', i % 2 === 0 ? 80 : -20);
  }

  // Generate crisp sample photos (including Before & After pair for M1 old lease!)
  const makePhoto = async (id, unitId, leaseId, stage, room, takenAt, note, variant) => {
    const stageLabel = stage === 'start' ? 'Wydanie' : stage === 'end' ? 'Zdanie' : 'W trakcie';
    const { mainBlob, thumbBlob } = await renderSampleRoomPhoto(room, stageLabel, takenAt, variant);
    const blobKey = `blob_${id}`;
    const thumbKey = `thumb_${id}`;
    await putBlob(blobKey, mainBlob);
    await putBlob(thumbKey, thumbBlob);
    state.photos.push({
      id, unitId, leaseId, stage, room, takenAt, note,
      fileName: `${room.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${stage}.jpg`,
      mimeType: 'image/jpeg',
      blobKey, thumbKey, size: mainBlob.size,
      createdAt: `${takenAt}T10:00:00Z`,
      deletedAt: null,
    });
  };

  await makePhoto('ph_1', uK1.id, leaseK1Old.id, 'start', 'Salon / Pokój', k1PrevStart, 'Ściany świeżo malowane, brak rys.', 'start');
  await makePhoto('ph_2', uK1.id, leaseK1Old.id, 'end', 'Salon / Pokój', k1PrevEnd, 'Niewielkie otarcie ściany obok ramy — potrącono 250 zł.', 'end');
  await makePhoto('ph_3', uK1.id, leaseK1Old.id, 'start', 'Liczniki', k1PrevStart, 'Licznik prądu na start: 2190,0 kWh', 'start');
  await makePhoto('ph_4', uK1.id, leaseK1Old.id, 'end', 'Liczniki', k1PrevEnd, 'Licznik prądu na koniec: 4812,4 kWh', 'end');
  await makePhoto('ph_5', uK1.id, leaseK1Cur.id, 'start', 'Salon / Pokój', k1CurStart, 'Po odświeżeniu ściany — stan idealny.', 'start');
  await makePhoto('ph_6', uK1.id, leaseK1Cur.id, 'start', 'Kuchnia', k1CurStart, 'Zabudowa kuchenna i blat bez uszkodzeń.', 'start');
  await makePhoto('ph_7', uK1.id, leaseK1Cur.id, 'end', 'Kuchnia', addDaysISO(nowISO, -2), 'Podgląd próbny do porównania przed/po.', 'end');
  await makePhoto('ph_8', uMok.id, leaseMok.id, 'start', 'Salon / Pokój', leaseMok.startDate, 'Stan przy wydaniu apartamentu.', 'start');

  // Generate sample PDF documents (real valid PDF 1.4!)
  const addPdfDoc = async (id, unitId, leaseId, category, title, fileName, lines, signedDate) => {
    const bytes = buildSimplePdfBytes(title, `Dokument przykładowy • ${signedDate}`, lines);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const blobKey = `doc_${id}`;
    await putBlob(blobKey, blob);
    state.documents.push({
      id, unitId, leaseId, category, title, fileName,
      mimeType: 'application/pdf', blobKey, size: blob.size,
      signedDate, note: 'Plik przykładowy — możesz podmienić na własny skan PDF.',
      createdAt: `${signedDate}T11:00:00Z`,
      deletedAt: null,
    });
  };

  await addPdfDoc('d1', uK1.id, leaseK1Cur.id, 'umowa', 'Umowa najmu M1 — Michał Wiśniewski', 'umowa_m1_wisniewski.pdf', [
    '## Dane stron (przyklad)',
    'Wynajmujacy: Wlasciciel prywatny',
    'Najemca: Michal Wisniewski, tel. +48 604 331 920',
    '---',
    '## Przedmiot najmu',
    'Lokal mieszkalny nr 1, ul. Dluga 14, Krakow (48 m2, 2 pokoje).',
    `Okres trwania: od ${leaseK1Cur.startDate} do ${leaseK1Cur.endDate}`,
    '---',
    '## Warunki finansowe',
    'Czynsz najmu (odstepne): 2 700,00 PLN / miesiac',
    'Zaliczka na media i oplaty adm.: 760,00 PLN / miesiac',
    'Kaucja zwrotna: 3 000,00 PLN (wplacona)',
    'Termin platnosci: do 10. dnia kazdego miesiaca.',
  ], k1CurStart);

  await addPdfDoc('d2', uK1.id, leaseK1Cur.id, 'protokol_wydania', 'Protokół zdawczo-odbiorczy wydania M1', 'protokol_wydania_m1.pdf', [
    '## Stany licznikow w dniu wydania',
    'Energia elektryczna (PGE-104482): 4812,4 kWh',
    'Woda (ZW-88321): 164,8 m3',
    'Cieplo (MPEC-221): 29,6 GJ',
    '---',
    '## Klucze',
    'Przekazano 2 komplety kluczy oraz 1 pilot do bramy.',
    'Uwagi: Sciany po malowaniu, brak uszkodzen.',
  ], k1CurStart);

  await addPdfDoc('d3', uK1.id, leaseK1Old.id, 'protokol_zdania', 'Protokół zdania M1 — Katarzyna Kowalczyk', 'protokol_zdania_m1_kowalczyk.pdf', [
    '## Zdanie lokalu i rozliczenie kaucji',
    'Stany licznikow: prad 4812,4 kWh | woda 164,8 m3 | cieplo 29,6 GJ',
    'Kaucja wplacona: 2 500,00 PLN',
    'Potracenie: 250,00 PLN (punktowe malowanie sciany w salonie)',
    'Do zwrotu najemcy: 2 250,00 PLN',
  ], k1PrevEnd);

  // Blank templates (in blanco)
  const addTpl = async (id, category, title, fileName, desc, lines) => {
    const bytes = buildSimplePdfBytes(title, 'SZABLON IN BLANCO — do pobrania i druku', lines);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const blobKey = `tpl_${id}`;
    await putBlob(blobKey, blob);
    state.templates.push({
      id, category, title, fileName, description: desc,
      mimeType: 'application/pdf', blobKey, size: blob.size,
      updatedAt: nowISO,
      deletedAt: null,
    });
  };

  await addTpl('t1', 'umowa', 'Umowa najmu lokalu mieszkalnego (wzór)', 'wzor_umowa_najmu_in_blanco.pdf',
    'Przykładowy pusty wzór umowy — podmień na własny plik PDF lub DOCX.', [
      'Miejscowosc i data: __________________________',
      '---',
      '## 1. Strony umowy',
      'Wynajmujacy: ______________________________________________',
      'Najemca: __________________________________________________',
      'PESEL / Nr dokumentu: _____________________________________',
      'Tel. / E-mail: ____________________________________________',
      '---',
      '## 2. Przedmiot najmu i okres',
      'Adres lokalu: _____________________________________________',
      'Okres od: ____-__-__  do: ____-__-__ (lub nieokreslony)',
      '---',
      '## 3. Czynsz i media',
      'Czynsz najmu (odstepne): _____________ PLN / miesiac',
      'Zaliczka na media/oplaty: ____________ PLN / miesiac',
      'Kaucja zwrotna: ______________________ PLN',
      '---',
      'Podpis Wynajmujacego: __________   Podpis Najemcy: __________',
    ]);

  await addTpl('t2', 'protokol_zdawczy', 'Protokół zdawczo-odbiorczy (wzór)', 'wzor_protokol_zdawczo_odbiorczy.pdf',
    'Przykładowy protokół z polami na liczniki, klucze i uwagi o stanie.', [
      'Typ: [ ] Wydanie lokalu   [ ] Zdanie lokalu   Data: ________',
      'Adres lokalu: _____________________________________________',
      '---',
      '## Odczyty licznikow',
      'Prad (kWh): nr _________________ stan: ____________________',
      'Woda zimna (m3): nr ____________ stan: ____________________',
      'Woda ciepla (m3): nr ___________ stan: ____________________',
      'Gaz (m3): nr ___________________ stan: ____________________',
      'Cieplo (GJ): nr ________________ stan: ____________________',
      '---',
      '## Przekazane klucze i dostep',
      'Klucze do mieszkania: ___ szt.   Brama / klatka: ___ szt.',
      '---',
      '## Uwagi o stanie lokalu / zalaczone zdjecia',
      '___________________________________________________________',
      '___________________________________________________________',
      '---',
      'Podpis Wynajmujacego: __________   Podpis Najemcy: __________',
    ]);

  await addTpl('t3', 'protokol_wyposazenia', 'Protokół zawartości / wyposażenia (wzór)', 'wzor_protokol_wyposazenia.pdf',
    'Przykładowy spis mebli, AGD i wyposażenia z podziałem na pomieszczenia.', [
      'Adres lokalu: ___________________________  Data: __________',
      '---',
      '## Wykaz wyposazenia',
      'Lp. | Pomieszczenie | Przedmiot / model | Ilosc | Stan / uwagi',
      '1.  | Kuchnia       | _________________ | _____ | ___________',
      '2.  | Kuchnia       | _________________ | _____ | ___________',
      '3.  | Salon         | _________________ | _____ | ___________',
      '4.  | Salon         | _________________ | _____ | ___________',
      '5.  | Lazienka      | _________________ | _____ | ___________',
      '6.  | Przedpokoj    | _________________ | _____ | ___________',
      '---',
      'Podpis Wynajmujacego: __________   Podpis Najemcy: __________',
    ]);

  state.auditLog.push({
    id: 'log_init',
    at: new Date().toISOString(),
    action: 'Załadowano dane przykładowe',
    details: '3 nieruchomości (1 kamienica + 2 pojedyncze lokale), szablony i przykładowe zdjęcia.',
  });

  return state;
}
