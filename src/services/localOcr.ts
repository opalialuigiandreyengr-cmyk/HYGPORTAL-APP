export async function readTinFromImageUri(imageUri: string) {
  try {
    // Optional dependency. Install: npx expo install expo-mlkit-ocr
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const maybeModule = require('expo-mlkit-ocr');
    const detectFromUri = maybeModule?.detectFromUri;
    if (typeof detectFromUri !== 'function') {
      return '';
    }

    const blocks = await detectFromUri(imageUri);
    const text = Array.isArray(blocks)
      ? blocks.map((item: { text?: string }) => item?.text || '').join(' ')
      : '';
    return extractTinFromRawText(text);
  } catch {
    return '';
  }
}

export function extractTinFromRawText(rawText: string) {
  const text = String(rawText || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }
  const match = text.match(/\b(\d{3}[- ]?\d{3}[- ]?\d{3}(?:[- ]?\d{3})?)\b/);
  if (!match) {
    return '';
  }
  return match[1].replace(/[ ]/g, '-');
}
