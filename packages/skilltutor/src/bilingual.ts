/**
 * Bilingual course text. OMS stores one string per field, so a bilingual course pairs both languages inside it:
 *   - short fields: "English text / Văn bản tiếng Việt"
 *   - long lesson summaries: an "ENGLISH" block followed by a "TIẾNG VIỆT" block.
 * pickLang() returns the part for the reader's language; text that is not bilingual comes back unchanged.
 * Pure and dependency-free so both the server (tutor, emails) and client components can use it.
 */
export type BilingualLocale = "en" | "vi";

const VI_LETTER = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;
const BLOCKS = /^\s*(?:ENGLISH|TIẾNG ANH)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*(?:TIẾNG VIỆT|VIETNAMESE)[ \t]*\r?\n([\s\S]*)$/;
const SEP = " / ";

export function splitBilingual(text: string): { en: string; vi: string } | null {
  const blocks = text.match(BLOCKS);
  if (blocks) return { en: blocks[1].trim(), vi: blocks[2].trim() };
  // The split is the last " / " that has no Vietnamese letter before it and Vietnamese after it,
  // so slashes inside the English half ("orders / sessions") stay where they are.
  let at = -1;
  for (let i = text.indexOf(SEP); i >= 0; i = text.indexOf(SEP, i + SEP.length)) {
    if (VI_LETTER.test(text.slice(0, i))) break;
    if (VI_LETTER.test(text.slice(i + SEP.length))) at = i;
  }
  if (at <= 0) return null;
  const en = text.slice(0, at).trim(), vi = text.slice(at + SEP.length).trim();
  // Comparable lengths: guards Vietnamese text that merely starts with an English word ("Excel / Google Sheets: …").
  const ratio = vi.length / en.length;
  return en && vi && ratio >= 0.5 && ratio <= 3 ? { en, vi } : null;
}

export function pickLang<T extends string | null | undefined>(text: T, locale: string | undefined): T {
  if (!text) return text;
  const pair = splitBilingual(text);
  return (pair ? pair[locale === "en" ? "en" : "vi"] : text) as T;
}
