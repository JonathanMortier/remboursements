/** Outils image : chargement, compression pour l'envoi, pré-traitement pour l'OCR. */

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode(); // l'orientation EXIF est appliquée par le navigateur
    return img;
  } finally {
    // L'image décodée reste utilisable après révocation.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function drawScaled(img: HTMLImageElement, maxSide: number, minWidth = 0): HTMLCanvasElement {
  let scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  if (minWidth && img.naturalWidth * scale < minWidth) scale = minWidth / img.naturalWidth;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** JPEG ~1200 px, qualité 0.7, renvoyé en base64 sans préfixe (≈ 100–200 Ko). */
export function compressForUpload(img: HTMLImageElement): string {
  const canvas = drawScaled(img, 1200);
  return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
}

/** Niveaux de gris + étirement de contraste : aide beaucoup sur les tickets thermiques pâles. */
export function preprocessForOcr(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = drawScaled(img, 2000, 1000);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const gray = new Uint8ClampedArray(px.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    gray[j] = g;
    hist[gray[j]]++;
  }
  // Percentiles 2 % / 98 % pour ignorer les extrêmes (ombres, reflets).
  const total = gray.length;
  let lo = 0;
  let hi = 255;
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc > total * 0.02) { lo = v; break; }
  }
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc > total * 0.02) { hi = v; break; }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = ((gray[j] - lo) * 255) / range;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}
