import type { Worker } from 'tesseract.js';
import { preprocessForOcr } from './image';
import { parseReceipt, type ReceiptInfo } from './parse';

let workerPromise: Promise<Worker> | null = null;
let onProgress: ((p: number, status: string) => void) | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      // Chargé à la demande : Tesseract (~quelques Mo) n'alourdit pas le démarrage.
      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('fra', 1, {
        logger: (m) => onProgress?.(m.progress ?? 0, m.status),
      });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export async function readReceipt(
  img: HTMLImageElement,
  progress?: (p: number, status: string) => void,
): Promise<ReceiptInfo & { text: string }> {
  onProgress = progress ?? null;
  try {
    const worker = await getWorker();
    const canvas = preprocessForOcr(img);
    const { data } = await worker.recognize(canvas);
    return { ...parseReceipt(data.text), text: data.text };
  } finally {
    onProgress = null;
  }
}

/** Précharge le moteur OCR en arrière-plan (appelé à l'ouverture de l'écran d'ajout). */
export function warmUpOcr(): void {
  if (navigator.onLine || workerPromise) getWorker().catch(() => {});
}
