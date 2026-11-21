/**
 * Forgiving search for patients: "dr amit", "skin doctor", "শিশু", "fever", "kailashahar".
 * The catalog is one town's worth of doctors and chambers, so matching runs in memory.
 */

/** Words that say nothing about who to find. */
const STOP = new Set(['dr', 'doctor', 'doctors', 'doc', 'the', 'a', 'an', 'near', 'me', 'in', 'at', 'for', 'of', 'best', 'good', 'specialist', 'clinic', 'chamber', 'ডাক্তার', 'ডাঃ', 'ডা', 'ভালো', 'বিশেষজ্ঞ']);

/** Everyday words (English and Bengali) that point to a specialty. */
const SYNONYMS: Record<string, string[]> = {
  general: ['general', 'physician', 'medicine', 'fever', 'cold', 'cough', 'sugar', 'diabetes', 'bp', 'pressure', 'gastric', 'জ্বর', 'সাধারণ', 'মেডিসিন', 'ডায়াবেটিস', 'সুগার', 'প্রেসার', 'সর্দি', 'কাশি'],
  child: ['child', 'children', 'kid', 'kids', 'baby', 'babies', 'paediatric', 'paediatrician', 'pediatric', 'pediatrician', 'শিশু', 'বাচ্চা'],
  women: ['women', 'woman', 'lady', 'ladies', 'gyne', 'gynae', 'gynaecologist', 'gynecologist', 'obstetric', 'obstetrics', 'pregnancy', 'pregnant', 'মহিলা', 'স্ত্রীরোগ', 'গাইনি', 'প্রসূতি', 'গর্ভবতী'],
  skin: ['skin', 'derma', 'dermatologist', 'hair', 'acne', 'pimple', 'চর্ম', 'ত্বক', 'চামড়া', 'চুল'],
  ent: ['ent', 'ear', 'nose', 'throat', 'নাক', 'কান', 'গলা'],
  eye: ['eye', 'eyes', 'ophthalmologist', 'vision', 'spectacles', 'চোখ', 'চক্ষু'],
  bones: ['bone', 'bones', 'ortho', 'orthopaedic', 'orthopedic', 'joint', 'joints', 'fracture', 'back pain', 'হাড়', 'অস্থি', 'জয়েন্ট'],
  teeth: ['teeth', 'tooth', 'dental', 'dentist', 'দাঁত', 'ডেন্টাল'],
};

/** Lowercase, punctuation to spaces, drop filler words. */
export function searchWords(q: string | undefined): string[] {
  if (!q) return [];
  return q.toLowerCase().replace(/[.,/()\-_'"]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
}

/** Specialty slugs a word could mean ("gyn" finds women, "derma" finds skin). */
function slugsFor(word: string): string[] {
  const out: string[] = [];
  for (const [slug, words] of Object.entries(SYNONYMS)) {
    if (word === slug || words.some((s) => s === word || (word.length >= 3 && (s.startsWith(word) || word.startsWith(s))))) out.push(slug);
  }
  return out;
}

/** Every word must match somewhere in the text, or mean one of the given specialties. */
export function matches(words: string[], text: string, slugs: string[]): boolean {
  const hay = text.toLowerCase().replace(/[.,/()\-_'"]+/g, ' ');
  return words.every((w) => hay.includes(w) || slugsFor(w).some((s) => slugs.includes(s)));
}
