// IndexedDB storage wrapper separating fast JSON state from large binary blobs (photos/PDFs/DOCX).
import { buildZip, parseZip, sanitizePathSegment } from './domain.js';

const DB_NAME = 'moj_najem_db';
const DB_VERSION = 1;
const STORE_STATE = 'state';
const STORE_BLOBS = 'blobs';
const STATE_KEY = 'app_state';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Przeglądarka nie udostępnia IndexedDB (sprawdź tryb prywatny).'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Przekroczono czas otwarcia bazy IndexedDB. Zamknij inne otwarte karty tej aplikacji i odśwież.'));
      }
    }, 6000);
    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE);
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
    };
    req.onblocked = () => done(reject, new Error('Baza danych jest zablokowana przez inną kartę Safari. Zamknij pozostałe karty i odśwież.'));
    req.onsuccess = () => done(resolve, req.result);
    req.onerror = () => done(reject, req.error || new Error('Błąd otwarcia IndexedDB'));
  });
}

let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

export async function loadState() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readonly');
    const req = tx.objectStore(STORE_STATE).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveState(state) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATE, 'readwrite');
    tx.objectStore(STORE_STATE).put(state, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putBlob(key, blob) {
  const db = await getDb();
  const data = blob instanceof Blob ? await blob.arrayBuffer() : (blob instanceof Uint8Array ? blob.buffer : blob);
  const type = blob instanceof Blob ? blob.type : 'application/octet-stream';
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    tx.objectStore(STORE_BLOBS).put({ data, type }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBlob(key) {
  if (!key) return null;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).get(key);
    req.onsuccess = () => {
      const rec = req.result;
      if (!rec) return resolve(null);
      resolve(new Blob([rec.data], { type: rec.type || 'application/octet-stream' }));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getBlobBytes(key) {
  if (!key) return null;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).get(key);
    req.onsuccess = () => {
      const rec = req.result;
      if (!rec) return resolve(null);
      resolve({ bytes: new Uint8Array(rec.data), type: rec.type || 'application/octet-stream' });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteBlob(key) {
  if (!key) return;
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BLOBS, 'readwrite');
    tx.objectStore(STORE_BLOBS).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllData() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STATE, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_STATE).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getStorageInfo() {
  const db = await getDb();
  const blobSummary = await new Promise((resolve) => {
    let count = 0;
    let totalBytes = 0;
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve({ count, totalBytes });
      const val = cursor.value;
      count += 1;
      if (val && val.data) totalBytes += val.data.byteLength || 0;
      cursor.continue();
    };
    req.onerror = () => resolve({ count: 0, totalBytes: 0 });
  });

  let quota = null;
  let usage = null;
  let persisted = false;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quota = est.quota ?? null;
      usage = est.usage ?? null;
    }
    if (navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted();
    }
  } catch { /* ignore unsupported */ }

  return { ...blobSummary, quota, usage, persisted };
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Exports a human-browsable ZIP archive containing data/backup.json + all real files organized in folders.
 * If options.readOnlySnapshot === true, exports a snapshot locked for viewing.
 * If options.includeAttachments === false, creates a lightweight finance-only view snapshot.
 */
export async function exportFullBackupZip(state, options = {}) {
  const { readOnlySnapshot = false, includeAttachments = true } = options;
  const clone = JSON.parse(JSON.stringify(state));
  const nowIso = new Date().toISOString();

  if (readOnlySnapshot) {
    clone.readOnlySnapshot = {
      exportedAt: nowIso,
      financeOnly: !includeAttachments,
    };
    if (!includeAttachments) {
      clone.photos = [];
      clone.documents = [];
      clone.templates = [];
      // Remove personal identity notes when sharing lightweight financial view
      for (const l of clone.leases) {
        if (l.tenant) {
          l.tenant.idInfo = '';
          l.tenant.bankAccount = '';
          l.tenant.address = '';
        }
      }
    }
  } else {
    clone.readOnlySnapshot = null;
  }

  const blobPathMap = {};
  const entries = [];
  const addedBlobKeys = new Set();
  const propMap = new Map(clone.properties.map((p) => [p.id, p]));
  const unitMap = new Map(clone.units.map((u) => [u.id, u]));

  const addFileEntry = async (blobKey, folder, rawFileName) => {
    if (!blobKey || addedBlobKeys.has(blobKey)) return;
    const rec = await getBlobBytes(blobKey);
    if (!rec) return;
    const path = `${folder}/${sanitizePathSegment(blobKey.slice(-6))}_${sanitizePathSegment(rawFileName, 'plik')}`;
    blobPathMap[blobKey] = { path, type: rec.type };
    entries.push({ name: path, data: rec.bytes });
    addedBlobKeys.add(blobKey);
  };

  if (includeAttachments) {
    for (const photo of clone.photos) {
      const unit = unitMap.get(photo.unitId);
      const prop = unit ? propMap.get(unit.propertyId) : null;
      const pName = sanitizePathSegment(prop?.name || 'Nieruchomosc');
      const uName = sanitizePathSegment(unit?.name || 'Lokal');
      const folder = `zdjecia/${pName}/${uName}/${photo.stage || 'inne'}`;
      await addFileEntry(photo.blobKey, folder, photo.fileName || `${photo.id}.jpg`);
      if (photo.thumbKey) {
        const rec = await getBlobBytes(photo.thumbKey);
        if (rec && !addedBlobKeys.has(photo.thumbKey)) {
          const tpath = `.miniatury/${sanitizePathSegment(photo.thumbKey)}.jpg`;
          blobPathMap[photo.thumbKey] = { path: tpath, type: rec.type };
          entries.push({ name: tpath, data: rec.bytes });
          addedBlobKeys.add(photo.thumbKey);
        }
      }
    }

    for (const doc of clone.documents) {
      const unit = unitMap.get(doc.unitId);
      const prop = unit ? propMap.get(unit.propertyId) : null;
      const pName = sanitizePathSegment(prop?.name || 'Nieruchomosc');
      const uName = sanitizePathSegment(unit?.name || 'Lokal');
      const folder = `dokumenty/${pName}/${uName}`;
      await addFileEntry(doc.blobKey, folder, doc.fileName || `${doc.id}.pdf`);
    }

    for (const tpl of clone.templates) {
      await addFileEntry(tpl.blobKey, 'szablony_in_blanco', tpl.fileName || `${tpl.id}.pdf`);
    }
  }

  const readme = [
    'Mój Najem — Kopia zapasowa danych',
    `Data eksportu: ${nowIso}`,
    `Typ: ${readOnlySnapshot ? 'MIGAWKA TYLKO DO ODCZYTU' : 'Pełna kopia zapasowa'}`,
    '',
    'Zawartość archiwum:',
    '- data/backup.json : baza danych (nieruchomości, lokale, umowy, wpłaty, metadane)',
    '- zdjecia/         : zdjęcia stanu mieszkań (można otwierać w zwykłej przeglądarce plików)',
    '- dokumenty/       : podpisane umowy i protokoły',
    '- szablony_in_blanco/ : wzory dokumentów do pobrania',
    '',
    'Aby przywrócić dane, otwórz aplikację „Mój Najem” → Więcej → Importuj kopię (.zip).',
  ].join('\r\n');

  const payload = {
    format: 'moj-najem-backup',
    version: 1,
    exportedAt: nowIso,
    blobIndex: blobPathMap,
    state: clone,
  };

  entries.unshift(
    { name: 'README.txt', data: readme },
    { name: 'data/backup.json', data: JSON.stringify(payload, null, 2) },
  );

  return buildZip(entries);
}

/**
 * Inspects & parses a ZIP backup without modifying live DB.
 */
export async function inspectBackupZip(fileBuffer) {
  const map = await parseZip(new Uint8Array(fileBuffer));
  const jsonBytes = map.get('data/backup.json');
  if (!jsonBytes) {
    throw new Error('W archiwum brakuje pliku data/backup.json.');
  }
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(jsonBytes));
  if (parsed?.format !== 'moj-najem-backup' || !parsed?.state) {
    throw new Error('Nieprawidłowy format pliku kopii zapasowej.');
  }
  return { parsed, map };
}

export async function restoreBackupZip(parsed, fileMap) {
  await clearAllData();
  const blobIndex = parsed.blobIndex || {};
  for (const [blobKey, info] of Object.entries(blobIndex)) {
    const bytes = fileMap.get(info.path);
    if (!bytes) continue;
    await putBlob(blobKey, new Blob([bytes], { type: info.type || 'application/octet-stream' }));
  }
  await saveState(parsed.state);
  return parsed.state;
}
