import { localPref, useLocalPref } from '../ui/local-pref';
import { DEFAULT_SIGNATURE_STYLE, readSignatureStyle, type SignatureStyle } from './signature';

/**
 * The signature's STYLE — its face and its words — kept on this device, once
 * for every tool (`signature.ts` says why it is not a document's): set in a
 * Recap, a Mosaic exported tomorrow wears the same sticker.
 */
export const SIGNATURE_STYLE_PREF = localPref<SignatureStyle>(
  'atelier.signature.v1',
  (raw) => {
    if (!raw) return DEFAULT_SIGNATURE_STYLE;
    try {
      return readSignatureStyle(JSON.parse(raw));
    } catch {
      return DEFAULT_SIGNATURE_STYLE;
    }
  },
  (value) => JSON.stringify(value),
);

export function useSignatureStyle(): [SignatureStyle, (next: SignatureStyle) => void] {
  return useLocalPref(SIGNATURE_STYLE_PREF, DEFAULT_SIGNATURE_STYLE);
}
