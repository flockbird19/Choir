"use client";

import { isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { cn } from "@/components/ui/cn";

function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

const CodeBlock: Components["pre"] = ({ node: _node, children, ...props }) => {
  const [copied, setCopied] = useState(false);
  const language = isValidElement<{ className?: string }>(children)
    ? /language-([\w-]+)/.exec(children.props.className ?? "")?.[1]
    : undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(extractText(children));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (e.g. insecure context); nothing useful to show.
    }
  };

  return (
    <div className="group/code my-3 overflow-hidden rounded-control border border-line bg-sunken first:mt-0 last:mb-0">
      <div className="flex h-11 items-center justify-between border-b border-line pl-3 pr-1 sm:h-8">
        <span className="font-mono text-caption text-fg-subtle">{language ?? "code"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="flex h-11 cursor-pointer items-center gap-1 rounded-md px-2.5 sm:h-6 sm:px-1.5 text-caption text-fg-subtle hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed text-fg" {...props}>
        {children}
      </pre>
    </div>
  );
};

const components: Components = {
  p: ({ node: _node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0 marker:text-fg-subtle" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0 marker:text-fg-subtle" {...props} />,
  li: ({ node: _node, ...props }) => <li className="pl-0.5" {...props} />,
  h1: ({ node: _node, ...props }) => <h3 className="mb-2 mt-4 font-display text-title font-semibold first:mt-0" {...props} />,
  h2: ({ node: _node, ...props }) => <h4 className="mb-2 mt-4 font-display text-body-lg font-semibold first:mt-0" {...props} />,
  h3: ({ node: _node, ...props }) => <h5 className="mb-1.5 mt-3 text-body font-semibold first:mt-0" {...props} />,
  pre: CodeBlock,
  // Inline code gets a pill; inside a fenced block (pre) the pill styles are reset.
  code: ({ node: _node, className, ...props }) => (
    <code
      className={cn(
        "rounded-[5px] border border-line bg-sunken px-1 py-px font-mono text-[0.85em]",
        "[pre_&]:rounded-none [pre_&]:border-0 [pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:text-[1em]",
        className
      )}
      {...props}
    />
  ),
  a: ({ node: _node, ...props }) => (
    <a className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  blockquote: ({ node: _node, ...props }) => <blockquote className="my-2 border-l-2 border-line-strong pl-3 text-fg-muted" {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-control border border-line">
      <table className="w-full border-collapse text-body-sm" {...props} />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th className="border-b border-line bg-sunken px-3 py-1.5 text-left font-semibold" {...props} />,
  td: ({ node: _node, ...props }) => <td className="border-b border-line px-3 py-1.5 last:border-b-0" {...props} />,
  hr: ({ node: _node, ...props }) => <hr className="my-4 border-line" {...props} />,
};

/** Message markdown tuned for reading: comfortable line height, quiet code blocks, no raw HTML. */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
});
