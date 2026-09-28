// Strips Markdown syntax for compact previews (Decisions panel, Catch me up) that show
// message content without running it through ReactMarkdown. Keeps line breaks — callers
// that need a single line collapse whitespace themselves (see DecisionsSinceBanner).
export function stripMarkdownSyntax(content: string): string {
  return content
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) -> text
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "") // table |---|---| rows
    .replace(/^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/gm, "") // table edge pipes
    .replace(/[ \t]*\|[ \t]*/g, "  ") // table cell pipes -> spacing
    .replace(/[*_`#>]+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
