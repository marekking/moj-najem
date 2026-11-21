// Forms, viewers, PIN keypad, photo Before/After slider, and the 4-step Tenant Turnover wizard.
import {
  DEFAULT_ROOMS,
  DOC_CATEGORIES,
  PHOTO_STAGES,
  TEMPLATE_CATEGORIES,
  UTILITY_KEYS,
  addMonthsToKey,
  appendAudit,
  applyTransferWithOverpayment,
  buildPaymentFromLease,
  calculateProRata,
  computeMeterDelta,
  currentMonthKey,
  daysInMonthKey,
  emptyBreakdown,
  exportPaymentsCsv,
  formatBytes,
  formatDatePL,
  formatMonthPL,
  formatMonthShort,
  formatPLN,
  generateLeasePayments,
  getEffectiveMediaAmount,
  getPaymentBalance,
  hasNonZeroBreakdown,
  hashPin,
  performTenantTurnover,
  roundMoney,
  sumBreakdown,
  syncPaymentStatusFromInstallments,
  todayISO,
  uid,
} from './domain.js';
import { getBlob, inspectBackupZip, putBlob, restoreBackupZip } from './db.js';
import { clearUrlCache, getBlobUrl, processPhotoFile, shareOrDownloadBlob } from './media.js';
import { closeModal, esc, hydrateImages, icon, openModal, showToast } from './ui_helpers.js';

function readBreakdownInputs(root, prefix = 'bd_') {
  const obj = emptyBreakdown();
  for (const { key } of UTILITY_KEYS) {
    const el = root.querySelector(`[name="${prefix}${key}"]`);
    obj[key] = roundMoney(el ? el.value : 0);
  }
  return obj;
}

function renderBreakdownFields(values = {}, prefix = 'bd_') {
  return `
    <div class="form-grid cols-2" style="margin-top:8px">
      ${UTILITY_KEYS.map(({ key, label }) => `
        <div class="field">
          <label>${esc(label)} (zł)</label>
          <input type="number" step="0.01" min="0" name="${prefix}${key}" value="${values[key] || ''}" placeholder="0" inputmode="decimal" />
        </div>
      `).join('')}
    </div>`;
}

export function openConfirmModal({ title, message, confirmLabel = 'Potwierdź', danger = false, diffRows = null, onConfirm }) {
  const diffHtml = diffRows && diffRows.length ? `
    <div class="diff-box">
      ${diffRows.map((r) => `
        <div class="diff-row">
          <span class="muted">${esc(r.label)}</span>
          <span><span class="diff-old">${esc(r.oldVal)}</span> → <span class="diff-new">${esc(r.newVal)}</span></span>
        </div>
      `).join('')}
    </div>` : '';

  openModal({
    title,
    bodyHtml: `
      <p style="margin:0;font-size:14px">${esc(message)}</p>
      ${diffHtml}
    `,
    footerHtml: `
      <button type="button" class="btn" id="cfmCancel">Anuluj</button>
      <button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" id="cfmOk">${esc(confirmLabel)}</button>
    `,
    onMount: () => {
      document.getElementById('cfmCancel').addEventListener('click', closeModal);
      document.getElementById('cfmOk').addEventListener('click', async () => {
        closeModal();
        await onConfirm();
      });
    },
  });
}

export function openUnlockModal({ state, onUnlocked }) {
  const hasPin = !!state.settings?.pinHash;
  if (!hasPin) {
    openModal({
      title: 'Odblokować tryb edycji?',
      bodyHtml: `
        <p style="margin:0;font-size:14px">Aplikacja otwiera się domyślnie w trybie <strong>tylko do podglądu</strong>, aby uniknąć przypadkowych zmian kwot, dat lub dokumentów.</p>
        <p class="muted text-sm" style="margin:0">Po włączeniu edycja zablokuje się automatycznie po <strong>${state.settings.autoLockMinutes || 5} min</strong> bezczynności (lub po kliknięciu kłódki). W zakładce <em>Więcej</em> możesz dodatkowo ustawić 4-cyfrowy PIN.</p>
      `,
      footerHtml: `
        <button type="button" class="btn" id="ulCancel">Pozostań w podglądzie</button>
        <button type="button" class="btn btn-primary" id="ulOk">${icon('unlock', 15)} Odblokuj edycję</button>
      `,
      onMount: () => {
        document.getElementById('ulCancel').addEventListener('click', closeModal);
        document.getElementById('ulOk').addEventListener('click', () => {
          closeModal();
          onUnlocked();
        });
      },
    });
    return;
  }

  let entered = '';
  const updateDots = () => {
    const dots = document.querySelectorAll('#pinDots .pin-dot');
    dots.forEach((d, i) => d.classList.toggle('filled', i < entered.length));
  };

  openModal({
    title: 'Podaj 4-cyfrowy PIN',
    bodyHtml: `
      <p class="muted text-sm" style="text-align:center;margin:0">Wprowadź PIN, aby odblokować edycję danych.</p>
      <div class="pin-display" id="pinDots">
        <span class="pin-dot"></span><span class="pin-dot"></span><span class="pin-dot"></span><span class="pin-dot"></span>
      </div>
      <div id="pinErr" class="text-danger text-sm" style="text-align:center;min-height:18px"></div>
      <div class="pin-pad" id="pinPad">
        ${['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k) =>
          k === '' ? '<span></span>' : `<button type="button" class="pin-key" data-key="${k}">${k}</button>`
        ).join('')}
      </div>
    `,
    footerHtml: '<button type="button" class="btn" id="pinCancel">Anuluj</button>',
    onMount: () => {
      document.getElementById('pinCancel').addEventListener('click', closeModal);
      const tryVerify = async () => {
        const res = await hashPin(entered, state.settings.pinSalt);
        if (res.hash === state.settings.pinHash) {
          closeModal();
          onUnlocked();
        } else {
          document.getElementById('pinErr').textContent = 'Nieprawidłowy PIN. Spróbuj ponownie.';
          entered = '';
          updateDots();
        }
      };
      document.getElementById('pinPad').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-key]');
        if (!btn) return;
        const k = btn.dataset.key;
        document.getElementById('pinErr').textContent = '';
        if (k === '⌫') {
          entered = entered.slice(0, -1);
          updateDots();
          return;
        }
        if (entered.length < 4) {
          entered += k;
          updateDots();
          if (entered.length === 4) void tryVerify();
        }
      });
    },
  });
}

export function openSetPinModal({ state, saveAndRender }) {
  openModal({
    title: state.settings.pinHash ? 'Zmień lub usuń PIN edycji' : 'Ustaw 4-cyfrowy PIN edycji',
    bodyHtml: `
      <form id="pinForm" class="stack-md">
        <p class="muted text-sm" style="margin:0">PIN chroni przycisk odblokowania edycji (nie jest wysyłany w sieć — zapisywany jest tylko lokalny skrót SHA-256).</p>
        <div class="field">
          <label>Nowy PIN (4 cyfry)</label>
          <input type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" name="pin1" placeholder="np. 1234" required />
        </div>
        <div class="field">
          <label>Powtórz PIN</label>
          <input type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" name="pin2" placeholder="Powtórz 4 cyfry" required />
        </div>
        <div id="pinFormErr" class="text-danger text-sm"></div>
      </form>
    `,
    footerHtml: `
      ${state.settings.pinHash ? '<button type="button" class="btn btn-danger" id="pinClear">Usuń PIN</button>' : ''}
      <button type="button" class="btn" id="pinClose">Anuluj</button>
      <button type="button" class="btn btn-primary" id="pinSave">Zapisz PIN</button>
    `,
    onMount: () => {
      document.getElementById('pinClose').addEventListener('click', closeModal);
      const clearBtn = document.getElementById('pinClear');
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          state.settings.pinHash = null;
          state.settings.pinSalt = null;
          appendAudit(state, 'Usunięto PIN edycji', 'Blokada pozostała jako potwierdzenie jednym kliknięciem.');
          await saveAndRender();
          closeModal();
          showToast('PIN został usunięty.');
        });
      }
      document.getElementById('pinSave').addEventListener('click', async () => {
        const f = document.getElementById('pinForm');
        const p1 = f.pin1.value.trim();
        const p2 = f.pin2.value.trim();
        const err = document.getElementById('pinFormErr');
        if (!/^\d{4}$/.test(p1)) { err.textContent = 'PIN musi składać się dokładnie z 4 cyfr.'; return; }
        if (p1 !== p2) { err.textContent = 'Podane kody PIN nie są identyczne.'; return; }
        const { hash, salt } = await hashPin(p1);
        state.settings.pinHash = hash;
        state.settings.pinSalt = salt;
        appendAudit(state, 'Ustawiono PIN edycji', 'Zabezpieczono odblokowanie edycji 4-cyfrowym PIN-em.');
        await saveAndRender();
        closeModal();
        showToast('PIN zapisany.');
      });
    },
  });
}

export function openPropertyModal({ state, existing = null, saveAndRender, onCreated }) {
  const isEdit = !!existing;
  openModal({
    title: isEdit ? 'Edytuj nieruchomość' : 'Nowa nieruchomość',
    bodyHtml: `
      <form id="propForm" class="stack-md">
        <div class="field">
          <label>Nazwa własna *</label>
          <input name="name" value="${esc(existing?.name || '')}" placeholder="np. Kamienica przy ul. Długiej / Mieszkanie Mokotów" required />
        </div>
        <div class="field">
          <label>Adres *</label>
          <input name="address" value="${esc(existing?.address || '')}" placeholder="ul. Przykładowa 12, 00-001 Miasto" required />
        </div>
        ${!isEdit ? `
        <div class="field">
          <label>Rodzaj nieruchomości</label>
          <select name="kind" id="propKind">
            <option value="single">Pojedyncza lokalizacja (1 mieszkanie / dom / lokal)</option>
            <option value="building">Kamienica / budynek wielolokalowy (wiele mieszkań)</option>
          </select>
          <span class="field-hint">W każdym momencie możesz zamienić pojedynczy adres na budynek z wieloma lokalami.</span>
        </div>
        <div id="singleAreaWrap" class="form-grid cols-2">
          <div class="field"><label>Metraż (m²)</label><input type="number" step="0.1" min="0" name="area" placeholder="np. 48" /></div>
          <div class="field"><label>Liczba pokoi</label><input type="number" min="1" name="rooms" placeholder="np. 2" /></div>
        </div>
        <div id="buildingCountWrap" class="hidden field">
          <label>Ile lokali utworzyć na start?</label>
          <input type="number" min="1" max="40" name="unitCount" value="3" />
          <span class="field-hint">Kolejne mieszkania możesz dodać lub zmienić później.</span>
        </div>` : `
        <div class="field">
          <label>Rodzaj nieruchomości</label>
          <select name="kind">
            <option value="single" ${existing.kind === 'single' ? 'selected' : ''}>Pojedyncza lokalizacja</option>
            <option value="building" ${existing.kind === 'building' ? 'selected' : ''}>Kamienica / budynek wielolokalowy</option>
          </select>
        </div>`}
        <div class="field">
          <label>Notatki (np. zarządca, ogrzewanie, garaż)</label>
          <textarea name="notes" placeholder="Opcjonalne uwagi o budynku…">${esc(existing?.notes || '')}</textarea>
        </div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn" id="pfCancel">Anuluj</button>
      <button type="button" class="btn btn-primary" id="pfSave">${isEdit ? 'Zapisz zmiany' : 'Dodaj nieruchomość'}</button>
    `,
    onMount: () => {
      document.getElementById('pfCancel').addEventListener('click', closeModal);
      const kindSel = document.getElementById('propKind');
      if (kindSel) {
        kindSel.addEventListener('change', () => {
          const isB = kindSel.value === 'building';
          document.getElementById('singleAreaWrap').classList.toggle('hidden', isB);
          document.getElementById('buildingCountWrap').classList.toggle('hidden', !isB);
        });
      }
      document.getElementById('pfSave').addEventListener('click', async () => {
        const f = document.getElementById('propForm');
        const name = f.name.value.trim();
        const address = f.address.value.trim();
        if (!name || !address) { showToast('Wpisz nazwę i adres nieruchomości.'); return; }
        if (isEdit) {
          existing.name = name;
          existing.address = address;
          existing.kind = f.kind.value;
          existing.notes = f.notes.value.trim();
          appendAudit(state, 'Edycja nieruchomości', `${name} (${address})`);
          await saveAndRender();
          closeModal();
          showToast('Zapisano nieruchomość.');
        } else {
          const kind = f.kind.value;
          const prop = {
            id: uid('prop'),
            name,
            address,
            kind,
            notes: f.notes.value.trim(),
            createdAt: new Date().toISOString(),
            deletedAt: null,
          };
          state.properties.push(prop);
          const createdUnits = [];
          if (kind === 'single') {
            const u = {
              id: uid('unit'),
              propertyId: prop.id,
              name: name,
              area: Number(f.area.value) || null,
              rooms: Number(f.rooms.value) || null,
              floor: '',
              meterIds: {},
              baseInventory: '',
              notes: '',
              deletedAt: null,
            };
            state.units.push(u);
            createdUnits.push(u);
          } else {
            const count = Math.max(1, Math.min(40, Number(f.unitCount.value) || 1));
            for (let i = 1; i <= count; i++) {
              const u = {
                id: uid('unit'),
                propertyId: prop.id,
                name: `Mieszkanie ${i}`,
                area: null, rooms: null, floor: '',
                meterIds: {}, baseInventory: '', notes: '',
                deletedAt: null,
              };
              state.units.push(u);
              createdUnits.push(u);
            }
          }
          appendAudit(state, 'Dodano nieruchomość', `${name} (${kind === 'building' ? `${createdUnits.length} lok.` : 'pojedyncza'})`);
          await saveAndRender();
          closeModal();
          showToast('Dodano nieruchomość.');
          if (onCreated) onCreated(prop, createdUnits[0]);
        }
      });
    },
  });
}

export function openUnitModal({ state, property, existing = null, saveAndRender }) {
  const isEdit = !!existing;
  const uc = existing?.utilityContracts || {};
  openModal({
    title: isEdit ? 'Edytuj lokal / mieszkanie' : `Dodaj lokal w: ${property.name}`,
    wide: true,
    bodyHtml: `
      <form id="unitForm" class="stack-md">
        <div class="field">
          <label>Nazwa / numer lokalu *</label>
          <input name="name" value="${esc(existing?.name || '')}" placeholder="np. Mieszkanie 4 (II piętro)" required />
        </div>
        <div class="form-grid cols-3">
          <div class="field"><label>Metraż (m²)</label><input type="number" step="0.1" name="area" value="${esc(existing?.area ?? '')}" /></div>
          <div class="field"><label>Pokoje</label><input type="number" name="rooms" value="${esc(existing?.rooms ?? '')}" /></div>
          <div class="field"><label>Piętro</label><input name="floor" value="${esc(existing?.floor || '')}" placeholder="np. II" /></div>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:2px 0">
        <div class="section-title" style="font-size:13.5px">Prąd (PPE, dostawca i umowa)</div>
        <div class="form-grid cols-2">
          <div class="field"><label>Nr PPE (Punkt Poboru Energii)</label><input name="pradPpe" value="${esc(uc.pradPpe || '')}" placeholder="np. 5903224... lub PL_TAUR_..." /></div>
          <div class="field"><label>Nr licznika prądu</label><input name="mPrad" value="${esc(existing?.meterIds?.prad || '')}" placeholder="np. PGE-104482" /></div>
          <div class="field"><label>Dostawca prądu</label><input name="pradProvider" value="${esc(uc.pradProvider || '')}" placeholder="np. PGE / Tauron / Enea / E.ON" /></div>
          <div class="field"><label>Nr klienta / umowy (prąd)</label><input name="pradContract" value="${esc(uc.pradContract || '')}" placeholder="np. nr klienta / nr umowy" /></div>
        </div>
        <div class="section-title" style="font-size:13.5px">Woda, gaz, ciepło i wspólnota</div>
        <div class="form-grid cols-3">
          <div class="field"><label>Nr licznika wody</label><input name="mWoda" value="${esc(existing?.meterIds?.woda || '')}" /></div>
          <div class="field"><label>Dostawca wody</label><input name="wodaProvider" value="${esc(uc.wodaProvider || '')}" placeholder="np. MPWiK / ZWiK" /></div>
          <div class="field"><label>Nr umowy / klienta (woda)</label><input name="wodaContract" value="${esc(uc.wodaContract || '')}" /></div>
        </div>
        <div class="section-title" style="font-size:13.5px">Gaz (nr gazomierza, PPG i umowa)</div>
        <div class="form-grid cols-2">
          <div class="field"><label>Nr gazomierza (licznika gazu)</label><input name="mGaz" value="${esc(existing?.meterIds?.gaz || '')}" placeholder="np. PSG-4410" /></div>
          <div class="field"><label>Nr PPG (punkt poboru gazu)</label><input name="gazPpg" value="${esc(uc.gazPpg || '')}" placeholder="np. PL_PSG_..." /></div>
          <div class="field"><label>Dostawca gazu</label><input name="gazProvider" value="${esc(uc.gazProvider || '')}" placeholder="np. PGNiG / Orlen" /></div>
          <div class="field"><label>Nr umowy / klienta (gaz)</label><input name="gazContract" value="${esc(uc.gazContract || '')}" placeholder="np. nr umowy / nr klienta" /></div>
        </div>
        <div class="section-title" style="font-size:13.5px">Ciepło i wspólnota</div>
        <div class="form-grid cols-3">
          <div class="field"><label>Nr ciepłomierza</label><input name="mCieplo" value="${esc(existing?.meterIds?.cieplo || '')}" /></div>
          <div class="field"><label>Dostawca ciepła</label><input name="cieploProvider" value="${esc(uc.cieploProvider || '')}" placeholder="np. MPEC / Veolia" /></div>
          <div class="field"><label>Nr umowy / odbiorcy (ciepło)</label><input name="cieploContract" value="${esc(uc.cieploContract || '')}" /></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Wspólnota / zarządca</label><input name="wspolnotaName" value="${esc(uc.wspolnotaName || '')}" placeholder="nazwa lub tel." /></div>
          <div class="field"><label>Nr lokalu / ID klienta (wspólnota)</label><input name="wspolnotaId" value="${esc(uc.wspolnotaId || '')}" /></div>
        </div>
        <div class="field"><label>Inne umowy / numery (np. internet, śmieci)</label><input name="otherNotes" value="${esc(uc.otherNotes || '')}" placeholder="opcjonalnie…" /></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:2px 0">
        <div class="field">
          <label>Stałe wyposażenie lokalu (baza do protokołu zawartości)</label>
          <textarea name="baseInventory" placeholder="np. lodówka, pralka, sofa, stół + 4 krzesła, 2 komplety kluczy…">${esc(existing?.baseInventory || '')}</textarea>
        </div>
        <div class="field">
          <label>Notatki</label>
          <textarea name="notes">${esc(existing?.notes || '')}</textarea>
        </div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn" id="ufCancel">Anuluj</button>
      <button type="button" class="btn btn-primary" id="ufSave">${isEdit ? 'Zapisz zmiany' : 'Dodaj lokal'}</button>
    `,
    onMount: () => {
      document.getElementById('ufCancel').addEventListener('click', closeModal);
      document.getElementById('ufSave').addEventListener('click', async () => {
        const f = document.getElementById('unitForm');
        const name = f.name.value.trim();
        if (!name) { showToast('Podaj nazwę lokalu.'); return; }
        const meterIds = {
          prad: f.mPrad.value.trim(),
          woda: f.mWoda.value.trim(),
          gaz: f.mGaz.value.trim(),
          cieplo: f.mCieplo.value.trim(),
        };
        const utilityContracts = {
          pradPpe: f.pradPpe.value.trim(),
          pradProvider: f.pradProvider.value.trim(),
          pradContract: f.pradContract.value.trim(),
          wodaProvider: f.wodaProvider.value.trim(),
          wodaContract: f.wodaContract.value.trim(),
          gazPpg: f.gazPpg.value.trim(),
          gazProvider: f.gazProvider.value.trim(),
          gazContract: f.gazContract.value.trim(),
          cieploProvider: f.cieploProvider.value.trim(),
          cieploContract: f.cieploContract.value.trim(),
          wspolnotaName: f.wspolnotaName.value.trim(),
          wspolnotaId: f.wspolnotaId.value.trim(),
          otherNotes: f.otherNotes.value.trim(),
        };
        if (isEdit) {
          existing.name = name;
          existing.area = f.area.value ? Number(f.area.value) : null;
          existing.rooms = f.rooms.value ? Number(f.rooms.value) : null;
          existing.floor = f.floor.value.trim();
          existing.meterIds = meterIds;
          existing.utilityContracts = utilityContracts;
          existing.baseInventory = f.baseInventory.value.trim();
          existing.notes = f.notes.value.trim();
          appendAudit(state, 'Edycja lokalu', `${property.name} / ${name}`);
        } else {
          if (property.kind === 'single') property.kind = 'building';
          state.units.push({
            id: uid('unit'),
            propertyId: property.id,
            name,
            area: f.area.value ? Number(f.area.value) : null,
            rooms: f.rooms.value ? Number(f.rooms.value) : null,
            floor: f.floor.value.trim(),
            meterIds,
            utilityContracts,
            baseInventory: f.baseInventory.value.trim(),
            notes: f.notes.value.trim(),
            deletedAt: null,
          });
          appendAudit(state, 'Dodano lokal', `${property.name} / ${name}`);
        }
        await saveAndRender();
        closeModal();
        showToast(isEdit ? 'Zapisano lokal.' : 'Dodano nowy lokal.');
      });
    },
  });
}

export function openLeaseModal({ state, unit, property, existing = null, isArchivedCreate = false, saveAndRender }) {
  const isEdit = !!existing;
  const t = existing?.tenant || {};
  const bd = existing?.utilitiesBreakdown || emptyBreakdown();
  const useBd = !!existing?.useUtilitiesBreakdown;

  openModal({
    title: isEdit
      ? 'Edytuj umowę i najemcę'
      : isArchivedCreate
        ? `Dodaj archiwalną umowę wstecz — ${unit.name}`
        : `Nowa umowa najmu — ${unit.name}`,
    wide: true,
    bodyHtml: `
      <form id="leaseForm" class="stack-md">
        <div class="section-title" style="font-size:14px">1. Dane kontaktowe najemcy</div>
        <div class="form-grid cols-2">
          <div class="field"><label>Imię i nazwisko / firma *</label><input name="tName" value="${esc(t.name || '')}" required placeholder="np. Jan Kowalski" /></div>
          <div class="field"><label>Telefon</label><input name="tPhone" type="tel" value="${esc(t.phone || '')}" placeholder="+48 600 000 000" /></div>
          <div class="field"><label>E-mail</label><input name="tEmail" type="email" value="${esc(t.email || '')}" placeholder="najemca@email.pl" /></div>
          <div class="field"><label>Kontakt alarmowy / współnajemca</label><input name="tEmerg" value="${esc(t.emergencyContact || '')}" placeholder="np. imię, tel." /></div>
          <div class="field"><label>Adres korespondencyjny</label><input name="tAddr" value="${esc(t.address || '')}" /></div>
          <div class="field"><label>Nr rachunku do zwrotu kaucji</label><input name="tBank" value="${esc(t.bankAccount || '')}" placeholder="PL ..." /></div>
        </div>
        <div class="field"><label>Uwagi o najemcy / dokument tożsamości (opcjonalnie)</label><input name="tId" value="${esc(t.idInfo || '')}" placeholder="np. nr dowodu, NIP, tryb umowy okazjonalnej" /></div>
        <div class="field"><label>Notatki kontaktowe</label><textarea name="tNotes">${esc(t.notes || '')}</textarea></div>

        <hr style="border:none;border-top:1px solid var(--border);margin:2px 0">
        <div class="section-title" style="font-size:14px">2. Daty najmu</div>
        <div class="form-grid cols-2">
          <div class="field"><label>Data rozpoczęcia *</label><input type="date" name="startDate" value="${esc(existing?.startDate || todayISO())}" required /></div>
          <div class="field" id="lfEndWrap"><label>Data zakończenia</label><input type="date" name="endDate" value="${esc(existing?.endDate || '')}" /></div>
        </div>
        <label class="field-check"><input type="checkbox" name="isIndefinite" id="lfIndef" ${existing?.isIndefinite ? 'checked' : ''} /> Umowa na czas nieokreślony</label>
        <div class="form-grid cols-2">
          <div class="field"><label>Okres wypowiedzenia (dni)</label><input type="number" name="noticeDays" value="${esc(existing?.noticePeriodDays ?? 30)}" /></div>
          <div class="field"><label>Dzień płatności w miesiącu</label><input type="number" min="1" max="31" name="payDay" value="${esc(existing?.paymentDay ?? 10)}" /></div>
        </div>

        <hr style="border:none;border-top:1px solid var(--border);margin:2px 0">
        <div class="section-title" style="font-size:14px">3. Finanse miesięczne (podział: najem vs media)</div>
        <div class="form-grid cols-3">
          <div class="field">
            <label style="color:var(--rent-color)">Czynsz najmu / odstępne (zł) *</label>
            <input type="number" step="0.01" min="0" name="monthlyRent" value="${esc(existing?.monthlyRent ?? '')}" inputmode="decimal" required />
          </div>
          <div class="field" id="lfMediaFlatWrap">
            <label style="color:var(--media-color)">Media / opłaty łącznie (zł)</label>
            <input type="number" step="0.01" min="0" name="monthlyUtilities" id="lfMediaFlat" value="${esc(existing?.monthlyUtilities ?? 0)}" inputmode="decimal" />
          </div>
          <div class="field">
            <label>Kaucja zwrotna (zł) <span class="muted">(poza przychodem)</span></label>
            <input type="number" step="0.01" min="0" name="depositAmount" value="${esc(existing?.depositAmount ?? 0)}" inputmode="decimal" />
          </div>
        </div>
        <label class="field-check"><input type="checkbox" name="depositPaid" ${existing?.depositPaid ? 'checked' : ''} /> Kaucja została już wpłacona</label>
        <label class="field-check"><input type="checkbox" id="lfUseBd" name="useBd" ${useBd ? 'checked' : ''} /> Rozbij media na poszczególne pozycje (wspólnota, prąd, woda, gaz…)</label>
        <div id="lfBdWrap" class="${useBd ? '' : 'hidden'}">${renderBreakdownFields(bd, 'lbd_')}</div>

        <hr style="border:none;border-top:1px solid var(--border);margin:2px 0">
        <div class="section-title" style="font-size:14px">4. Stany liczników (początek i zdanie) oraz wyposażenie</div>
        <div class="form-grid cols-2">
          <div class="field"><label>Prąd — początek najmu</label><input name="smPrad" value="${esc(existing?.startMeters?.prad || '')}" placeholder="np. 4812,4 kWh" /></div>
          <div class="field"><label>Prąd — zdanie / koniec</label><input name="emPrad" value="${esc(existing?.endMeters?.prad || '')}" placeholder="np. 5120,0 kWh" /></div>
          <div class="field"><label>Woda — początek najmu</label><input name="smWoda" value="${esc(existing?.startMeters?.woda || '')}" placeholder="np. 164,8 m³" /></div>
          <div class="field"><label>Woda — zdanie / koniec</label><input name="emWoda" value="${esc(existing?.endMeters?.woda || '')}" placeholder="np. 198,2 m³" /></div>
          <div class="field"><label>Gaz — początek najmu</label><input name="smGaz" value="${esc(existing?.startMeters?.gaz || '')}" placeholder="np. 1012,0 m³" /></div>
          <div class="field"><label>Gaz — zdanie / koniec</label><input name="emGaz" value="${esc(existing?.endMeters?.gaz || '')}" placeholder="opcjonalnie" /></div>
          <div class="field"><label>Ciepło — początek najmu</label><input name="smCieplo" value="${esc(existing?.startMeters?.cieplo || '')}" placeholder="np. 29,6 GJ" /></div>
          <div class="field"><label>Ciepło — zdanie / koniec</label><input name="emCieplo" value="${esc(existing?.endMeters?.cieplo || '')}" placeholder="opcjonalnie" /></div>
        </div>
        <div class="field">
          <label>Spis wyposażenia (zawartość mieszkania)</label>
          <textarea name="invNote">${esc(existing?.inventoryNote ?? unit.baseInventory ?? '')}</textarea>
        </div>
        <div class="field">
          <label>Uwagi do umowy</label>
          <textarea name="notes">${esc(existing?.notes || '')}</textarea>
        </div>
        ${!isEdit ? `
        <div class="card card-tight stack-sm" style="background:var(--surface-2)">
          <strong class="text-sm">Automatyczne wpłaty od daty rozpoczęcia umowy</strong>
          <div class="field">
            <label>Które miesiące wygenerować ze stawek powyżej?</label>
            <select name="genPayMode" id="lfGenMode">
              <option value="all_to_now" selected>Od miesiąca startu umowy do ${isArchivedCreate ? 'końca umowy' : 'teraz'} (także wstecz!)</option>
              <option value="first_only">Tylko miesiąc startu umowy</option>
              <option value="none">Nie generuj (wpiszę wpłaty ręcznie)</option>
            </select>
          </div>
          <label class="field-check text-xs"><input type="checkbox" name="genMarkPastPaid" id="lfPastPaid" ${isArchivedCreate ? 'checked' : ''} /> Oznacz wcześniejsze (minione) miesiące jako już <strong>opłacone</strong></label>
          <label class="field-check text-xs"><input type="checkbox" name="genProrate" id="lfProrate" checked /> Jeśli start/koniec przypada w środku miesiąca — przelicz pierwszy/ostatni miesiąc proporcjonalnie za dni</label>
          <div class="text-xs muted" id="lfGenHint"></div>
        </div>` : ''}
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn" id="lfCancel">Anuluj</button>
      <button type="button" class="btn btn-primary" id="lfSave">${isEdit ? 'Zapisz zmiany' : 'Utwórz umowę'}</button>
    `,
    onMount: () => {
      const f = document.getElementById('leaseForm');
      const syncIndef = () => {
        document.getElementById('lfEndWrap').style.opacity = f.isIndefinite.checked ? '0.45' : '1';
        f.endDate.disabled = f.isIndefinite.checked;
      };
      const syncBd = () => {
        const on = f.useBd.checked;
        document.getElementById('lfBdWrap').classList.toggle('hidden', !on);
        f.monthlyUtilities.readOnly = on;
        if (on) f.monthlyUtilities.value = sumBreakdown(readBreakdownInputs(f, 'lbd_'));
      };
      f.isIndefinite.addEventListener('change', syncIndef);
      f.useBd.addEventListener('change', syncBd);
      document.getElementById('lfBdWrap').addEventListener('input', () => {
        if (f.useBd.checked) f.monthlyUtilities.value = sumBreakdown(readBreakdownInputs(f, 'lbd_'));
      });
      syncIndef();
      syncBd();

      if (!isEdit) {
        const hintEl = document.getElementById('lfGenHint');
        const refreshGenHint = () => {
          if (!hintEl) return;
          const mode = f.genPayMode?.value || 'none';
          const sDate = f.startDate.value;
          if (mode === 'none' || !sDate) { hintEl.textContent = 'Wpisy płatności nie zostaną automatycznie utworzone.'; return; }
          const preview = generateLeasePayments({
            unitId: unit.id, id: 'tmp', startDate: sDate,
            endDate: f.isIndefinite.checked ? '' : f.endDate.value,
            isIndefinite: f.isIndefinite.checked,
            archivedAt: isArchivedCreate ? new Date().toISOString() : null,
            monthlyRent: Number(f.monthlyRent.value) || 0,
            monthlyUtilities: Number(f.monthlyUtilities.value) || 0,
            paymentDay: Number(f.payDay.value) || 10,
          }, { mode, markPastPaid: !!f.genMarkPastPaid?.checked, prorateFirst: !!f.genProrate?.checked });
          if (!preview.length) { hintEl.textContent = ''; return; }
          const first = preview[0]; const last = preview[preview.length - 1];
          const paidC = preview.filter((x) => x.status === 'paid').length;
          hintEl.textContent = preview.length === 1
            ? `Powstanie 1 wpis: ${formatMonthPL(first.month)} (${first.note || 'pełny miesiąc'}).`
            : `Powstanie ${preview.length} wpisów: ${formatMonthShort(first.month)} → ${formatMonthShort(last.month)}${paidC ? ` (${paidC} oznaczonych jako opłacone)` : ''}.`;
        };
        ['startDate', 'endDate', 'isIndefinite', 'genPayMode', 'genMarkPastPaid', 'genProrate'].forEach((n) => {
          f[n]?.addEventListener('change', refreshGenHint);
        });
        refreshGenHint();
      }

      document.getElementById('lfCancel').addEventListener('click', closeModal);
      document.getElementById('lfSave').addEventListener('click', () => {
        const tName = f.tName.value.trim();
        const startDate = f.startDate.value;
        if (!tName) { showToast('Wpisz imię i nazwisko lub nazwę najemcy.'); return; }
        if (!startDate) { showToast('Wybierz datę rozpoczęcia najmu.'); return; }
        if (!f.isIndefinite.checked && f.endDate.value && f.endDate.value < startDate) {
          showToast('Data końca najmu nie może być wcześniejsza niż data startu.');
          return;
        }
        const isIndefinite = f.isIndefinite.checked;
        const endDateVal = isIndefinite ? '' : f.endDate.value;
        const rent = roundMoney(f.monthlyRent.value);
        const bdObj = readBreakdownInputs(f, 'lbd_');
        const useBreakdown = f.useBd.checked && hasNonZeroBreakdown(bdObj);
        const util = useBreakdown ? sumBreakdown(bdObj) : roundMoney(f.monthlyUtilities.value);
        const dep = roundMoney(f.depositAmount.value);
        const snapshot = {
          tenantObj: {
            name: tName,
            phone: f.tPhone.value.trim(),
            email: f.tEmail.value.trim(),
            address: f.tAddr.value.trim(),
            idInfo: f.tId.value.trim(),
            emergencyContact: f.tEmerg.value.trim(),
            bankAccount: f.tBank.value.trim(),
            notes: f.tNotes.value.trim(),
          },
          startMeters: {
            prad: f.smPrad.value.trim(),
            woda: f.smWoda.value.trim(),
            gaz: f.smGaz.value.trim(),
            cieplo: f.smCieplo.value.trim(),
          },
          endMeters: {
            prad: f.emPrad.value.trim(),
            woda: f.emWoda.value.trim(),
            gaz: f.emGaz.value.trim(),
            cieplo: f.emCieplo.value.trim(),
          },
          noticePeriodDays: Number(f.noticeDays.value) || 30,
          paymentDay: Number(f.payDay.value) || 10,
          depositPaid: f.depositPaid.checked,
          inventoryNote: f.invNote.value.trim(),
          notes: f.notes.value.trim(),
          genPayMode: f.genPayMode?.value || 'none',
          genMarkPastPaid: !!f.genMarkPastPaid?.checked,
          genProrate: !!f.genProrate?.checked,
        };

        const commit = async () => {
          if (isEdit) {
            existing.tenant = snapshot.tenantObj;
            existing.startDate = startDate;
            existing.endDate = endDateVal;
            existing.isIndefinite = isIndefinite;
            existing.noticePeriodDays = snapshot.noticePeriodDays;
            existing.paymentDay = snapshot.paymentDay;
            existing.monthlyRent = rent;
            existing.monthlyUtilities = util;
            existing.useUtilitiesBreakdown = useBreakdown;
            existing.utilitiesBreakdown = bdObj;
            existing.depositAmount = dep;
            existing.depositPaid = snapshot.depositPaid;
            existing.startMeters = snapshot.startMeters;
            existing.endMeters = snapshot.endMeters;
            existing.inventoryNote = snapshot.inventoryNote;
            existing.notes = snapshot.notes;
            appendAudit(state, 'Edycja umowy', `${property.name} / ${unit.name} — ${tName} (${formatPLN(rent)} + ${formatPLN(util)})`);
          } else {
            const newLease = {
              id: uid('lease'),
              unitId: unit.id,
              tenant: snapshot.tenantObj,
              startDate,
              endDate: endDateVal,
              isIndefinite,
              noticePeriodDays: snapshot.noticePeriodDays,
              paymentDay: snapshot.paymentDay,
              monthlyRent: rent,
              monthlyUtilities: util,
              useUtilitiesBreakdown: useBreakdown,
              utilitiesBreakdown: bdObj,
              depositAmount: dep,
              depositPaid: snapshot.depositPaid,
              startMeters: snapshot.startMeters,
              endMeters: snapshot.endMeters,
              depositSettlement: null,
              inventoryNote: snapshot.inventoryNote,
              notes: snapshot.notes,
              createdAt: new Date().toISOString(),
              archivedAt: isArchivedCreate ? new Date().toISOString() : null,
              deletedAt: null,
            };
            state.leases.push(newLease);
            const generated = generateLeasePayments(newLease, {
              mode: snapshot.genPayMode,
              markPastPaid: snapshot.genMarkPastPaid,
              prorateFirst: snapshot.genProrate,
            });
            for (const gp of generated) state.payments.push(gp);
            appendAudit(state, isArchivedCreate ? 'Dodano archiwalną umowę wstecz' : 'Nowa umowa najmu', `${property.name} / ${unit.name} — ${tName}${generated.length ? ` (${generated.length} mies. wpłat)` : ''}`);
          }
          await saveAndRender();
          closeModal();
          showToast(isEdit ? 'Zapisano zmiany w umowie.' : 'Dodano nową umowę.');
        };

        if (isEdit && (existing.monthlyRent !== rent || existing.monthlyUtilities !== util || existing.endDate !== endDateVal || existing.isIndefinite !== isIndefinite)) {
          const diffs = [];
          if (existing.monthlyRent !== rent) diffs.push({ label: 'Czynsz najmu', oldVal: formatPLN(existing.monthlyRent), newVal: formatPLN(rent) });
          if (existing.monthlyUtilities !== util) diffs.push({ label: 'Media / opłaty', oldVal: formatPLN(existing.monthlyUtilities), newVal: formatPLN(util) });
          const nextEnd = isIndefinite ? 'czas nieokreślony' : (endDateVal ? formatDatePL(endDateVal) : '—');
          const oldEnd = existing.isIndefinite ? 'czas nieokreślony' : formatDatePL(existing.endDate);
          if (oldEnd !== nextEnd) diffs.push({ label: 'Koniec umowy', oldVal: oldEnd, newVal: nextEnd });
          openConfirmModal({
            title: 'Potwierdź zmianę warunków umowy',
            message: 'Sprawdź różnice przed zapisaniem (nie zmienia to wcześniejszych zaksięgowanych wpłat):',
            confirmLabel: 'Zapisz zmiany',
            diffRows: diffs,
            onConfirm: commit,
          });
        } else {
          void commit();
        }
      });
    },
  });
}

export function openPaymentModal({ state, unit, property, lease, existing = null, saveAndRender }) {
  const isEdit = !!existing;
  const initBd = existing?.utilitiesBreakdown || lease?.utilitiesBreakdown || emptyBreakdown();
  const initUseBd = isEdit ? !!existing.useBreakdown : (!!lease?.useUtilitiesBreakdown && hasNonZeroBreakdown(initBd));
  const initMedia = isEdit ? getEffectiveMediaAmount(existing) : (lease?.monthlyUtilities || 0);

  openModal({
    title: isEdit ? `Edytuj wpis za ${formatMonthPL(existing.month)}` : `Dodaj wpłatę — ${unit.name}`,
    bodyHtml: `
      <form id="payForm" class="stack-md">
        <div class="form-grid cols-2">
          <div class="field"><label>Miesiąc rozliczeniowy *</label><input type="month" name="month" value="${esc(existing?.month || currentMonthKey())}" required /></div>
          <div class="field">
            <label>Status wpłaty</label>
            <select name="status">
              <option value="paid" ${(!existing || existing.status === 'paid') ? 'selected' : ''}>Opłacone</option>
              <option value="pending" ${existing?.status === 'pending' ? 'selected' : ''}>Oczekuje na wpłatę</option>
            </select>
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label style="color:var(--rent-color)">Przychód z najmu / czynsz (zł) *</label>
            <input type="number" step="0.01" min="0" name="rent" value="${esc(isEdit ? existing.rentAmount : (lease?.monthlyRent ?? 0))}" inputmode="decimal" required />
          </div>
          <div class="field">
            <label style="color:var(--media-color)">Media / opłaty (zł)</label>
            <input type="number" step="0.01" min="0" name="media" value="${esc(initMedia)}" inputmode="decimal" />
          </div>
        </div>
        <div class="card card-tight" style="background:var(--surface-2);display:flex;justify-content:space-between;align-items:center">
          <span class="muted text-sm">Razem za ten miesiąc:</span>
          <strong class="num" id="pfTotalPreview" style="font-size:17px">—</strong>
        </div>
        ${lease ? `
        <details class="card card-tight" style="background:var(--surface-2)" id="pfProrataBox">
          <summary style="cursor:pointer;font-size:12.5px;font-weight:700;color:var(--primary)">Niepełny miesiąc? Przelicz proporcjonalnie za dni</summary>
          <div class="stack-sm" style="margin-top:10px">
            <div class="form-grid cols-2">
              <div class="field"><label>Od dnia miesiąca</label><input type="number" min="1" max="31" id="prFromDay" value="1" /></div>
              <div class="field"><label>Do dnia miesiąca</label><input type="number" min="1" max="31" id="prToDay" value="30" /></div>
            </div>
            <div class="text-xs muted" id="prHint"></div>
            <div class="inline-flex" style="flex-wrap:wrap">
              <button type="button" class="btn btn-soft btn-xs" id="prApplyRent">Przelicz tylko najem</button>
              <button type="button" class="btn btn-soft btn-xs" id="prApplyBoth">Przelicz najem + media</button>
            </div>
          </div>
        </details>` : ''}
        <label class="field-check"><input type="checkbox" name="useBd" ${initUseBd ? 'checked' : ''} /> Rozpisz media na składowe (wspólnota, prąd, woda…)</label>
        <div id="pfBdWrap" class="${initUseBd ? '' : 'hidden'}">${renderBreakdownFields(initBd, 'pbd_')}</div>
        <div class="field" id="pfPaidDateWrap">
          <label>Data otrzymania przelewu / wpłaty</label>
          <input type="date" name="paidDate" value="${esc(existing?.paidDate || todayISO())}" />
        </div>
        ${!isEdit ? `
        <div class="field" id="pfReceivedWrap">
          <label>Faktycznie otrzymana kwota przelewu (opcjonalnie)</label>
          <input type="number" step="0.01" min="0" name="receivedAmount" placeholder="Zostaw puste jeśli wpłacono dokładnie tyle co wyżej" inputmode="decimal" />
          <span class="field-hint" id="pfOverHint">Jeśli najemca przelał <strong>więcej</strong> niż „Razem za ten miesiąc”, nadwyżka automatycznie wpadnie jako nadpłata kolejnego miesiąca. Jeśli mniej — wpisze się jako wpłata częściowa.</span>
        </div>` : ''}
        <div class="field">
          <label>Uwagi (np. rozliczenie prądu / korekta wody)</label>
          <input name="note" value="${esc(existing?.note || '')}" placeholder="Opcjonalnie…" />
        </div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn" id="pmCancel">Anuluj</button>
      <button type="button" class="btn btn-primary" id="pmSave">${isEdit ? 'Zapisz zmiany' : 'Zapisz wpłatę'}</button>
    `,
    onMount: () => {
      const f = document.getElementById('payForm');
      const refreshTotal = () => {
        if (f.useBd.checked) f.media.value = sumBreakdown(readBreakdownInputs(f, 'pbd_'));
        const sum = roundMoney(Number(f.rent.value || 0) + Number(f.media.value || 0));
        document.getElementById('pfTotalPreview').textContent = formatPLN(sum, true);
        f.media.readOnly = f.useBd.checked;
        document.getElementById('pfBdWrap').classList.toggle('hidden', !f.useBd.checked);
        document.getElementById('pfPaidDateWrap').classList.toggle('hidden', f.status.value !== 'paid');
        const rcvWrap = document.getElementById('pfReceivedWrap');
        if (rcvWrap) {
          rcvWrap.classList.toggle('hidden', f.status.value !== 'paid');
          const rcvVal = Number(f.receivedAmount?.value || 0);
          const hint = document.getElementById('pfOverHint');
          if (rcvVal > 0 && rcvVal > sum + 0.005) {
            const diff = roundMoney(rcvVal - sum);
            const nextMk = addMonthsToKey(f.month.value || currentMonthKey(), 1);
            hint.innerHTML = `<strong style="color:var(--primary)">Nadpłata +${esc(formatPLN(diff, true))}</strong> automatycznie przejdzie na <strong>${esc(formatMonthPL(nextMk))}</strong>.`;
          } else if (rcvVal > 0 && rcvVal < sum - 0.005) {
            hint.innerHTML = `<strong style="color:var(--warn)">Wpłata częściowa:</strong> wpłacono ${esc(formatPLN(rcvVal, true))}, pozostanie ${esc(formatPLN(roundMoney(sum - rcvVal), true))}.`;
          } else {
            hint.textContent = 'Jeśli najemca przelał więcej niż „Razem”, nadwyżka automatycznie wpadnie jako nadpłata kolejnego miesiąca.';
          }
        }
      };
      f.addEventListener('input', refreshTotal);
      f.status.addEventListener('change', refreshTotal);
      f.useBd.addEventListener('change', refreshTotal);
      refreshTotal();

      // Pro-rata partial month calculator helper
      const prFrom = document.getElementById('prFromDay');
      const prTo = document.getElementById('prToDay');
      const prHint = document.getElementById('prHint');
      const syncProRataDefaults = (prefillFromLease = false) => {
        if (!prFrom || !prTo || !lease) return;
        const mk = f.month.value || currentMonthKey();
        const maxD = daysInMonthKey(mk);
        prFrom.max = String(maxD);
        prTo.max = String(maxD);
        if (prefillFromLease) {
          const isStartM = lease.startDate?.startsWith(mk);
          const isEndM = !lease.isIndefinite && lease.endDate?.startsWith(mk);
          prFrom.value = isStartM ? String(Number(lease.startDate.slice(8, 10)) || 1) : '1';
          prTo.value = isEndM ? String(Number(lease.endDate.slice(8, 10)) || maxD) : String(maxD);
        }
        const r = calculateProRata(lease.monthlyRent || 0, mk, prFrom.value, prTo.value);
        const m = calculateProRata(lease.monthlyUtilities || 0, mk, prFrom.value, prTo.value);
        prHint.textContent = `${r.activeDays} z ${r.totalDays} dni → najem: ${formatPLN(r.amount, true)}, media: ${formatPLN(m.amount, true)} (możesz później ręcznie poprawić).`;
      };
      if (prFrom && prTo && lease) {
        syncProRataDefaults(true);
        f.month.addEventListener('change', () => syncProRataDefaults(true));
        prFrom.addEventListener('input', () => syncProRataDefaults(false));
        prTo.addEventListener('input', () => syncProRataDefaults(false));
        const applyProRata = (includeMedia) => {
          const mk = f.month.value || currentMonthKey();
          const r = calculateProRata(lease.monthlyRent || 0, mk, prFrom.value, prTo.value);
          f.rent.value = r.amount;
          if (includeMedia) {
            f.useBd.checked = false;
            const m = calculateProRata(lease.monthlyUtilities || 0, mk, prFrom.value, prTo.value);
            f.media.value = m.amount;
          }
          const tag = `Niepełny miesiąc: ${r.activeDays}/${r.totalDays} dni (od ${r.fromDay}. do ${r.toDay}.)`;
          if (!f.note.value.trim()) f.note.value = tag;
          refreshTotal();
          showToast(`Przeliczono za ${r.activeDays}/${r.totalDays} dni.`);
        };
        document.getElementById('prApplyRent').addEventListener('click', () => applyProRata(false));
        document.getElementById('prApplyBoth').addEventListener('click', () => applyProRata(true));
      }

      document.getElementById('pmCancel').addEventListener('click', closeModal);
      document.getElementById('pmSave').addEventListener('click', () => {
        const month = f.month.value;
        if (!month) { showToast('Wybierz miesiąc.'); return; }
        const rent = roundMoney(f.rent.value);
        const bd = readBreakdownInputs(f, 'pbd_');
        const useBd = f.useBd.checked && hasNonZeroBreakdown(bd);
        const media = useBd ? sumBreakdown(bd) : roundMoney(f.media.value);
        const status = f.status.value;
        const paidDate = status === 'paid' ? (f.paidDate.value || todayISO()) : '';
        const noteText = f.note.value.trim();
        const receivedVal = !isEdit && status === 'paid' && f.receivedAmount?.value ? roundMoney(f.receivedAmount.value) : 0;

        const commit = async () => {
          let toastMsg = 'Zapisano wpis finansowy.';
          if (isEdit) {
            existing.month = month;
            existing.rentAmount = rent;
            existing.utilitiesAmount = media;
            existing.useBreakdown = useBd;
            existing.utilitiesBreakdown = bd;
            existing.status = status;
            existing.paidDate = paidDate;
            existing.note = noteText;
            if (Array.isArray(existing.installments) && existing.installments.length > 0 && status !== 'paid') {
              syncPaymentStatusFromInstallments(existing);
            }
            appendAudit(state, 'Edycja wpłaty', `${property.name} / ${unit.name} (${month}): najem ${formatPLN(rent)}, media ${formatPLN(media)}`);
          } else {
            const newPay = {
              id: uid('pay'),
              unitId: unit.id,
              leaseId: lease?.id || null,
              month,
              rentAmount: rent,
              utilitiesAmount: media,
              useBreakdown: useBd,
              utilitiesBreakdown: bd,
              status: receivedVal > 0 ? 'pending' : status,
              installments: [],
              paidDate: receivedVal > 0 ? '' : paidDate,
              note: noteText,
              createdAt: new Date().toISOString(),
              deletedAt: null,
            };
            state.payments.push(newPay);
            if (receivedVal > 0) {
              const res = applyTransferWithOverpayment(state, {
                payment: newPay,
                lease,
                amount: receivedVal,
                date: paidDate || todayISO(),
                note: noteText,
                carryOverpayment: true,
              });
              const carried = res.applied.filter((x) => x.isCarryover);
              const carriedSum = roundMoney(carried.reduce((s, x) => s + x.amount, 0));
              if (carried.length) {
                toastMsg = `Zapisano! Nadpłata ${formatPLN(carriedSum)} przeniesiona na ${carried.map((c) => formatMonthShort(c.month)).join(', ')} ✓`;
              }
            }
            appendAudit(state, 'Dodano wpłatę', `${property.name} / ${unit.name} (${month}): ${formatPLN(receivedVal > 0 ? receivedVal : rent + media)}`);
          }
          await saveAndRender();
          closeModal();
          showToast(toastMsg, 3600);
        };

        if (isEdit && (existing.rentAmount !== rent || getEffectiveMediaAmount(existing) !== media)) {
          const diffs = [];
          if (existing.rentAmount !== rent) diffs.push({ label: 'Najem', oldVal: formatPLN(existing.rentAmount), newVal: formatPLN(rent) });
          const oldM = getEffectiveMediaAmount(existing);
          if (oldM !== media) diffs.push({ label: 'Media', oldVal: formatPLN(oldM), newVal: formatPLN(media) });
          openConfirmModal({
            title: `Potwierdzić zmianę kwoty (${formatMonthPL(month)})?`,
            message: 'Zmieniasz zapisane kwoty wpłaty:',
            confirmLabel: 'Zapisz zmianę',
            diffRows: diffs,
            onConfirm: commit,
          });
        } else {
          void commit();
        }
      });
    },
  });
}

export function openMetersModal({ state, property, unit, lease, saveAndRender }) {
  const sm = lease.startMeters || {};
  const em = lease.endMeters || {};
  const mIds = unit.meterIds || {};
  openModal({
    title: `Stany liczników — ${unit.name}`,
    wide: true,
    bodyHtml: `
      <form id="metersForm" class="stack-md">
        <p class="muted text-sm" style="margin:0">Wpisz lub zaktualizuj odczyty dla umowy: <strong>${esc(lease.tenant?.name || 'Najemca')}</strong>. Jeśli podasz oba stany, aplikacja sama policzy zużycie.</p>
        <div class="form-grid cols-2">
          <div class="field"><label>Data odczytu — początek najmu</label><input type="date" name="smDate" value="${esc(lease.startMetersDate || lease.startDate || '')}" /></div>
          <div class="field"><label>Data odczytu — zdanie / koniec</label><input type="date" name="emDate" value="${esc(lease.endMetersDate || '')}" /></div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Licznik</th>
                <th>Początek najmu</th>
                <th>Zdanie / koniec</th>
                <th class="r">Zużycie</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Prąd</strong><div class="text-xs muted">${esc(mIds.prad || 'brak nr')}</div></td>
                <td><input name="smPrad" value="${esc(sm.prad || '')}" placeholder="np. 4812,4 kWh" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)" /></td>
                <td><input name="emPrad" value="${esc(em.prad || '')}" placeholder="np. 5120,0 kWh" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)" /></td>
                <td class="r num text-sm" id="mdPrad">—</td>
              </tr>
              <tr>
                <td><strong>Woda</strong><div class="text-xs muted">${esc(mIds.woda || 'brak nr')}</div></td>
                <td><input name="smWoda" value="${esc(sm.woda || '')}" placeholder="np. 164,8 m³" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)" /></td>
                <td><input name="emWoda" value="${esc(em.woda || '')}" placeholder="np. 198,2 m³" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)" /></td>
                <td class="r num text-sm" id="mdWoda">—</td>
              </tr>
              <tr>
                <td><strong>Gaz</strong><div class="text-xs muted">${esc(mIds.gaz || 'brak nr')}</div></td>
                <td><input name="smGaz" value="${esc(sm.gaz || '')}" placeholder="np. 1012,0 m³" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)" /></td>
                <td><input name="emGaz" value="${esc(em.gaz || '')}" placeholder="np. 1245,5 m³" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)" /></td>
                <td class="r num text-sm" id="mdGaz">—</td>
              </tr>
              <tr>
                <td><strong>Ciepło</strong><div class="text-xs muted">${esc(mIds.cieplo || 'brak nr')}</div></td>
                <td><input name="smCieplo" value="${esc(sm.cieplo || '')}" placeholder="np. 29,6 GJ" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)" /></td>
                <td><input name="emCieplo" value="${esc(em.cieplo || '')}" placeholder="np. 36,4 GJ" style="width:100%;padding:7px 9px;border-radius:8px;border:1px solid var(--border-strong);background:var(--surface-2);color:var(--text)" /></td>
                <td class="r num text-sm" id="mdCieplo">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn" id="mfCancel">Anuluj</button>
      <button type="button" class="btn btn-primary" id="mfSave">Zapisz stany liczników</button>
    `,
    onMount: () => {
      const f = document.getElementById('metersForm');
      const refresh = () => {
        document.getElementById('mdPrad').textContent = computeMeterDelta(f.smPrad.value, f.emPrad.value, 'kWh') || '—';
        document.getElementById('mdWoda').textContent = computeMeterDelta(f.smWoda.value, f.emWoda.value, 'm³') || '—';
        document.getElementById('mdGaz').textContent = computeMeterDelta(f.smGaz.value, f.emGaz.value, 'm³') || '—';
        document.getElementById('mdCieplo').textContent = computeMeterDelta(f.smCieplo.value, f.emCieplo.value, 'GJ') || '—';
      };
      f.addEventListener('input', refresh);
      refresh();
      document.getElementById('mfCancel').addEventListener('click', closeModal);
      document.getElementById('mfSave').addEventListener('click', async () => {
        lease.startMetersDate = f.smDate.value || '';
        lease.endMetersDate = f.emDate.value || '';
        lease.startMeters = {
          prad: f.smPrad.value.trim(),
          woda: f.smWoda.value.trim(),
          gaz: f.smGaz.value.trim(),
          cieplo: f.smCieplo.value.trim(),
        };
        lease.endMeters = {
          prad: f.emPrad.value.trim(),
          woda: f.emWoda.value.trim(),
          gaz: f.emGaz.value.trim(),
          cieplo: f.emCieplo.value.trim(),
        };
        appendAudit(state, 'Zaktualizowano stany liczników', `${property.name} / ${unit.name}`);
        await saveAndRender();
        closeModal();
        showToast('Zapisano stany liczników ✓');
      });
    },
  });
}

export function openInstallmentsModal({ state, unit, property, payment, saveAndRender }) {
  if (!Array.isArray(payment.installments)) payment.installments = [];
  const lease = state.leases.find((l) => l.id === payment.leaseId && !l.deletedAt) || null;
  const draw = () => {
    const bal = getPaymentBalance(payment);
    const pct = bal.expected > 0 ? Math.min(100, Math.round((bal.paid / bal.expected) * 100)) : 0;
    const half = roundMoney(bal.expected / 2);
    const list = payment.installments;
    const nextMk = addMonthsToKey(payment.month, 1);

    openModal({
      title: `Zaksięguj przelew / raty — ${formatMonthPL(payment.month)}`,
      bodyHtml: `
        <div class="card card-tight stack-sm" style="background:var(--surface-2)">
          <div class="row-between text-sm">
            <span>Do zapłaty (najem + media):</span>
            <strong class="num">${esc(formatPLN(bal.expected, true))}</strong>
          </div>
          <div class="lease-progress">
            <div class="lease-progress-fill ${bal.state === 'paid' ? '' : 'warn'}" style="width:${pct}%"></div>
          </div>
          <div class="row-between text-xs muted">
            <span>Wpłacono: <strong class="num text-ok">${esc(formatPLN(bal.paid, true))}</strong> (${pct}%)</span>
            <span>${bal.remaining > 0 ? `Pozostało: <strong class="num text-media">${esc(formatPLN(bal.remaining, true))}</strong>` : (bal.overpaid > 0 ? `Nadpłata: ${esc(formatPLN(bal.overpaid, true))}` : 'Opłacone w całości ✓')}</span>
          </div>
        </div>

        <div class="section-title" style="font-size:13.5px">Zaksięgowane wpłaty / przelewy (${list.length})</div>
        ${list.length === 0 ? `<div class="text-sm muted">Brak wpisanych przelewów. Dodaj przelew w całości, w ratach lub z nadpłatą poniżej.</div>` : `
          <div class="card card-flush">
            ${list.map((it, idx) => `
              <div class="doc-row">
                <div class="doc-info">
                  <div class="doc-title num">${esc(formatPLN(it.amount, true))}${it.payer ? ` — ${esc(it.payer)}` : ''}${it.isCarryover ? ' <span class="badge badge-rent">z nadpłaty</span>' : ''}</div>
                  <div class="doc-sub">${esc(formatDatePL(it.date))}${it.note ? ` • ${esc(it.note)}` : ''}</div>
                </div>
                <button type="button" class="btn btn-danger btn-xs" data-del-inst="${idx}" aria-label="Usuń transzę">${icon('trash', 12)}</button>
              </div>
            `).join('')}
          </div>`}

        <hr style="border:none;border-top:1px solid var(--border);margin:2px 0">
        <div class="section-title" style="font-size:13.5px">Dodaj wpływ / przelew z datą</div>
        <div class="inline-flex" style="flex-wrap:wrap">
          ${bal.remaining > 0 ? `<button type="button" class="btn btn-soft btn-xs" id="instFillRest">${bal.paid === 0 ? 'Całość' : 'Dopłać resztę'} (${esc(formatPLN(bal.remaining))})</button>` : ''}
          ${bal.paid === 0 ? `<button type="button" class="btn btn-soft btn-xs" id="instFillHalf">Połowa 1/2 (${esc(formatPLN(half))})</button>` : ''}
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Kwota przelewu (zł) *</label><input type="number" step="0.01" min="0.01" id="instAmt" value="${bal.remaining > 0 ? bal.remaining : ''}" inputmode="decimal" /></div>
          <div class="field"><label>Data wpływu / przelewu *</label><input type="date" id="instDate" value="${todayISO()}" /></div>
          <div class="field"><label>Kto wpłacił (opcjonalnie)</label><input id="instPayer" placeholder="np. Piotr / współlokator" /></div>
          <div class="field"><label>Uwaga</label><input id="instNote" placeholder="np. 1/2 raty, przelew na konto" /></div>
        </div>
        <div id="instOverBox" class="card card-tight hidden" style="background:var(--primary-tint);border-color:transparent;font-size:12.5px"></div>
        <label class="field-check text-xs"><input type="checkbox" id="instCarry" checked /> Jeśli kwota jest wyższa niż należność — <strong>automatycznie przenieś nadpłatę na kolejny miesiąc</strong> (od ${esc(formatMonthPL(nextMk))})</label>
      `,
      footerHtml: `
        <button type="button" class="btn" id="instClose">Zamknij</button>
        <button type="button" class="btn btn-primary" id="instAdd">${icon('plus', 14)} Zaksięguj przelew</button>
      `,
      onMount: () => {
        const amtEl = document.getElementById('instAmt');
        const carryEl = document.getElementById('instCarry');
        const overBox = document.getElementById('instOverBox');
        const refreshOver = () => {
          const val = roundMoney(amtEl.value);
          const surplus = roundMoney(val - bal.remaining);
          if (surplus > 0.005) {
            overBox.classList.remove('hidden');
            overBox.innerHTML = carryEl.checked
              ? `<strong>Nadpłata +${esc(formatPLN(surplus, true))}</strong> → zostanie automatycznie zaksięgowana na poczet <strong>${esc(formatMonthPL(nextMk))}</strong>${bal.remaining > 0 ? ` (po opłaceniu ${esc(formatPLN(bal.remaining, true))} za ten miesiąc)` : ''}.`
              : `<strong>Nadpłata +${esc(formatPLN(surplus, true))}</strong> zostanie zapisana bezpośrednio w tym miesiącu (bez przenoszenia dalej).`;
          } else {
            overBox.classList.add('hidden');
          }
        };
        amtEl.addEventListener('input', refreshOver);
        carryEl.addEventListener('change', refreshOver);
        refreshOver();

        document.getElementById('instClose').addEventListener('click', closeModal);
        document.getElementById('instFillHalf')?.addEventListener('click', () => {
          amtEl.value = half;
          const n = document.getElementById('instNote');
          if (!n.value) n.value = '1/2 wpłaty';
          refreshOver();
        });
        document.getElementById('instFillRest')?.addEventListener('click', () => {
          amtEl.value = bal.remaining;
          refreshOver();
        });
        document.querySelectorAll('[data-del-inst]').forEach((b) => b.addEventListener('click', async () => {
          const idx = Number(b.dataset.delInst);
          const removed = payment.installments.splice(idx, 1)[0];
          if (payment.installments.length === 0) {
            payment.status = 'pending';
            payment.paidDate = '';
          } else {
            syncPaymentStatusFromInstallments(payment);
          }
          appendAudit(state, 'Usunięto wpłatę częściową', `${property.name} / ${unit.name} (${payment.month}): ${formatPLN(removed?.amount || 0)}`);
          await saveAndRender();
          draw();
        }));
        document.getElementById('instAdd').addEventListener('click', async () => {
          const amt = roundMoney(amtEl.value);
          if (amt <= 0) { showToast('Wpisz kwotę większą niż 0 zł.'); return; }
          const date = document.getElementById('instDate').value || todayISO();
          const payer = document.getElementById('instPayer').value.trim();
          const note = document.getElementById('instNote').value.trim();
          const res = applyTransferWithOverpayment(state, {
            payment,
            lease,
            amount: amt,
            date,
            payer,
            note,
            carryOverpayment: carryEl.checked,
          });
          const carried = res.applied.filter((x) => x.isCarryover);
          const carriedSum = roundMoney(carried.reduce((s, x) => s + x.amount, 0));
          appendAudit(
            state,
            carried.length ? 'Przelew z nadpłatą' : 'Zaksięgowano przelew',
            `${property.name} / ${unit.name} (${payment.month}, ${date}): ${formatPLN(amt)}${payer ? ` (${payer})` : ''}${carried.length ? ` • nadpłata ${formatPLN(carriedSum)} → ${carried.map((c) => c.month).join(', ')}` : ''}`
          );
          await saveAndRender();
          const after = getPaymentBalance(payment);
          if (carried.length) {
            closeModal();
            showToast(`Opłacono! Nadpłata ${formatPLN(carriedSum)} przeniesiona na ${carried.map((c) => formatMonthShort(c.month)).join(', ')} ✓`, 4000);
          } else if (after.state === 'paid') {
            closeModal();
            showToast('Wpłata kompletna — oznaczono jako opłacone ✓');
          } else {
            showToast(`Zaksięgowano ${formatPLN(amt)}. Pozostało: ${formatPLN(after.remaining)}.`);
            draw();
          }
        });
      },
    });
  };
  draw();
}

export function openAddPhotoModal({ state, unit, property, lease, defaultStage = 'start', mode = 'album', saveAndRender }) {
  const isCamera = mode === 'camera';
  openModal({
    title: isCamera ? 'Zrób zdjęcie aparatem' : 'Dodaj zdjęcia z albumu',
    bodyHtml: `
      <form id="photoForm" class="stack-md">
        <div class="form-grid cols-2">
          <div class="field">
            <label>Etap najmu</label>
            <select name="stage">
              ${PHOTO_STAGES.map((s) => `<option value="${s.id}" ${s.id === defaultStage ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Pomieszczenie / kategoria</label>
            <select name="room">
              ${DEFAULT_ROOMS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Data wykonania</label><input type="date" name="takenAt" value="${todayISO()}" /></div>
          <div class="field"><label>Opis / uwagi (np. rysa na podłodze)</label><input name="note" placeholder="Opcjonalny komentarz…" /></div>
        </div>
        <div class="field">
          <label>${isCamera ? 'Otwórz aparat iPhone’a / telefonu' : 'Wybierz jedno lub wiele zdjęć z galerii'}</label>
          <input type="file" id="photoInput" accept="image/*" ${isCamera ? 'capture="environment"' : 'multiple'} required />
          <span class="field-hint">${state.settings.compressPhotos ? 'Automatyczna kompresja (maks. 1920 px JPEG) oszczędza pamięć i przyspiesza kopię zapasową.' : 'Zapis w oryginalnej rozdzielczości.'}</span>
        </div>
        <div id="photoQueueInfo" class="muted text-sm"></div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn" id="phCancel">Anuluj</button>
      <button type="button" class="btn btn-primary" id="phSave">${icon(isCamera ? 'camera' : 'upload', 15)} Zapisz zdjęcia</button>
    `,
    onMount: () => {
      const input = document.getElementById('photoInput');
      input.addEventListener('change', () => {
        const count = input.files?.length || 0;
        const size = Array.from(input.files || []).reduce((a, b) => a + b.size, 0);
        document.getElementById('photoQueueInfo').textContent = count
          ? `Wybrano: ${count} plik(i), łącznie ${formatBytes(size)}.`
          : '';
      });
      document.getElementById('phCancel').addEventListener('click', closeModal);
      document.getElementById('phSave').addEventListener('click', async () => {
        const files = Array.from(input.files || []);
        if (!files.length) { showToast('Najpierw wybierz zdjęcie lub zrób je aparatem.'); return; }
        const btn = document.getElementById('phSave');
        btn.disabled = true;
        btn.textContent = 'Przetwarzanie…';
        const f = document.getElementById('photoForm');
        try {
          for (const file of files) {
            const { mainBlob, thumbBlob, fileName, mimeType } = await processPhotoFile(file, state.settings.compressPhotos);
            const id = uid('photo');
            const blobKey = `blob_${id}`;
            const thumbKey = thumbBlob ? `thumb_${id}` : null;
            await putBlob(blobKey, mainBlob);
            if (thumbKey) await putBlob(thumbKey, thumbBlob);
            state.photos.push({
              id,
              unitId: unit.id,
              leaseId: lease.id,
              stage: f.stage.value,
              room: f.room.value,
              takenAt: f.takenAt.value || todayISO(),
              note: f.note.value.trim(),
              fileName,
              mimeType,
              blobKey,
              thumbKey,
              size: mainBlob.size,
              createdAt: new Date().toISOString(),
              deletedAt: null,
            });
          }
          appendAudit(state, 'Dodano zdjęcia stanu', `${property.name} / ${unit.name}: ${files.length} szt. (${f.room.value}, ${f.stage.value})`);
          await saveAndRender();
          closeModal();
          showToast(`Zapisano ${files.length} zdjęć.`);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Zapisz zdjęcia';
          showToast(`Błąd zapisu: ${err.message}`);
        }
      });
    },
  });
}

export async function openPhotoViewerModal({ photo, canEdit, onDelete }) {
  const url = await getBlobUrl(photo.blobKey);
  const stageObj = PHOTO_STAGES.find((s) => s.id === photo.stage);
  openModal({
    title: `${photo.room} • ${stageObj?.short || photo.stage}`,
    wide: true,
    bodyHtml: `
      ${url ? `<img src="${url}" alt="${esc(photo.room)}" class="img-preview" />` : '<div class="empty-state">Brak pliku obrazu.</div>'}
      <div class="kv-grid">
        <div><div class="kv-label">Data wykonania</div><div class="kv-val">${esc(formatDatePL(photo.takenAt))}</div></div>
        <div><div class="kv-label">Etap</div><div class="kv-val">${esc(stageObj?.label || photo.stage)}</div></div>
        <div><div class="kv-label">Rozmiar</div><div class="kv-val">${esc(formatBytes(photo.size))}</div></div>
      </div>
      ${photo.note ? `<div class="card card-tight" style="background:var(--surface-2)">${esc(photo.note)}</div>` : ''}
    `,
    footerHtml: `
      ${canEdit ? `<button type="button" class="btn btn-danger btn-sm" id="pvDel">${icon('trash', 14)} Do kosza</button>` : ''}
      <button type="button" class="btn btn-sm" id="pvShare">${icon('share', 14)} Udostępnij / Zapisz</button>
      <button type="button" class="btn btn-primary btn-sm" id="pvClose">Zamknij</button>
    `,
    onMount: () => {
      document.getElementById('pvClose').addEventListener('click', closeModal);
      document.getElementById('pvShare').addEventListener('click', async () => {
        const blob = await getBlob(photo.blobKey);
        if (blob) await shareOrDownloadBlob(blob, photo.fileName || 'zdjecie.jpg', photo.room);
      });
      const del = document.getElementById('pvDel');
      if (del && onDelete) {
        del.addEventListener('click', () => {
          closeModal();
          onDelete(photo);
        });
      }
    },
  });
}

export async function openComparePhotosModal({ photos, initialRoom = null }) {
  const startPhotos = photos.filter((p) => p.stage === 'start');
  const endPhotos = photos.filter((p) => p.stage === 'end' || p.stage === 'during');
  if (!startPhotos.length || !endPhotos.length) {
    showToast('Aby porównać zdjęcia, dodaj co najmniej jedno zdjęcie z początku oraz z końca (lub w trakcie).');
    return;
  }
  let preferredStart = initialRoom ? startPhotos.find((p) => p.room === initialRoom) : null;
  if (!preferredStart) {
    // Auto-pick a matching room that has BOTH a start and end/during photo!
    preferredStart = startPhotos.find((sp) => endPhotos.some((ep) => ep.room === sp.room)) || startPhotos[0];
  }
  const preferredEnd = endPhotos.find((p) => p.room === preferredStart.room) || endPhotos[0];

  openModal({
    title: 'Porównanie stanu: Początek vs Koniec',
    wide: true,
    bodyHtml: `
      <div class="form-grid cols-2">
        <div class="field">
          <label>Zdjęcie PRZED (wydanie)</label>
          <select id="cmpLeft">
            ${startPhotos.map((p) => `<option value="${esc(p.id)}" ${p.id === preferredStart.id ? 'selected' : ''}>${esc(p.room)} (${esc(formatDatePL(p.takenAt))})</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Zdjęcie PO (zdanie / w trakcie)</label>
          <select id="cmpRight">
            ${endPhotos.map((p) => `<option value="${esc(p.id)}" ${p.id === preferredEnd.id ? 'selected' : ''}>${esc(p.room)} (${esc(formatDatePL(p.takenAt))})</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="compare-stage" id="cmpStage">
        <img id="cmpImgAfter" alt="Stan końcowy" />
        <div class="compare-before-wrap" id="cmpBeforeWrap" style="clip-path: inset(0 50% 0 0)">
          <img id="cmpImgBefore" alt="Stan początkowy" />
        </div>
        <div class="compare-divider" id="cmpDivider" style="left:50%">
          <div class="compare-handle">⇄</div>
        </div>
        <span class="compare-tag left" id="cmpTagLeft">Początek</span>
        <span class="compare-tag right" id="cmpTagRight">Koniec</span>
      </div>
      <input type="range" id="cmpSlider" class="compare-range" min="0" max="100" value="50" aria-label="Suwak porównania przed i po" />
      <div class="row-between text-xs muted">
        <span id="cmpNoteLeft"></span>
        <span id="cmpNoteRight"></span>
      </div>
    `,
    footerHtml: '<button type="button" class="btn btn-primary" id="cmpDone">Zamknij</button>',
    onMount: () => {
      document.getElementById('cmpDone').addEventListener('click', closeModal);
      const selL = document.getElementById('cmpLeft');
      const selR = document.getElementById('cmpRight');
      const stage = document.getElementById('cmpStage');
      const wrap = document.getElementById('cmpBeforeWrap');
      const divider = document.getElementById('cmpDivider');
      const slider = document.getElementById('cmpSlider');

      const setPos = (pct) => {
        const clamped = Math.max(0, Math.min(100, pct));
        wrap.style.clipPath = `inset(0 ${(100 - clamped).toFixed(1)}% 0 0)`;
        divider.style.left = `${clamped.toFixed(1)}%`;
        slider.value = String(Math.round(clamped));
      };

      const loadPair = async () => {
        const pL = photos.find((p) => p.id === selL.value);
        const pR = photos.find((p) => p.id === selR.value);
        if (pL) {
          document.getElementById('cmpImgBefore').src = (await getBlobUrl(pL.blobKey)) || '';
          document.getElementById('cmpTagLeft').textContent = `PRZED • ${formatDatePL(pL.takenAt)}`;
          document.getElementById('cmpNoteLeft').textContent = pL.note ? `Przed: ${pL.note}` : '';
        }
        if (pR) {
          document.getElementById('cmpImgAfter').src = (await getBlobUrl(pR.blobKey)) || '';
          document.getElementById('cmpTagRight').textContent = `PO • ${formatDatePL(pR.takenAt)}`;
          document.getElementById('cmpNoteRight').textContent = pR.note ? `Po: ${pR.note}` : '';
        }
      };

      selL.addEventListener('change', loadPair);
      selR.addEventListener('change', loadPair);
      slider.addEventListener('input', () => setPos(Number(slider.value)));

      let dragging = false;
      const moveFromEvent = (e) => {
        const rect = stage.getBoundingClientRect();
        const x = e.clientX - rect.left;
        setPos((x / rect.width) * 100);
      };
      stage.addEventListener('pointerdown', (e) => { dragging = true; stage.setPointerCapture(e.pointerId); moveFromEvent(e); });
      stage.addEventListener('pointermove', (e) => { if (dragging) moveFromEvent(e); });
      stage.addEventListener('pointerup', () => { dragging = false; });
      void loadPair();
    },
  });
}

export function openAddDocumentModal({ state, unit, property, lease, defaultCategory = 'umowa', saveAndRender }) {
  openModal({
    title: 'Dołącz podpisany dokument',
    bodyHtml: `
      <form id="docForm" class="stack-md">
        <div class="field">
          <label>Typ dokumentu</label>
          <select name="category">
            ${DOC_CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === defaultCategory ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Tytuł dokumentu *</label>
          <input name="title" placeholder="np. Umowa najmu 2026 — skan podpisany" required />
        </div>
        <div class="field">
          <label>Data podpisania</label>
          <input type="date" name="signedDate" value="${todayISO()}" />
        </div>
        <div class="field">
          <label>Wybierz plik (PDF, skan JPG/PNG, DOCX, Pages) *</label>
          <input type="file" id="docFile" accept=".pdf,.doc,.docx,.pages,.png,.jpg,.jpeg,.heic,.txt,application/pdf,image/*" required />
          <span class="field-hint">Na iPhonie możesz najpierw zeskanować papierowy dokument w aplikacji <em>Pliki</em> (⋯ → Skanuj dokumenty), a potem dodać gotowy PDF tutaj.</span>
        </div>
        <div class="field"><label>Uwagi</label><input name="note" placeholder="Opcjonalnie…" /></div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn" id="dfCancel">Anuluj</button>
      <button type="button" class="btn btn-primary" id="dfSave">Zapisz dokument</button>
    `,
    onMount: () => {
      const f = document.getElementById('docForm');
      const fileEl = document.getElementById('docFile');
      fileEl.addEventListener('change', () => {
        if (fileEl.files?.[0] && !f.title.value.trim()) {
          f.title.value = fileEl.files[0].name.replace(/\.[^.]+$/, '');
        }
      });
      document.getElementById('dfCancel').addEventListener('click', closeModal);
      document.getElementById('dfSave').addEventListener('click', async () => {
        const file = fileEl.files?.[0];
        if (!file) { showToast('Wybierz plik z urządzenia.'); return; }
        const title = f.title.value.trim() || file.name;
        const id = uid('doc');
        const blobKey = `doc_${id}`;
        await putBlob(blobKey, file);
        state.documents.push({
          id,
          unitId: unit.id,
          leaseId: lease.id,
          category: f.category.value,
          title,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          blobKey,
          size: file.size,
          signedDate: f.signedDate.value || todayISO(),
          note: f.note.value.trim(),
          createdAt: new Date().toISOString(),
          deletedAt: null,
        });
        appendAudit(state, 'Dodano dokument', `${property.name} / ${unit.name}: ${title}`);
        await saveAndRender();
        closeModal();
        showToast('Dokument został zapisany.');
      });
    },
  });
}

export async function openDocumentPreviewModal({ doc, canEdit, onDelete, label = 'Dokument' }) {
  const blob = await getBlob(doc.blobKey);
  const url = blob ? await getBlobUrl(doc.blobKey) : null;
  const isPdf = (doc.mimeType || '').includes('pdf') || /\.pdf$/i.test(doc.fileName || '');
  const isImg = (doc.mimeType || '').startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(doc.fileName || '');

  let previewHtml = `<div class="empty-state"><strong>${esc(doc.fileName)}</strong>Podgląd bezpośredni jest dostępny dla plików PDF i zdjęć. Kliknij „Pobierz / Udostępnij”, aby otworzyć plik w Wordzie, Pages lub systemowej przeglądarce.</div>`;
  if (url && isPdf) {
    previewHtml = `<iframe src="${url}" class="pdf-frame" title="${esc(doc.title)}"></iframe>
      <p class="muted text-xs" style="margin:0">Jeśli podgląd PDF nie wyświetla się w mobilnym Safari, kliknij „Otwórz w nowej karcie” lub „Udostępnij / Pobierz”.</p>`;
  } else if (url && isImg) {
    previewHtml = `<img src="${url}" alt="${esc(doc.title)}" class="img-preview" />`;
  }

  openModal({
    title: doc.title || label,
    wide: true,
    bodyHtml: `
      ${previewHtml}
      <div class="row-between text-xs muted">
        <span>Plik: <strong>${esc(doc.fileName)}</strong> (${esc(formatBytes(doc.size))})</span>
        ${doc.signedDate ? `<span>Data: ${esc(formatDatePL(doc.signedDate))}</span>` : ''}
      </div>
      ${doc.note ? `<div class="text-sm muted">${esc(doc.note)}</div>` : ''}
    `,
    footerHtml: `
      ${canEdit && onDelete ? `<button type="button" class="btn btn-danger btn-sm" id="dvDel">${icon('trash', 14)} Do kosza</button>` : ''}
      ${url && isPdf ? `<a href="${url}" target="_blank" rel="noopener" class="btn btn-sm">Otwórz w nowej karcie</a>` : ''}
      <button type="button" class="btn btn-primary btn-sm" id="dvShare">${icon('download', 14)} Pobierz / Udostępnij</button>
    `,
    onMount: () => {
      document.getElementById('dvShare').addEventListener('click', async () => {
        if (!blob) { showToast('Nie znaleziono pliku.'); return; }
        await shareOrDownloadBlob(blob, doc.fileName || 'dokument.pdf', doc.title);
      });
      const del = document.getElementById('dvDel');
      if (del && onDelete) {
        del.addEventListener('click', () => {
          closeModal();
          onDelete(doc);
        });
      }
    },
  });
}

export function openAddTemplateModal({ state, existing = null, saveAndRender }) {
  const isEdit = !!existing;
  openModal({
    title: isEdit ? 'Podmień / edytuj szablon in blanco' : 'Dodaj własny szablon in blanco',
    bodyHtml: `
      <form id="tplForm" class="stack-md">
        <div class="field">
          <label>Kategoria szablonu</label>
          <select name="category">
            ${TEMPLATE_CATEGORIES.map((c) => `<option value="${c.id}" ${existing?.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Nazwa szablonu *</label><input name="title" value="${esc(existing?.title || '')}" placeholder="np. Umowa najmu okazjonalnego (wzór 2026)" required /></div>
        <div class="field"><label>Opis</label><input name="desc" value="${esc(existing?.description || '')}" placeholder="Krótka notatka, kiedy używać tego wzoru…" /></div>
        <div class="field">
          <label>${isEdit ? 'Podmień plik (opcjonalnie)' : 'Plik szablonu (PDF, DOCX, DOC, Pages, ODT) *'}</label>
          <input type="file" id="tplFile" accept=".pdf,.doc,.docx,.pages,.odt,.rtf,.txt,application/pdf" ${isEdit ? '' : 'required'} />
        </div>
      </form>
    `,
    footerHtml: `
      <button type="button" class="btn" id="tfCancel">Anuluj</button>
      <button type="button" class="btn btn-primary" id="tfSave">${isEdit ? 'Zapisz zmiany' : 'Dodaj do biblioteki'}</button>
    `,
    onMount: () => {
      const f = document.getElementById('tplForm');
      const fileEl = document.getElementById('tplFile');
      fileEl.addEventListener('change', () => {
        if (fileEl.files?.[0] && !f.title.value.trim()) f.title.value = fileEl.files[0].name.replace(/\.[^.]+$/, '');
      });
      document.getElementById('tfCancel').addEventListener('click', closeModal);
      document.getElementById('tfSave').addEventListener('click', async () => {
        const file = fileEl.files?.[0];
        if (!isEdit && !file) { showToast('Wybierz plik szablonu.'); return; }
        const title = f.title.value.trim() || file?.name || existing?.title;
        if (isEdit) {
          existing.category = f.category.value;
          existing.title = title;
          existing.description = f.desc.value.trim();
          existing.updatedAt = todayISO();
          if (file) {
            const key = `tpl_${uid('f')}`;
            await putBlob(key, file);
            existing.blobKey = key;
            existing.fileName = file.name;
            existing.mimeType = file.type || 'application/octet-stream';
            existing.size = file.size;
          }
          appendAudit(state, 'Zaktualizowano szablon', title);
        } else {
          const id = uid('tpl');
          const key = `tpl_${id}`;
          await putBlob(key, file);
          state.templates.push({
            id,
            category: f.category.value,
            title,
            description: f.desc.value.trim(),
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            blobKey: key,
            size: file.size,
            updatedAt: todayISO(),
            deletedAt: null,
          });
          appendAudit(state, 'Dodano szablon in blanco', `${title} (${file.name})`);
        }
        await saveAndRender();
        closeModal();
        showToast('Zapisano szablon.');
      });
    },
  });
}

// 4-step Smart Tenant Turnover Wizard
export function openTurnoverWizard({ state, property, unit, oldLease, saveAndRender, onDone }) {
  const oldPhotosEnd = state.photos.filter((p) => !p.deletedAt && p.leaseId === oldLease.id && p.stage === 'end');
  const wiz = {
    step: 1,
    handoverDate: todayISO(),
    endMeters: {
      prad: oldLease.endMeters?.prad || '',
      woda: oldLease.endMeters?.woda || '',
      gaz: oldLease.endMeters?.gaz || '',
      cieplo: oldLease.endMeters?.cieplo || '',
    },
    depositOutcome: 'returned',
    depositReturned: oldLease.depositAmount || 0,
    depositNote: '',
    exitProtocolFile: null,
    exitPhotoFiles: [],
    mode: 'new_tenant', // 'new_tenant' | 'vacant'
    carryMeters: true,
    carryInventory: true,
    carryPhotoIds: oldPhotosEnd.map((p) => p.id),
    newTenant: { name: '', phone: '', email: '', address: '', emergencyContact: '', bankAccount: '', notes: '' },
    newStartDate: todayISO(),
    newEndDate: '',
    newIndefinite: false,
    newRent: oldLease.monthlyRent || 0,
    newMedia: oldLease.monthlyUtilities || 0,
    newDeposit: oldLease.depositAmount || 0,
    newDepositPaid: false,
    newPayDay: oldLease.paymentDay || 10,
    newNoticeDays: oldLease.noticePeriodDays || 30,
    genCurrentPay: true,
  };

  const renderStep = () => {
    const stepsTotal = wiz.mode === 'vacant' && wiz.step === 3 ? 3 : 4;
    const dots = [1, 2, 3, 4].map((n) =>
      `<div class="step-dot ${n < wiz.step ? 'done' : n === wiz.step ? 'active' : ''}"></div>`
    ).join('');

    let body = `<div class="stepper" style="margin-bottom:4px">${dots}</div>`;
    let footer = '';

    if (wiz.step === 1) {
      body += `
        <div>
          <div class="section-title">Krok 1/4: Zamknięcie umowy — ${esc(oldLease.tenant?.name)}</div>
          <p class="section-sub">Stara umowa nie zostanie skasowana — trafi wraz z dokumentami, zdjęciami i przychodami do archiwum lokalu.</p>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Faktyczna data zdania lokalu</label><input type="date" id="twDate" value="${esc(wiz.handoverDate)}" /></div>
          <div class="field"><label>Rozliczenie kaucji (${esc(formatPLN(oldLease.depositAmount))})</label>
            <select id="twDepOut">
              <option value="returned" ${wiz.depositOutcome === 'returned' ? 'selected' : ''}>Zwrot pełnej kaucji</option>
              <option value="partial" ${wiz.depositOutcome === 'partial' ? 'selected' : ''}>Zwrot częściowy (potrącenie)</option>
              <option value="retained" ${wiz.depositOutcome === 'retained' ? 'selected' : ''}>Zatrzymanie całej kaucji</option>
            </select>
          </div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Kwota zwracana najemcy (zł)</label><input type="number" step="0.01" id="twDepAmt" value="${esc(wiz.depositReturned)}" /></div>
          <div class="field"><label>Powód ewentualnego potrącenia / uwagi</label><input id="twDepNote" value="${esc(wiz.depositNote)}" placeholder="np. rozliczenie wody, naprawa…" /></div>
        </div>
        <div class="section-title" style="font-size:13.5px;margin-top:4px">Odczyty liczników przy zdaniu</div>
        <div class="form-grid cols-2">
          <div class="field"><label>Prąd (start: ${esc(oldLease.startMeters?.prad || '—')})</label><input id="twMPrad" value="${esc(wiz.endMeters.prad)}" placeholder="np. 5120 kWh" /></div>
          <div class="field"><label>Woda (start: ${esc(oldLease.startMeters?.woda || '—')})</label><input id="twMWoda" value="${esc(wiz.endMeters.woda)}" placeholder="np. 192,3 m³" /></div>
          <div class="field"><label>Gaz (start: ${esc(oldLease.startMeters?.gaz || '—')})</label><input id="twMGaz" value="${esc(wiz.endMeters.gaz)}" /></div>
          <div class="field"><label>Ciepło (start: ${esc(oldLease.startMeters?.cieplo || '—')})</label><input id="twMCieplo" value="${esc(wiz.endMeters.cieplo)}" /></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field">
            <label>Zdjęcia końcowe (opcjonalnie)</label>
            <input type="file" id="twExitPhotos" accept="image/*" multiple />
            <span class="field-hint">${wiz.exitPhotoFiles.length ? `Wybrano ${wiz.exitPhotoFiles.length} szt.` : `Aktualnie zapisanych w umowie: ${oldPhotosEnd.length} szt.`}</span>
          </div>
          <div class="field">
            <label>Protokół zdania (PDF / skan)</label>
            <input type="file" id="twExitProto" accept=".pdf,.doc,.docx,image/*" />
            <span class="field-hint">${wiz.exitProtocolFile ? esc(wiz.exitProtocolFile.name) : 'Możesz też dołączyć później.'}</span>
          </div>
        </div>
      `;
      footer = `
        <button type="button" class="btn" id="twCancel">Anuluj</button>
        <button type="button" class="btn btn-primary" id="twNext">Dalej →</button>
      `;
    } else if (wiz.step === 2) {
      body += `
        <div>
          <div class="section-title">Krok 2/4: Co dalej z lokalem „${esc(unit.name)}”?</div>
          <p class="section-sub">Czy masz już kolejnego najemcę, czy na razie zostawiasz lokal jako pustostan?</p>
        </div>
        <div class="stack-sm">
          <label class="card card-tight card-interactive" style="display:flex;gap:10px;align-items:flex-start;border-color:${wiz.mode === 'new_tenant' ? 'var(--primary)' : 'var(--border)'}">
            <input type="radio" name="twMode" value="new_tenant" ${wiz.mode === 'new_tenant' ? 'checked' : ''} style="margin-top:3px" />
            <div>
              <strong>Dodaj od razu nowego najemcę i umowę</strong>
              <div class="muted text-sm">Automatycznie przeniesiemy stany liczników i listę wyposażenia. Opcjonalnie przeniesiesz też zdjęcia ze zdania jako stan początkowy.</div>
            </div>
          </label>
          <label class="card card-tight card-interactive" style="display:flex;gap:10px;align-items:flex-start;border-color:${wiz.mode === 'vacant' ? 'var(--primary)' : 'var(--border)'}">
            <input type="radio" name="twMode" value="vacant" ${wiz.mode === 'vacant' ? 'checked' : ''} style="margin-top:3px" />
            <div>
              <strong>Zostaw jako pustostan (nowa umowa później)</strong>
              <div class="muted text-sm">Zarchiwizuje obecną umowę i zmieni status lokalu na <em>Pustostan</em>. Nowego najemcę dodasz później jednym kliknięciem.</div>
            </div>
          </label>
        </div>
      `;
      footer = `
        <button type="button" class="btn" id="twPrev">← Wstecz</button>
        <button type="button" class="btn btn-primary" id="twNext">Dalej →</button>
      `;
    } else if (wiz.step === 3 && wiz.mode === 'new_tenant') {
      body += `
        <div>
          <div class="section-title">Krok 3/4: Nowy najemca i warunki umowy</div>
          <p class="section-sub">Domyślnie podstawiono dotychczasowe stawki — możesz je od razu zaktualizować.</p>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Imię i nazwisko / firma *</label><input id="tnName" value="${esc(wiz.newTenant.name)}" placeholder="np. Anna Nowak" /></div>
          <div class="field"><label>Telefon</label><input id="tnPhone" type="tel" value="${esc(wiz.newTenant.phone)}" placeholder="+48 …" /></div>
          <div class="field"><label>E-mail</label><input id="tnEmail" type="email" value="${esc(wiz.newTenant.email)}" /></div>
          <div class="field"><label>Kontakt zapasowy</label><input id="tnEmerg" value="${esc(wiz.newTenant.emergencyContact)}" /></div>
        </div>
        <div class="form-grid cols-2">
          <div class="field"><label>Początek nowej umowy *</label><input type="date" id="tnStart" value="${esc(wiz.newStartDate)}" /></div>
          <div class="field"><label>Koniec nowej umowy</label><input type="date" id="tnEnd" value="${esc(wiz.newEndDate)}" ${wiz.newIndefinite ? 'disabled' : ''} /></div>
        </div>
        <label class="field-check"><input type="checkbox" id="tnIndef" ${wiz.newIndefinite ? 'checked' : ''} /> Na czas nieokreślony</label>
        <div class="form-grid cols-3">
          <div class="field"><label style="color:var(--rent-color)">Nowy czynsz najmu (zł)</label><input type="number" step="0.01" id="tnRent" value="${esc(wiz.newRent)}" /></div>
          <div class="field"><label style="color:var(--media-color)">Media / opłaty (zł)</label><input type="number" step="0.01" id="tnMedia" value="${esc(wiz.newMedia)}" /></div>
          <div class="field"><label>Kaucja (zł)</label><input type="number" step="0.01" id="tnDep" value="${esc(wiz.newDeposit)}" /></div>
        </div>
        <div class="card card-tight stack-sm" style="background:var(--surface-2)">
          <strong class="text-sm">Przenoszenie danych z poprzedniej umowy:</strong>
          <label class="field-check"><input type="checkbox" id="tnCarryM" ${wiz.carryMeters ? 'checked' : ''} /> Przenieś odczyty liczników ze zdania jako stany początkowe</label>
          <label class="field-check"><input type="checkbox" id="tnCarryI" ${wiz.carryInventory ? 'checked' : ''} /> Przenieś opis wyposażenia / zawartości mieszkania</label>
          <label class="field-check"><input type="checkbox" id="tnGenPay" ${wiz.genCurrentPay ? 'checked' : ''} /> Wygeneruj wpłatę od miesiąca startu nowej umowy (z ew. proporcją za dni)</label>
          ${oldPhotosEnd.length ? `
            <div class="text-xs muted">Zdjęcia ze zdania lokalu (${oldPhotosEnd.length} szt.) — zaznacz, które skopiować jako start nowego najmu:</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${oldPhotosEnd.map((p) => `
                <label class="field-check text-xs">
                  <input type="checkbox" class="carry-photo-cb" value="${esc(p.id)}" ${wiz.carryPhotoIds.includes(p.id) ? 'checked' : ''} />
                  ${esc(p.room)} (${esc(formatDatePL(p.takenAt))})
                </label>
              `).join('')}
            </div>` : ''}
        </div>
      `;
      footer = `
        <button type="button" class="btn" id="twPrev">← Wstecz</button>
        <button type="button" class="btn btn-primary" id="twNext">Podsumowanie →</button>
      `;
    } else {
      const oldTotal = roundMoney(oldLease.monthlyRent + oldLease.monthlyUtilities);
      const newTotal = roundMoney(Number(wiz.newRent || 0) + Number(wiz.newMedia || 0));
      const tplCount = state.templates.filter((t) => !t.deletedAt).length;
      body += `
        <div>
          <div class="section-title">Potwierdzenie zmiany najemcy</div>
          <p class="section-sub">Sprawdź podsumowanie przed wykonaniem operacji:</p>
        </div>
        <div class="diff-box">
          <div class="diff-row"><span class="muted">Lokal</span><strong>${esc(property.name)} — ${esc(unit.name)}</strong></div>
          <div class="diff-row"><span class="muted">Zamykana umowa</span><span>${esc(oldLease.tenant?.name)} → <strong>Archiwum</strong> (${esc(formatDatePL(wiz.handoverDate))})</span></div>
          <div class="diff-row"><span class="muted">Zwrot kaucji</span><span>${esc(formatPLN(wiz.depositReturned))} z ${esc(formatPLN(oldLease.depositAmount))}</span></div>
          ${wiz.mode === 'new_tenant' ? `
            <div class="diff-row"><span class="muted">Nowy najemca</span><span class="diff-new">${esc(wiz.newTenant.name)} (od ${esc(formatDatePL(wiz.newStartDate))})</span></div>
            <div class="diff-row"><span class="muted">Czynsz + Media</span><span><span class="diff-old">${esc(formatPLN(oldTotal))}</span> → <span class="diff-new">${esc(formatPLN(newTotal))}</span></span></div>
            <div class="diff-row"><span class="muted">Najem / Media</span><span>${esc(formatPLN(wiz.newRent))} / ${esc(formatPLN(wiz.newMedia))}</span></div>
          ` : `
            <div class="diff-row"><span class="muted">Nowy status lokalu</span><span class="badge badge-neutral">Pustostan</span></div>
          `}
        </div>
        ${wiz.mode === 'new_tenant' ? `
          <div class="card card-tight" style="background:var(--primary-tint);border-color:transparent">
            <div class="text-sm"><strong>Po zapisaniu pamiętaj o podpisaniu i załączeniu:</strong></div>
            <ul class="text-sm muted" style="margin:6px 0 0;padding-left:18px">
              <li>Umowy najmu</li>
              <li>Protokołu zdawczo-odbiorczego (wydania)</li>
              <li>Protokołu zawartości / wyposażenia</li>
            </ul>
            <div class="text-xs muted" style="margin-top:6px">Dostępnych wzorów <em>in blanco</em> w bibliotece: <strong>${tplCount}</strong> (zakładka Szablony).</div>
          </div>` : ''}
      `;
      footer = `
        <button type="button" class="btn" id="twPrev">← Wstecz</button>
        <button type="button" class="btn btn-primary" id="twFinish">${icon('check', 15)} Zatwierdź zmianę</button>
      `;
    }

    openModal({
      title: `Zmiana najemcy — ${unit.name}`,
      wide: true,
      bodyHtml: body,
      footerHtml: footer,
      onMount: () => {
        const cancel = document.getElementById('twCancel');
        if (cancel) cancel.addEventListener('click', closeModal);
        const prev = document.getElementById('twPrev');
        if (prev) prev.addEventListener('click', () => {
          if (wiz.step === 4 && wiz.mode === 'vacant') wiz.step = 2;
          else wiz.step = Math.max(1, wiz.step - 1);
          renderStep();
        });
        const depSel = document.getElementById('twDepOut');
        if (depSel) {
          depSel.addEventListener('change', () => {
            const amt = document.getElementById('twDepAmt');
            if (depSel.value === 'returned') amt.value = oldLease.depositAmount || 0;
            if (depSel.value === 'retained') amt.value = 0;
          });
        }
        const phIn = document.getElementById('twExitPhotos');
        if (phIn) phIn.addEventListener('change', () => { wiz.exitPhotoFiles = Array.from(phIn.files || []); });
        const prIn = document.getElementById('twExitProto');
        if (prIn) prIn.addEventListener('change', () => { wiz.exitProtocolFile = prIn.files?.[0] || null; });
        const radios = document.querySelectorAll('input[name="twMode"]');
        radios.forEach((r) => r.addEventListener('change', () => { wiz.mode = r.value; renderStep(); }));
        const indef = document.getElementById('tnIndef');
        if (indef) indef.addEventListener('change', () => {
          document.getElementById('tnEnd').disabled = indef.checked;
        });

        const next = document.getElementById('twNext');
        if (next) next.addEventListener('click', () => {
          if (wiz.step === 1) {
            wiz.handoverDate = document.getElementById('twDate').value || todayISO();
            wiz.depositOutcome = document.getElementById('twDepOut').value;
            wiz.depositReturned = roundMoney(document.getElementById('twDepAmt').value);
            wiz.depositNote = document.getElementById('twDepNote').value.trim();
            wiz.endMeters = {
              prad: document.getElementById('twMPrad').value.trim(),
              woda: document.getElementById('twMWoda').value.trim(),
              gaz: document.getElementById('twMGaz').value.trim(),
              cieplo: document.getElementById('twMCieplo').value.trim(),
            };
            wiz.newStartDate = wiz.handoverDate;
            wiz.step = 2;
          } else if (wiz.step === 2) {
            wiz.step = wiz.mode === 'vacant' ? 4 : 3;
          } else if (wiz.step === 3) {
            const name = document.getElementById('tnName').value.trim();
            if (!name) { showToast('Podaj imię i nazwisko nowego najemcy.'); return; }
            wiz.newTenant.name = name;
            wiz.newTenant.phone = document.getElementById('tnPhone').value.trim();
            wiz.newTenant.email = document.getElementById('tnEmail').value.trim();
            wiz.newTenant.emergencyContact = document.getElementById('tnEmerg').value.trim();
            wiz.newStartDate = document.getElementById('tnStart').value || wiz.handoverDate;
            wiz.newIndefinite = document.getElementById('tnIndef').checked;
            wiz.newEndDate = wiz.newIndefinite ? '' : document.getElementById('tnEnd').value;
            if (!wiz.newIndefinite && wiz.newEndDate && wiz.newEndDate < wiz.newStartDate) {
              showToast('Data końca nie może być wcześniejsza niż data startu.');
              return;
            }
            wiz.newRent = roundMoney(document.getElementById('tnRent').value);
            wiz.newMedia = roundMoney(document.getElementById('tnMedia').value);
            wiz.newDeposit = roundMoney(document.getElementById('tnDep').value);
            wiz.carryMeters = document.getElementById('tnCarryM').checked;
            wiz.carryInventory = document.getElementById('tnCarryI').checked;
            wiz.genCurrentPay = document.getElementById('tnGenPay').checked;
            wiz.carryPhotoIds = Array.from(document.querySelectorAll('.carry-photo-cb:checked')).map((el) => el.value);
            wiz.step = 4;
          }
          renderStep();
        });

        const finish = document.getElementById('twFinish');
        if (finish) finish.addEventListener('click', async () => {
          finish.disabled = true;
          finish.textContent = 'Zapisywanie…';
          try {
            const newExitPhotoIds = [];
            for (const file of wiz.exitPhotoFiles) {
              const { mainBlob, thumbBlob, fileName, mimeType } = await processPhotoFile(file, state.settings.compressPhotos);
              const pid = uid('photo');
              const blobKey = `blob_${pid}`;
              const thumbKey = thumbBlob ? `thumb_${pid}` : null;
              await putBlob(blobKey, mainBlob);
              if (thumbKey) await putBlob(thumbKey, thumbBlob);
              state.photos.push({
                id: pid, unitId: unit.id, leaseId: oldLease.id, stage: 'end',
                room: 'Lokal — widok ogólny', takenAt: wiz.handoverDate,
                note: 'Zdjęcie przy zdaniu lokalu (kreator zmiany najemcy)',
                fileName, mimeType, blobKey, thumbKey, size: mainBlob.size,
                createdAt: new Date().toISOString(), deletedAt: null,
              });
              newExitPhotoIds.push(pid);
            }
            if (wiz.exitProtocolFile) {
              const did = uid('doc');
              const blobKey = `doc_${did}`;
              await putBlob(blobKey, wiz.exitProtocolFile);
              state.documents.push({
                id: did, unitId: unit.id, leaseId: oldLease.id, category: 'protokol_zdania',
                title: `Protokół zdania — ${oldLease.tenant?.name}`,
                fileName: wiz.exitProtocolFile.name,
                mimeType: wiz.exitProtocolFile.type || 'application/pdf',
                blobKey, size: wiz.exitProtocolFile.size,
                signedDate: wiz.handoverDate, note: 'Dołączony podczas zmiany najemcy.',
                createdAt: new Date().toISOString(), deletedAt: null,
              });
            }
            const res = performTenantTurnover(state, {
              unitId: unit.id,
              oldLeaseId: oldLease.id,
              handoverDate: wiz.handoverDate,
              endMeters: wiz.endMeters,
              depositOutcome: wiz.depositOutcome,
              depositReturnedAmount: wiz.depositReturned,
              depositNote: wiz.depositNote,
              createNewLease: wiz.mode === 'new_tenant',
              carryMeters: wiz.carryMeters,
              carryInventory: wiz.carryInventory,
              carryPhotoIds: [...wiz.carryPhotoIds, ...newExitPhotoIds],
              newLeaseData: wiz.mode === 'new_tenant' ? {
                tenant: wiz.newTenant,
                startDate: wiz.newStartDate,
                endDate: wiz.newEndDate,
                isIndefinite: wiz.newIndefinite,
                monthlyRent: wiz.newRent,
                monthlyUtilities: wiz.newMedia,
                depositAmount: wiz.newDeposit,
                depositPaid: wiz.newDepositPaid,
                paymentDay: wiz.newPayDay,
                noticePeriodDays: wiz.newNoticeDays,
              } : null,
            });
            if (res.createdLease && wiz.genCurrentPay) {
              const generated = generateLeasePayments(res.createdLease, {
                mode: 'all_to_now',
                markPastPaid: false,
                prorateFirst: true,
              });
              for (const gp of generated) state.payments.push(gp);
            }
            appendAudit(
              state,
              wiz.mode === 'new_tenant' ? 'Zmiana najemcy' : 'Zakończono najem (pustostan)',
              `${property.name} / ${unit.name}: ${oldLease.tenant?.name} → ${res.createdLease ? res.createdLease.tenant.name : 'Pustostan'}`
            );
            await saveAndRender();
            closeModal();
            if (onDone) onDone(res);
            showToast(wiz.mode === 'new_tenant' ? 'Poprzednia umowa zarchiwizowana, nowa jest aktywna!' : 'Umowa zarchiwizowana. Lokal oznaczono jako pustostan.');
          } catch (err) {
            finish.disabled = false;
            finish.textContent = 'Zatwierdź zmianę';
            showToast(`Błąd: ${err.message}`);
          }
        });
      },
    });
  };
  void stepsTotal;
  renderStep();
}

export async function openImportZipModal({ file, onRestored }) {
  try {
    const buf = await file.arrayBuffer();
    const { parsed, map } = await inspectBackupZip(buf);
    const s = parsed.state;
    const isRO = !!s.readOnlySnapshot;
    const propCount = (s.properties || []).filter((p) => !p.deletedAt).length;
    const unitCount = (s.units || []).filter((u) => !u.deletedAt).length;
    const payCount = (s.payments || []).filter((p) => !p.deletedAt).length;
    const photoCount = (s.photos || []).filter((p) => !p.deletedAt).length;
    const docCount = (s.documents || []).filter((d) => !d.deletedAt).length;
    const tplCount = (s.templates || []).filter((t) => !t.deletedAt).length;

    openModal({
      title: isRO ? 'Wczytać migawkę (tylko do odczytu)?' : 'Przywrócić kopię zapasową (.zip)?',
      bodyHtml: `
        <p style="margin:0;font-size:14px">Zastąpi to bieżące dane zapisane w tej przeglądarce zawartością pliku <strong>${esc(file.name)}</strong>.</p>
        <div class="diff-box">
          <div class="diff-row"><span class="muted">Data eksportu</span><strong>${esc(formatDatePL(parsed.exportedAt?.slice(0, 10)))}</strong></div>
          <div class="diff-row"><span class="muted">Tryb archiwum</span><strong>${isRO ? 'Migawka tylko do odczytu 🔒' : 'Pełna kopia edytowalna'}</strong></div>
          <div class="diff-row"><span class="muted">Nieruchomości / lokale</span><strong>${propCount} / ${unitCount}</strong></div>
          <div class="diff-row"><span class="muted">Wpłaty / zdjęcia</span><strong>${payCount} / ${photoCount}</strong></div>
          <div class="diff-row"><span class="muted">Dokumenty / szablony</span><strong>${docCount} / ${tplCount}</strong></div>
        </div>
      `,
      footerHtml: `
        <button type="button" class="btn" id="impCancel">Anuluj</button>
        <button type="button" class="btn btn-primary" id="impOk">Wczytaj dane</button>
      `,
      onMount: () => {
        document.getElementById('impCancel').addEventListener('click', closeModal);
        document.getElementById('impOk').addEventListener('click', async () => {
          const btn = document.getElementById('impOk');
          btn.disabled = true;
          btn.textContent = 'Przywracanie…';
          clearUrlCache();
          const newState = await restoreBackupZip(parsed, map);
          closeModal();
          await onRestored(newState);
          showToast('Pomyślnie wczytano archiwum ZIP.');
        });
      },
    });
  } catch (err) {
    showToast(`Nie udało się odczytać ZIP: ${err.message}`, 4200);
  }
}

export async function openArchiveLeaseModal({ state, lease, property, unit }) {
  const photos = state.photos.filter((p) => !p.deletedAt && p.leaseId === lease.id);
  const docs = state.documents.filter((d) => !d.deletedAt && d.leaseId === lease.id);
  const pays = state.payments.filter((p) => !p.deletedAt && p.leaseId === lease.id).sort((a, b) => b.month.localeCompare(a.month));
  const rentSum = pays.reduce((a, b) => a + (Number(b.rentAmount) || 0), 0);
  const mediaSum = pays.reduce((a, b) => a + getEffectiveMediaAmount(b), 0);
  const hasCompare = photos.some((p) => p.stage === 'start') && photos.some((p) => p.stage === 'end' || p.stage === 'during');

  openModal({
    title: `Archiwum: ${lease.tenant?.name || 'Poprzedni najemca'}`,
    wide: true,
    bodyHtml: `
      <div class="kv-grid">
        <div><div class="kv-label">Lokal</div><div class="kv-val">${esc(property.name)} / ${esc(unit.name)}</div></div>
        <div><div class="kv-label">Okres najmu</div><div class="kv-val">${esc(formatDatePL(lease.startDate))} – ${esc(formatDatePL(lease.endDate))}</div></div>
        <div><div class="kv-label">Przychód łączny (${pays.length} wp.)</div><div class="kv-val num">${esc(formatPLN(rentSum + mediaSum))}</div></div>
        <div><div class="kv-label">Najem / Media</div><div class="kv-val num"><span class="text-rent">${esc(formatPLN(rentSum))}</span> / <span class="text-media">${esc(formatPLN(mediaSum))}</span></div></div>
      </div>
      ${(lease.tenant?.phone || lease.tenant?.email || lease.tenant?.bankAccount) ? `
        <div class="card card-tight stack-sm" style="background:var(--surface-2)">
          <div class="text-xs muted"><strong>Dane kontaktowe najemcy:</strong> ${esc(lease.tenant.phone || '—')}${lease.tenant.email ? ` • ${esc(lease.tenant.email)}` : ''}${lease.tenant.address ? ` • ${esc(lease.tenant.address)}` : ''}</div>
          ${lease.tenant.bankAccount ? `<div class="text-xs muted">Konto do zwrotu kaucji: <strong>${esc(lease.tenant.bankAccount)}</strong></div>` : ''}
          ${lease.tenant.notes ? `<div class="text-xs muted">${esc(lease.tenant.notes)}</div>` : ''}
        </div>` : ''}
      ${lease.depositSettlement ? `
        <div class="card card-tight" style="background:var(--surface-2)">
          <div class="text-sm"><strong>Rozliczenie kaucji (${esc(formatPLN(lease.depositAmount))}):</strong> zwrócono <strong>${esc(formatPLN(lease.depositSettlement.returnedAmount))}</strong>${lease.depositSettlement.deductedAmount > 0 ? `, potrącono <strong class="text-danger">${esc(formatPLN(lease.depositSettlement.deductedAmount))}</strong>` : ''}</div>
          ${lease.depositSettlement.note ? `<div class="text-xs muted" style="margin-top:3px">${esc(lease.depositSettlement.note)}</div>` : ''}
        </div>` : ''}
      ${(lease.startMeters?.prad || lease.endMeters?.prad || lease.startMeters?.woda || lease.endMeters?.woda || lease.startMeters?.gaz || lease.endMeters?.gaz) ? `
        <div class="kv-grid text-xs">
          <div><div class="kv-label">Prąd (start → koniec)</div><div class="kv-val text-xs">${esc(lease.startMeters?.prad || '—')} → ${esc(lease.endMeters?.prad || '—')}</div></div>
          <div><div class="kv-label">Woda (start → koniec)</div><div class="kv-val text-xs">${esc(lease.startMeters?.woda || '—')} → ${esc(lease.endMeters?.woda || '—')}</div></div>
          <div><div class="kv-label">Gaz (start → koniec)</div><div class="kv-val text-xs">${esc(lease.startMeters?.gaz || '—')} → ${esc(lease.endMeters?.gaz || '—')}</div></div>
          <div><div class="kv-label">Ciepło (start → koniec)</div><div class="kv-val text-xs">${esc(lease.startMeters?.cieplo || '—')} → ${esc(lease.endMeters?.cieplo || '—')}</div></div>
        </div>` : ''}
      <details class="card card-flush" ${pays.length ? 'open' : ''}>
        <summary class="prop-head" style="cursor:pointer;padding:10px 14px;background:var(--surface-2);list-style:none">
          <strong class="text-sm">Historia wpłat (${pays.length}) — suma: <span class="num">${esc(formatPLN(rentSum + mediaSum))}</span></strong>
          <span class="text-xs muted num">Najem <span class="text-rent">${esc(formatPLN(rentSum))}</span> + Media <span class="text-media">${esc(formatPLN(mediaSum))}</span></span>
        </summary>
        ${pays.length ? `
          <div class="table-wrap" style="max-height:240px;overflow-y:auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Miesiąc</th>
                  <th>Data wpłaty</th>
                  <th class="r">Najem</th>
                  <th class="r">Media</th>
                  <th class="r">Razem</th>
                </tr>
              </thead>
              <tbody>
                ${pays.map((p) => {
                  const media = getEffectiveMediaAmount(p);
                  const inst = Array.isArray(p.installments) ? p.installments : [];
                  const dateTxt = p.status === 'paid'
                    ? (inst.length > 1
                      ? inst.map((it) => `${formatDatePL(it.date)} (${formatPLN(it.amount)})`).join(', ')
                      : (p.paidDate ? formatDatePL(p.paidDate) : 'Opłacone'))
                    : (p.status === 'partial'
                      ? `Część: ${formatPLN(getPaymentBalance(p).paid)}`
                      : 'Nieopłacone');
                  return `<tr>
                    <td><strong>${esc(formatMonthShort(p.month))}</strong>${p.note ? `<div class="text-xs muted">${esc(p.note)}</div>` : ''}</td>
                    <td class="text-xs muted">${esc(dateTxt)}</td>
                    <td class="r num text-rent">${esc(formatPLN(p.rentAmount))}</td>
                    <td class="r num text-media">${esc(formatPLN(media))}</td>
                    <td class="r num fw-700">${esc(formatPLN((Number(p.rentAmount) || 0) + media))}</td>
                  </tr>`;
                }).join('')}
                <tr class="row-total">
                  <td colspan="2">SUMA (${pays.length})</td>
                  <td class="r num text-rent">${esc(formatPLN(rentSum))}</td>
                  <td class="r num text-media">${esc(formatPLN(mediaSum))}</td>
                  <td class="r num">${esc(formatPLN(rentSum + mediaSum))}</td>
                </tr>
              </tbody>
            </table>
          </div>` : '<div class="empty-state" style="padding:14px">Brak zapisanych wpłat w tej umowie.</div>'}
      </details>
      <div class="row-between">
        <strong class="text-sm">Zdjęcia stanu (${photos.length})</strong>
        ${hasCompare ? `<button type="button" class="btn btn-soft btn-xs" id="archCmp">${icon('compare', 13)} Porównaj przed / po</button>` : ''}
      </div>
      ${photos.length ? `
        <div class="photo-grid" id="archPhotos">
          ${photos.map((p) => `
            <div class="photo-card">
              <div class="photo-thumb-wrap" data-arch-photo="${esc(p.id)}">
                <img data-blob-key="${esc(p.thumbKey || p.blobKey)}" alt="${esc(p.room)}" />
                <span class="photo-stage-tag">${p.stage === 'start' ? 'Początek' : p.stage === 'end' ? 'Koniec' : 'W trakcie'}</span>
              </div>
              <div class="photo-meta">
                <span class="photo-room">${esc(p.room)}</span>
                <span class="photo-note">${esc(formatDatePL(p.takenAt))}</span>
              </div>
            </div>`).join('')}
        </div>` : '<div class="muted text-sm">Brak zdjęć w tej umowie.</div>'}
      <strong class="text-sm">Dokumenty (${docs.length})</strong>
      ${docs.length ? `
        <div class="card card-flush">
          ${docs.map((d) => `
            <div class="doc-row">
              <div class="doc-info">
                <div class="doc-title">${esc(d.title)}</div>
                <div class="doc-sub">${esc(d.fileName)} • ${esc(formatDatePL(d.signedDate))}</div>
              </div>
              <button type="button" class="btn btn-xs" data-arch-doc="${esc(d.id)}">Podgląd</button>
            </div>`).join('')}
        </div>` : '<div class="muted text-sm">Brak zapisanych dokumentów.</div>'}
    `,
    footerHtml: `${pays.length ? `<button type="button" class="btn btn-sm" id="archCsv">${icon('download', 13)} Eksport wpłat CSV</button>` : ''}<button type="button" class="btn btn-primary" id="archClose">Zamknij</button>`,
    onMount: (root) => {
      void hydrateImages(root);
      document.getElementById('archClose').addEventListener('click', closeModal);
      document.getElementById('archCsv')?.addEventListener('click', async () => {
        const csv = exportPaymentsCsv(state, { period: 'all', leaseId: lease.id });
        const safe = (lease.tenant?.name || 'archiwum').replace(/[^a-z0-9]/gi, '_');
        await shareOrDownloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `wplaty_${safe}.csv`, 'Historia wpłat');
      });
      const cmp = document.getElementById('archCmp');
      if (cmp) cmp.addEventListener('click', () => { void openComparePhotosModal({ photos }); });
      root.querySelectorAll('[data-arch-photo]').forEach((el) => {
        el.addEventListener('click', () => {
          const p = photos.find((x) => x.id === el.dataset.archPhoto);
          if (p) void openPhotoViewerModal({ photo: p, canEdit: false });
        });
      });
      root.querySelectorAll('[data-arch-doc]').forEach((el) => {
        el.addEventListener('click', () => {
          const d = docs.find((x) => x.id === el.dataset.archDoc);
          if (d) void openDocumentPreviewModal({ doc: d, canEdit: false });
        });
      });
    },
  });
}
