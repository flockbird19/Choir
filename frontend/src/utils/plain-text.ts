// How people's own messages keep their shape: pasted code gets fenced, line breaks stay.

const CODE_LINE =
  /[;{}]\s*$|^\s*(#include|#define|import |from \S+ import|export |def |class |function |const |let |var |public |private |return\b|if\s*\(|for\s*\(|while\s*\(|\/\/|\/\*|<\/?[a-zA-Z][\w-]*[\s>])/;

/** Multi-line text where at least 40% of the non-empty lines look like code. */
export function looksLikeCode(text: string): boolean {
  if (text.includes("```")) return false;
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 3) return false;
  return lines.filter((line) => CODE_LINE.test(line)).length / lines.length >= 0.4;
}

/** Wrap pasted code in a Markdown code fence so it shows as code, with its indentation. */
export function fenceCode(text: string): string {
  return "```\n" + text.replace(/\s+$/, "") + "\n```\n";
}

/**
 * Markdown joins single line breaks into one paragraph; people's messages keep theirs
 * (a trailing double space is a Markdown hard break). Fenced code is left untouched.
 */
export function keepLineBreaks(text: string): string {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence || !line.trim() ? line : line.replace(/\s*$/, "  ");
    })
    .join("\n");
}
