// ============================================================================
// Archivos en Google Drive (v68): miniaturas hechas en el navegador al subir.
//
// Drive tiene sus propias miniaturas, pero solo las sirve a quien entra con una
// cuenta de Google con acceso — y en Chusy nadie lo necesita —, así que al
// subir una imagen o un vídeo el navegador dibuja una miniatura JPEG pequeña
// (máx. 360 px) y se sube como un segundo archivo (`thumbId` del adjunto).
// Todo es «mejor esfuerzo»: si el formato no se puede decodificar aquí (HEIC,
// vídeos con códecs que el navegador no entiende…), no hay miniatura y la
// interfaz enseña el icono del tipo de archivo — la subida no falla por eso.
// ============================================================================
import { fileKind } from "./drive-files.js";

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("tiempo agotado")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("imagen no decodificable"));
    img.src = url;
  });
}

function drawToJpeg(source, width, height, maxSide, quality) {
  if (!width || !height) return Promise.resolve(null);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#ffffff"; // los PNG con transparencia no se quedan negros en un JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality));
}

async function imageThumb(file, maxSide, quality) {
  let bitmap = null;
  if (typeof createImageBitmap === "function") {
    try { bitmap = await createImageBitmap(file); } catch (e) { bitmap = null; }
  }
  if (bitmap) {
    try { return await drawToJpeg(bitmap, bitmap.width, bitmap.height, maxSide, quality); } finally { if (bitmap.close) bitmap.close(); }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return await drawToJpeg(img, img.naturalWidth, img.naturalHeight, maxSide, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function videoThumb(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  try {
    const ready = new Promise((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("vídeo no decodificable"));
    });
    video.src = url;
    await ready;
    const target = Math.min(1, (Number.isFinite(video.duration) ? video.duration : 1) / 10);
    if (target > 0) {
      const seeked = new Promise((resolve) => { video.onseeked = () => resolve(); });
      video.currentTime = target;
      await seeked;
    }
    return await drawToJpeg(video, video.videoWidth, video.videoHeight, maxSide, quality);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Una miniatura JPEG (Blob) de una imagen o un vídeo, o null si no se puede (o no procede). */
export async function makeThumbnailBlob(file, { maxSide = 360, quality = 0.72, timeoutMs = 8000 } = {}) {
  const kind = fileKind(file && file.type, file && file.name);
  try {
    if (kind === "image") return await withTimeout(imageThumb(file, maxSide, quality), timeoutMs);
    if (kind === "video") return await withTimeout(videoThumb(file, maxSide, quality), timeoutMs);
  } catch (e) {
    /* sin miniatura: se verá el icono del tipo de archivo */
  }
  return null;
}
