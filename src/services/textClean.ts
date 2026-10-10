// Linear-time title cleanup for matching tracks across services.
//
// These run on user-supplied query parameters, so they deliberately avoid
// backtracking regexes like /\s*[(\[].*?[)\]]\s*/ or /\s-\s.*$/: on inputs
// such as "((((((((..." or long runs of spaces those take quadratic time
// (CodeQL js/polynomial-redos). Each helper here is a single pass.

/** Remove "(...)" and "[...]" segments (e.g. "(feat. X)", "[Remastered]").
 *  An opening bracket that is never closed is kept as literal text. */
export function stripBracketed(s: string): string {
  let out = '';
  let pending = ''; // raw text since the outermost unmatched opener
  let depth = 0;
  for (const ch of s) {
    if (ch === '(' || ch === '[') {
      depth++;
      pending += ch;
    } else if ((ch === ')' || ch === ']') && depth > 0) {
      depth--;
      pending += ch;
      if (depth === 0) {
        out += ' ';
        pending = '';
      }
    } else if (depth > 0) {
      pending += ch;
    } else {
      out += ch;
    }
  }
  return out + pending;
}

/** Collapse whitespace runs to single spaces and trim. */
export function collapseSpaces(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(' ');
}

/** Cut a " - suffix" (e.g. "Song - 2011 Remaster", "Song - Live"). */
export function stripDashSuffix(s: string): string {
  const i = s.indexOf(' - ');
  return i >= 0 ? s.slice(0, i) : s;
}

const isWordChar = (c: string | undefined) => !!c && /[a-z0-9]/i.test(c);

/** Cut everything from a "feat"/"ft" credit onward. Whole words only, so
 *  titles like "Left Hand" or "Defeated" are untouched. */
export function stripFeaturing(s: string): string {
  const lower = s.toLowerCase();
  let cut = s.length;
  for (const marker of ['feat', 'ft']) {
    for (let i = lower.indexOf(marker); i >= 0 && i < cut; i = lower.indexOf(marker, i + 1)) {
      if (!isWordChar(lower[i - 1]) && !isWordChar(lower[i + marker.length])) {
        cut = i;
        break;
      }
    }
  }
  return s.slice(0, cut);
}

/** Display title -> the core title other catalogs use. */
export function coreTitle(s: string): string {
  return collapseSpaces(stripDashSuffix(collapseSpaces(stripBracketed(s))));
}
