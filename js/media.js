// Media compression (Canvas resize/JPEG), thumbnails, object URL cache, share/download helpers.
import { getBlob } from './db.js';

const urlCache = new Map();

export async function getBlobUrl(key) {
  if (!key) return null;
  if (urlCache.has(key)) return urlCache.get(key);
  const blob = await getBlob(key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

export function revokeCachedUrl(key) {
  if (!key || !urlCache.has(key)) return;
  try { URL.revokeObjectURL(urlCache.get(key)); } catch { /* ignore */ }
  urlCache.delete(key);
}

export function clearUrlCache() {
  for (const url of urlCache.values()) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  urlCache.clear();
}

function loadImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err || new Error('Nie można odczytać obrazu'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Błąd zapisu obrazu'));
    }, type, quality);
  });
}

function resizeImageToCanvas(img, maxDim) {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, dw, dh);
  return canvas;
}

/**
 * Processes an uploaded photo: returns { mainBlob, thumbBlob, fileName, mimeType }.
 * Falls back gracefully to the original blob if Canvas cannot decode (e.g. exotic format).
 */
export async function processPhotoFile(file, compress = true) {
  const baseName = file.name || `zdjecie_${Date.now()}.jpg`;
  try {
    const img = await loadImage(file);
    const thumbCanvas = resizeImageToCanvas(img, 420);
    const thumbBlob = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.78);
    if (compress) {
      const mainCanvas = resizeImageToCanvas(img, 1920);
      const mainBlob = await canvasToBlob(mainCanvas, 'image/jpeg', 0.84);
      const jpgName = baseName.replace(/\.[^.]+$/, '') + '.jpg';
      return { mainBlob, thumbBlob, fileName: jpgName, mimeType: 'image/jpeg' };
    }
    return { mainBlob: file, thumbBlob, fileName: baseName, mimeType: file.type || 'image/jpeg' };
  } catch {
    return { mainBlob: file, thumbBlob: null, fileName: baseName, mimeType: file.type || 'application/octet-stream' };
  }
}

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Uses iOS / mobile native Share Sheet when available (AirDrop, Mail, Print, Files), falling back to download.
 */
export async function shareOrDownloadBlob(blob, filename, title = filename) {
  try {
    if (navigator.share && navigator.canShare) {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ title, files: [file] });
        return 'shared';
      }
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
  }
  triggerDownload(blob, filename);
  return 'downloaded';
}
