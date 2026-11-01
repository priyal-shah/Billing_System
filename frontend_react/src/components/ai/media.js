import { useCallback, useEffect, useRef, useState } from 'react';

const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

/**
 * Browser speech-to-text (Web Speech API). Audio never reaches our server; the transcript is put in the
 * chat box so the admin can correct it before sending. Not available in Firefox.
 */
export function useSpeech({ lang, onText }) {
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => recRef.current?.stop(), []);

  const start = useCallback(() => {
    if (!Recognition || recRef.current) return;
    const rec = new Recognition();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript;
      onTextRef.current(text.trim());
    };
    rec.onend = () => { recRef.current = null; setListening(false); };
    rec.onerror = () => { recRef.current = null; setListening(false); };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [lang]);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported: !!Recognition, listening, start, stop };
}

/**
 * Shrink a photo before upload: long side at most 1568 px (what the model reads best), JPEG.
 * A phone photo goes from several MB to a few hundred KB, well under the server's limit.
 */
export async function prepareImage(file, maxSide = 1568) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read this image'))), 'image/jpeg', 0.85);
  });
}
