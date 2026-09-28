"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Dialog } from "@/components/ui";

interface ExportPromptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** null while the prompt is still loading. */
  prompt: string | null;
}

export function ExportPromptDialog({ isOpen, onClose, prompt }: ExportPromptDialogProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      width="44rem"
      title="Export as prompt"
      description="Paste this into Claude, ChatGPT or any AI chat to pick up where this thread left off. You can edit it first."
    >
      {prompt === null ? (
        <div className="flex items-center gap-3 text-sm text-fg-muted py-6">
          <div className="w-4 h-4 border-2 border-line-strong border-t-team rounded-full animate-spin" />
          Writing the prompt from this thread…
        </div>
      ) : (
        // Keyed on the prompt so a fresh export resets any earlier edits.
        <PromptEditor key={prompt} initial={prompt} />
      )}
    </Dialog>
  );
}

function PromptEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState(false);

  const [failed, setFailed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions, insecure origin): select it so Ctrl+C works.
      setFailed(true);
      const box = document.getElementById("export-prompt-text") as HTMLTextAreaElement | null;
      box?.focus();
      box?.select();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="export-prompt-text" className="sr-only">
        Prompt text
      </label>
      <textarea
        id="export-prompt-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        className="focus-ring-in-container h-[50dvh] w-full resize-none rounded-control border border-field-line bg-sunken p-3 font-mono text-xs leading-relaxed text-fg outline-none focus:border-team focus:ring-2 focus:ring-team/25"
      />
      <div className="flex items-center justify-between gap-3">
        <span role="status" className="text-[11px] text-fg-subtle tabular-nums">
          {failed
            ? "Couldn't copy automatically. The text is selected, press Ctrl+C."
            : copied
            ? "Copied to clipboard"
            : `${text.length.toLocaleString()} characters`}
        </span>
        <Button onClick={copy}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy prompt"}
        </Button>
      </div>
    </div>
  );
}
