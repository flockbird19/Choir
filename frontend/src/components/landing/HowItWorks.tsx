"use client";

import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Lock, Users } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { TabPanel, Tabs } from "@/components/ui/Tabs";

type Step = "shared" | "private" | "post";

const STEPS: { id: Step; label: string; icon: React.ReactNode; title: string; body: string }[] = [
  {
    id: "shared",
    label: "Shared thread",
    icon: <Users />,
    title: "One conversation the whole team sees",
    body: "Every project has a shared thread. Anyone can bring in the AI with @AI, and it answers with the full team context: who is on the team and who said what.",
  },
  {
    id: "private",
    label: "Private threads",
    icon: <Lock />,
    title: "Room to think on your own",
    body: "Each member gets private threads to explore ideas with the AI without cluttering the team conversation. The AI there already knows the shared thread, so nobody starts from zero. Nothing from a private thread reaches the team unless you share it.",
  },
  {
    id: "post",
    label: "Post to Shared",
    icon: <ArrowUpRight />,
    title: "Share what's worth sharing",
    body: "Found something useful in a private thread? Pick the messages and post them to the shared thread as one clean update, marked as shared from a private thread.",
  },
];

function SharedVisual() {
  return (
    <div className="flex flex-col gap-3 text-body-sm">
      <div className="flex gap-2.5">
        <Avatar name="Maya R" colorKey="maya" size="sm" />
        <p className="rounded-bubble rounded-tl-md border border-line bg-card px-3 py-2 text-fg">
          <span className="font-medium text-primary">@AI</span> summarize where we landed on the demo flow
        </p>
      </div>
      <div className="flex gap-2.5">
        <Avatar name="Choir AI" kind="ai" size="sm" />
        <div className="text-fg">
          <p className="mb-1 flex items-center gap-1.5 text-caption font-semibold">
            Choir AI <Badge tone="ai" mono>claude-haiku-4-5</Badge>
          </p>
          Sign up, create a workspace, invite a teammate, then ask the AI in the shared thread. Maya owns the script.
        </div>
      </div>
    </div>
  );
}

function PrivateVisual() {
  return (
    <div className="flex flex-col items-center gap-2 text-body-sm" role="img" aria-label="Context flows from the shared thread into private threads, and back only when you post to shared">
      <div className="flex w-full max-w-xs items-center gap-2.5 rounded-card border border-team-line bg-team-soft px-3.5 py-3 text-team">
        <Users size={16} aria-hidden="true" />
        <span className="font-medium">Shared thread</span>
        <span className="ml-auto text-caption">whole team</span>
      </div>
      <div className="flex items-center gap-2 text-caption text-fg-subtle">
        <ArrowDown size={14} aria-hidden="true" /> AI context flows down, automatically
      </div>
      <div className="grid w-full max-w-xs grid-cols-2 gap-2">
        {["Your thread", "Your other thread"].map((name) => (
          <div key={name} className="flex items-center gap-2 rounded-card border border-private-line bg-private-soft px-3 py-2.5 text-private">
            <Lock size={14} aria-hidden="true" />
            <span className="truncate text-label font-medium">{name}</span>
          </div>
        ))}
      </div>
      <p className="text-center text-caption text-fg-subtle">Only you see these. Nothing goes up unless you post it.</p>
    </div>
  );
}

function PostVisual() {
  return (
    <div className="flex flex-col gap-3 text-body-sm sm:flex-row sm:items-center">
      <div className="flex flex-1 flex-col gap-2 rounded-card border border-private-line bg-private-soft p-3">
        <p className="flex items-center gap-1.5 text-caption font-medium text-private"><Lock size={12} aria-hidden="true" /> Private thread</p>
        {["Idea: open the demo with the invite flow", "AI: then show Post to Shared right after"].map((line) => (
          <p key={line} className="flex items-start gap-2 rounded-control border border-primary/30 bg-card px-2.5 py-1.5 text-label text-fg">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-primary text-on-primary"><Check size={11} aria-hidden="true" /></span>
            {line}
          </p>
        ))}
      </div>
      <ArrowRight size={18} className="mx-auto rotate-90 text-fg-subtle sm:rotate-0" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-2 rounded-card border border-team-line bg-team-soft p-3">
        <p className="flex items-center gap-1.5 text-caption font-medium text-team"><ArrowUpRight size={12} aria-hidden="true" /> Shared from a private thread</p>
        <p className="text-label text-fg">One update in the shared thread, with who shared it.</p>
      </div>
    </div>
  );
}

export function HowItWorks() {
  const [step, setStep] = useState<Step>("shared");

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        idBase="how"
        label="How Choir works"
        items={STEPS.map(({ id, label, icon }) => ({ id, label, icon }))}
        value={step}
        onValueChange={setStep}
        className="self-start"
      />
      {STEPS.map((item) => (
        <TabPanel key={item.id} idBase="how" id={item.id} selected={step === item.id}>
          <div className="grid items-center gap-8 rounded-sheet border border-line bg-card p-5 shadow-soft sm:p-8 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="font-display text-heading font-semibold text-fg">{item.title}</h3>
              <p className="text-body-lg text-fg-muted">{item.body}</p>
            </div>
            <div className="animate-enter rounded-card border border-line bg-bg p-4 motion-reduce:animate-none sm:p-5">
              {item.id === "shared" && <SharedVisual />}
              {item.id === "private" && <PrivateVisual />}
              {item.id === "post" && <PostVisual />}
            </div>
          </div>
        </TabPanel>
      ))}
    </div>
  );
}
