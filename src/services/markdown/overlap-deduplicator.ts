export function deduplicateOverlap(previous: string, next: string): string {
  function norm(s: string): string {
    return s.normalize("NFKD").toLowerCase().replace(/\s+/g, " ").trim();
  }

  const normPrev = norm(previous);
  const normNext = norm(next);

  if (normPrev.length === 0 || normNext.length === 0) return next;

  let matchLen = 0;
  for (let i = 1; i <= Math.min(normPrev.length, normNext.length); i++) {
    if (normNext.startsWith(normPrev.slice(-i))) {
      matchLen = i;
    }
  }

  if (matchLen === 0) return next;

  const matched = normNext.slice(0, matchLen);
  const tokens = matched.split(/\s+/);
  if (tokens.length < 3) return next;

  const alnum = matched.match(/\p{L}|\p{N}/gu);
  if (alnum === null || alnum.length < 12) return next;

  const chars = Array.from(next);
  let built = "";
  for (let i = 0; i < chars.length; i++) {
    built += chars[i] ?? "";
    if (norm(built) === matched) {
      return chars.slice(i + 1).join("");
    }
  }

  return "";
}
