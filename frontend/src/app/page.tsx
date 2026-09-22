import type { Metadata } from "next";
import Link from "next/link";
import {
  Bell,
  Settings,
  ChevronsUpDown,
  Plus,
  MessagesSquare,
  Pin,
  LockKeyhole,
  MoreHorizontal,
  Users,
  Sparkles,
  Send,
  ArrowUp,
  ShieldCheck,
  Eye,
  Link2,
  EyeOff,
  KeyRound,
  Waypoints,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { InteractiveMark } from "@/components/landing/InteractiveMark";
import { PublishDemo } from "@/components/landing/PublishDemo";
import { ScrollReveal } from "@/components/landing/ScrollReveal";

// Signed-in visitors never see this page: the proxy sends them from `/` to `/home`.
// DESIGN.md 2: this page is light-only on purpose (the user's decision, 09-19) — every
// colour below comes from the `--landing-*` tokens in globals.css, which never change
// under `.dark`, so the page can't inherit a dark ancestor's values.
export const metadata: Metadata = {
  title: "Choir | One shared AI for your team",
  description:
    "Choir gives your team one shared AI chat, private threads to think alone, and a way to publish what's worth sharing.",
};

const SIGN_UP = "/login?view=signup";

export default function LandingPage() {
  return (
    <div className="choir-landing">
      <style>{`
        .choir-landing {
          --ink: var(--landing-ink);
          --muted: var(--landing-muted);
          --subtle: var(--landing-subtle);
          --line: var(--landing-line);
          --line-strong: var(--landing-line-strong);
          --paper: var(--landing-paper);
          --canvas: var(--landing-canvas);
          --navy: var(--landing-navy);
          --navy-soft: var(--landing-navy-soft);
          --navy-line: var(--landing-navy-line);
          --green: var(--landing-green);
          --green-soft: var(--landing-green-soft);
          --green-line: var(--landing-green-line);
          --amber: var(--landing-amber);
          --amber-soft: var(--landing-amber-soft);
          --amber-line: var(--landing-amber-line);
          --app-bg: var(--landing-canvas);
          --app-card: var(--landing-paper);
          --app-sunken: var(--landing-canvas);
          --app-hover: #f1f2f7;
          --app-selected: var(--landing-navy-soft);
          --app-fg: var(--landing-ink);
          --app-muted: var(--landing-muted);
          --app-subtle: var(--landing-subtle);
          --app-line: var(--landing-line);
          --app-line-strong: var(--landing-line-strong);
          --app-primary: var(--landing-ink);
          --app-primary-soft: var(--landing-navy-soft);
          --app-team: var(--landing-navy);
          --app-team-soft: var(--landing-navy-soft);
          --app-team-line: var(--landing-navy-line);
          --app-private: var(--landing-green);
          --app-private-soft: var(--landing-green-soft);
          --app-private-line: var(--landing-green-line);
          --app-decision: var(--landing-amber);
          --app-decision-soft: var(--landing-amber-soft);
          --app-decision-line: var(--landing-amber-line);
          --app-ai: var(--landing-navy);
          --shadow: 0 1px 2px rgba(17, 24, 39, .04), 0 18px 50px rgba(17, 24, 39, .08);
          display: block;
          width: 100%;
          min-width: 0;
          height: 100%;
          overflow-x: hidden;
          overflow-y: auto;
          color: var(--ink);
          background: var(--paper);
          font-family: var(--font-hanken-grotesk), system-ui, sans-serif;
          font-size: 16px;
          line-height: 1.5;
          text-rendering: optimizeLegibility;
          -webkit-font-smoothing: antialiased;
        }
        .choir-landing { scroll-behavior: smooth; color-scheme: light; }

        .choir-landing * { box-sizing: border-box; }
        .choir-landing a { color: inherit; text-decoration: none; }
        .choir-landing button,
        .choir-landing a { -webkit-tap-highlight-color: transparent; }
        .choir-landing button { font: inherit; }
        .choir-landing svg { display: block; }
        .choir-landing h1,
        .choir-landing h2,
        .choir-landing h3,
        .choir-landing h4,
        .choir-landing p { margin: 0; }

        .choir-landing .skip-link {
          position: absolute;
          left: 16px;
          top: -80px;
          z-index: 30;
          padding: 11px 16px;
          border-radius: 10px;
          background: var(--ink);
          color: white;
          font-weight: 700;
          transition: transform 160ms ease;
        }
        .choir-landing .skip-link:focus { transform: translateY(96px); }
        .choir-landing :focus-visible { outline: 3px solid rgba(37, 80, 143, .35); outline-offset: 3px; }

        .choir-landing .wrap { width: min(1120px, calc(100% - 48px)); margin-inline: auto; }
        .choir-landing .site-header {
          position: relative;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 76px;
          gap: 24px;
        }
        .choir-landing .brand {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-height: 44px;
          font-family: var(--font-newsreader), Georgia, serif;
          font-size: 25px;
          font-weight: 500;
          letter-spacing: -.03em;
        }
        .choir-landing .brand svg { width: 29px; height: 29px; color: #1f2128; }
        .choir-landing .nav-links,
        .choir-landing .nav-actions { display: flex; align-items: center; gap: 4px; }
        .choir-landing .nav-links { margin-left: auto; margin-right: 20px; }
        .choir-landing .nav-link {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 44px;
          padding: 0 14px;
          color: #454953;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 600;
          transition: color 160ms ease, background-color 160ms ease;
        }
        .choir-landing .nav-link:hover { color: var(--ink); background: #f3f4f6; }
        .choir-landing .nav-link::after {
          content: "";
          position: absolute;
          left: 14px;
          right: 14px;
          bottom: 7px;
          height: 2px;
          border-radius: 2px;
          background: var(--navy);
          transform: scaleX(0);
          transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .choir-landing .nav-link:hover::after { transform: scaleX(1); }

        .choir-landing .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          min-height: 46px;
          padding: 0 21px;
          border: 1px solid transparent;
          border-radius: 999px;
          cursor: pointer;
          font-size: 15px;
          font-weight: 650;
          letter-spacing: -.01em;
          white-space: nowrap;
          transition: transform 170ms ease, box-shadow 170ms ease, background-color 170ms ease, border-color 170ms ease;
        }
        .choir-landing .btn:hover { transform: translateY(-1px); }
        .choir-landing .btn:active { transform: translateY(0) scale(.985); }
        .choir-landing .btn-dark {
          position: relative;
          overflow: hidden;
          color: #fff;
          background: linear-gradient(180deg, #2b2e37 0%, #17191f 100%);
          box-shadow: 0 6px 18px rgba(17, 24, 39, .16), inset 0 1px 0 rgba(255,255,255,.16);
        }
        .choir-landing .btn-dark::after {
          content: "";
          position: absolute;
          top: -40%;
          left: -60%;
          width: 40%;
          height: 180%;
          background: rgba(255,255,255,.28);
          transform: rotate(20deg) translateX(-140%);
          transition: transform 550ms cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: none;
        }
        .choir-landing .btn-dark:hover::after { transform: rotate(20deg) translateX(340%); }
        .choir-landing .btn-light {
          color: #292c33;
          background: rgba(255,255,255,.88);
          border-color: var(--line-strong);
          box-shadow: 0 2px 10px rgba(17,24,39,.04);
        }
        .choir-landing .btn-light:hover { background: #fff; border-color: #bfc2ca; }
        .choir-landing .btn-ghost { color: #fff; background: transparent; border-color: rgba(255,255,255,.32); }
        .choir-landing .btn-ghost:hover { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.5); }
        .choir-landing .btn-small { min-height: 44px; padding-inline: 17px; font-size: 14px; }
        .choir-landing .post-btn {
          min-height: 44px; padding: 0 16px; border: 0; border-radius: 999px;
          background: var(--app-private); color: white; cursor: pointer; font-size: 13px; font-weight: 700;
          display: inline-flex; align-items: center; gap: 6px;
          transition: transform 170ms ease, opacity 170ms ease;
        }
        .choir-landing .post-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .choir-landing .post-btn:disabled { opacity: .72; cursor: default; }

        .choir-landing .hero { position: relative; padding: 62px 0 0; isolation: isolate; }
        .choir-landing .hero-glow { position: absolute; z-index: -1; border-radius: 50%; filter: blur(18px); pointer-events: none; }
        .choir-landing .glow-a { width: 520px; height: 300px; top: 50px; left: 50%; transform: translateX(-66%); background: rgba(114, 164, 235, .2); }
        .choir-landing .glow-b { width: 380px; height: 280px; top: 34px; right: 6%; background: rgba(166, 221, 192, .18); }
        .choir-landing .glow-c { width: 340px; height: 240px; top: 180px; left: 8%; background: rgba(244, 210, 144, .14); }
        .choir-landing .hero-copy { max-width: 900px; margin: 0 auto; text-align: center; }
        .choir-landing .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 22px;
          padding: 7px 12px;
          border: 1px solid rgba(37, 80, 143, .16);
          border-radius: 999px;
          background: rgba(255,255,255,.62);
          color: #424955;
          font-size: 14px;
          font-weight: 650;
          letter-spacing: -.01em;
        }
        .choir-landing .eyebrow-dot { position: relative; width: 7px; height: 7px; border-radius: 50%; background: var(--navy); box-shadow: 0 0 0 4px rgba(37,80,143,.1); }
        .choir-landing .eyebrow-dot::after {
          content: "";
          position: absolute;
          inset: -6px;
          border-radius: 50%;
          border: 1px solid rgba(37,80,143,.35);
          animation: choir-pulse 2.6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        @keyframes choir-pulse {
          0% { transform: scale(.4); opacity: .9; }
          70%, 100% { transform: scale(1.6); opacity: 0; }
        }
        .choir-landing h1 {
          max-width: 930px;
          margin-inline: auto;
          font-family: var(--font-newsreader), Georgia, serif;
          font-size: clamp(56px, 7vw, 88px);
          font-weight: 400;
          line-height: .98;
          letter-spacing: -.052em;
        }
        .choir-landing h1 em,
        .choir-landing .section-heading em,
        .choir-landing .trust-title em { color: var(--navy); font-weight: 400; padding-bottom: .08em; font-style: normal; }
        .choir-landing .hero-lede {
          max-width: 690px;
          margin: 25px auto 0;
          color: #515762;
          font-size: 19px;
          line-height: 1.58;
          letter-spacing: -.012em;
        }
        .choir-landing .hero-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin-top: 30px; }

        .choir-landing .product-stage { position: relative; margin-top: 64px; padding: 0 12px 54px; }
        .choir-landing .product-stage::after {
          content: "";
          position: absolute;
          inset: 18% 2% 0;
          z-index: -1;
          border-radius: 46px;
          background: linear-gradient(180deg, rgba(37,80,143,.04), rgba(255,255,255,0));
        }

        .choir-landing .choir-app {
          display: grid;
          grid-template-columns: 68px 244px minmax(0, 1fr);
          min-height: 640px;
          overflow: hidden;
          border: 1px solid var(--app-line-strong);
          border-radius: 22px;
          background: var(--app-bg);
          box-shadow: 0 3px 8px rgba(19,27,45,.05), 0 40px 110px rgba(30,43,71,.13);
          color: var(--app-fg);
          font-family: var(--font-hanken-grotesk), system-ui, sans-serif;
          text-align: left;
        }
        .choir-landing .classic-rail { display: flex; flex-direction: column; align-items: center; border-right: 1px solid var(--app-line); background: var(--app-sunken); }
        .choir-landing .classic-logo { display: grid; place-items: center; width: 42px; height: 42px; margin-top: 13px; border: 1px solid var(--app-line); border-radius: 13px; background: var(--app-card); color: var(--app-fg); }
        .choir-landing .classic-logo svg { width: 22px; height: 22px; }
        .choir-landing .rail-team { display: grid; place-items: center; width: 44px; height: 44px; margin-top: 18px; border: 2px solid var(--app-card); border-radius: 13px; background: var(--app-team); color: white; box-shadow: 0 0 0 2px var(--app-team-line); font-size: 13px; font-weight: 700; }
        .choir-landing .rail-team.muted { margin-top: 12px; border-color: transparent; background: #e5e7ed; color: #555b67; box-shadow: none; }
        .choir-landing .rail-bottom { display: grid; gap: 12px; margin-top: auto; margin-bottom: 14px; color: var(--app-muted); }
        .choir-landing .rail-bottom svg { width: 17px; height: 17px; }
        .choir-landing .app-sidebar { display: flex; min-width: 0; flex-direction: column; background: var(--app-card); border-right: 1px solid var(--app-line); }
        .choir-landing .team-switcher { display: flex; align-items: center; gap: 10px; min-height: 72px; padding: 0 16px; border-bottom: 1px solid var(--app-line); }
        .choir-landing .team-mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: var(--app-primary); color: #fff; font-size: 13px; font-weight: 700; }
        .choir-landing .team-copy { min-width: 0; flex: 1; line-height: 1.18; }
        .choir-landing .team-copy strong { display: block; font-size: 15px; }
        .choir-landing .team-copy span { display: block; margin-top: 3px; color: var(--app-subtle); font-size: 13px; }
        .choir-landing .thread-nav { padding: 14px 10px 12px; }
        .choir-landing .nav-title { padding: 10px 10px 7px; color: var(--app-muted); font-size: 13px; font-weight: 700; }
        .choir-landing .app-thread-link { display: flex; align-items: center; gap: 9px; min-height: 44px; padding: 0 11px; border-radius: 10px; color: var(--app-muted); font-size: 14px; }
        .choir-landing .app-thread-link.active { background: var(--app-selected); color: var(--app-primary); font-weight: 650; }
        .choir-landing .thread-meta { margin-left: auto; color: var(--app-subtle); font-size: 12px; font-weight: 600; }
        .choir-landing .thread-meta.unread { display: grid; place-items: center; min-width: 22px; height: 22px; border-radius: 999px; background: var(--app-team); color: white; }
        .choir-landing .app-thread-link svg { width: 15px; height: 15px; flex: 0 0 auto; }
        .choir-landing .team-icon { color: var(--app-team); }
        .choir-landing .private-icon { color: var(--app-private); }
        .choir-landing .account-row { display: flex; align-items: center; gap: 10px; margin-top: auto; min-height: 62px; padding: 10px 12px; border-top: 1px solid var(--app-line); }
        .choir-landing .person-avatar,
        .choir-landing .app-avatar { position: relative; display: grid; place-items: center; border-radius: 50%; background: #e5e6ed; color: #404555; font-size: 12px; font-weight: 700; }
        .choir-landing .person-avatar { width: 34px; height: 34px; background: #dfe3f4; color: #373d72; }
        .choir-landing .status { position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border: 2px solid var(--app-sunken); border-radius: 50%; background: var(--landing-green); }
        .choir-landing .account-copy { min-width: 0; line-height: 1.2; }
        .choir-landing .account-copy strong { display: block; font-size: 13px; }
        .choir-landing .account-copy span { display: block; max-width: 150px; overflow: hidden; color: var(--app-subtle); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }

        .choir-landing .app-center { position: relative; display: flex; min-width: 0; flex-direction: column; background: var(--app-sunken); }
        .choir-landing .app-header { display: flex; align-items: center; gap: 11px; min-height: 72px; padding: 0 20px; border-bottom: 1px solid var(--app-line); background: rgba(255,255,255,.96); }
        .choir-landing .space-symbol { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--app-team-line); border-radius: 10px; background: var(--app-team-soft); color: var(--app-team); }
        .choir-landing .space-symbol svg { width: 17px; height: 17px; }
        .choir-landing .app-title { min-width: 0; flex: 1; }
        .choir-landing .app-title-line { display: flex; align-items: center; gap: 8px; }
        .choir-landing .app-title strong { color: var(--app-fg); font-size: 17px; font-weight: 700; }
        .choir-landing .app-title p { margin-top: 2px; color: var(--app-subtle); font-size: 13px; }
        .choir-landing .app-actions { display: flex; align-items: center; gap: 6px; }
        .choir-landing .app-action { display: inline-flex; align-items: center; gap: 6px; min-height: 42px; padding: 0 13px; border: 1px solid var(--app-line-strong); border-radius: 999px; background: var(--app-card); color: var(--app-muted); font-size: 13px; font-weight: 700; }
        .choir-landing .app-action.primary-action { border-color: var(--app-team-line); background: var(--app-team-soft); color: var(--app-team); }
        .choir-landing .app-action svg { width: 14px; height: 14px; }
        .choir-landing .count { padding: 1px 5px; border-radius: 999px; background: var(--app-decision-soft); color: var(--app-decision); font-size: 12px; }
        .choir-landing .presence-stack { display: flex; margin-left: 3px; }
        .choir-landing .app-avatar { width: 27px; height: 27px; margin-left: -6px; border: 2px solid var(--app-bg); }
        .choir-landing .app-avatar:first-child { margin-left: 0; }
        .choir-landing .app-messages { width: min(100%, 820px); flex: 1; margin-inline: auto; padding: 28px 38px 20px; overflow: hidden; }
        .choir-landing .day-row { display: flex; align-items: center; gap: 12px; color: var(--app-subtle); font-size: 13px; font-weight: 600; }
        .choir-landing .day-row::before,
        .choir-landing .day-row::after { content: ""; flex: 1; height: 1px; background: var(--app-line); }
        .choir-landing .app-message { display: flex; gap: 11px; margin-top: 18px; }
        .choir-landing .message-avatar { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 auto; border-radius: 50%; background: #e6e8ee; color: #464c5c; font-size: 12px; font-weight: 700; }
        .choir-landing .message-avatar.ai { background: var(--app-team); color: white; }
        .choir-landing .app-message-content { min-width: 0; flex: 1; }
        .choir-landing .message-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; color: var(--app-subtle); font-size: 13px; }
        .choir-landing .message-meta strong { color: var(--app-fg); font-size: 13px; }
        .choir-landing .message-body { max-width: 92%; color: var(--app-fg); font-size: 15px; line-height: 1.58; }
        .choir-landing .teammate-bubble { display: inline-block; padding: 12px 15px; border: 1px solid var(--app-line); border-radius: 14px 14px 14px 5px; background: var(--app-card); }
        .choir-landing .app-message.own { justify-content: flex-end; }
        .choir-landing .app-message.own .message-avatar { display: none; }
        .choir-landing .app-message.own .app-message-content { display: flex; max-width: 72%; flex-direction: column; align-items: flex-end; }
        .choir-landing .app-message.own .message-meta { justify-content: flex-end; }
        .choir-landing .own-bubble { display: inline-block; max-width: 100%; padding: 12px 15px; border: 1px solid var(--app-private-line); border-radius: 14px 14px 5px 14px; background: var(--app-private-soft); color: var(--app-fg); }
        .choir-landing .ai-answer { display: inline-block; padding: 12px 15px; border: 1px solid var(--app-team-line); border-radius: 14px 14px 14px 5px; background: var(--app-team-soft); }
        .choir-landing .published-bubble { display: inline-block; padding: 13px 15px; border: 1px solid var(--app-team-line); border-radius: 5px 16px 16px 16px; background: var(--app-team-soft); box-shadow: inset 3px 0 0 var(--app-private); }
        .choir-landing .published-label { display: inline-flex; align-items: center; gap: 5px; margin-bottom: 5px; color: var(--app-team); font-size: 13px; font-weight: 700; }
        .choir-landing .decision-badge { display: inline-flex; align-items: center; gap: 5px; margin-left: 5px; padding: 3px 7px; border: 1px solid var(--app-decision-line); border-radius: 999px; background: var(--app-decision-soft); color: var(--app-decision); font-size: 12px; font-weight: 700; }
        .choir-landing .seen-row { display: flex; align-items: center; gap: 6px; margin-top: 7px; color: var(--app-subtle); font-size: 13px; }
        .choir-landing .seen-dots { display: flex; }
        .choir-landing .seen-dots span { display: grid; place-items: center; width: 24px; height: 24px; margin-left: -4px; border: 2px solid var(--app-bg); border-radius: 50%; background: #e2e4eb; color: #4b5060; font-size: 12px; font-weight: 700; }
        .choir-landing .app-composer-wrap { width: min(100%, 800px); margin-inline: auto; padding: 10px 34px 20px; }
        .choir-landing .app-composer { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 8px 10px 8px 17px; border: 1px solid var(--app-line-strong); border-radius: 999px; background: var(--app-card); color: var(--app-subtle); box-shadow: 0 1px 2px rgba(16,17,35,.05); font-size: 14px; }
        .choir-landing .send-control { display: grid; place-items: center; width: 40px; height: 40px; margin-left: auto; border-radius: 50%; background: var(--app-private); color: white; }
        .choir-landing .composer-model { color: var(--app-muted); font-size: 13px; font-weight: 600; }

        .choir-landing .section { padding: 108px 0; }
        .choir-landing .section-tight { padding-top: 72px; }
        .choir-landing .section.alt { background: #f8f8f8; border-block: 1px solid #efeff1; }
        .choir-landing .section-marker { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; color: #4b515d; font-size: 16px; font-weight: 650; letter-spacing: -.01em; }
        .choir-landing .section-marker::before { content: ""; width: 28px; height: 1px; background: #aeb2ba; }
        .choir-landing .section-heading { max-width: 820px; font-family: var(--font-newsreader), Georgia, serif; font-size: clamp(44px, 5.7vw, 70px); font-weight: 400; line-height: 1.02; letter-spacing: -.044em; }
        .choir-landing .section-lede { max-width: 650px; margin-top: 21px; color: #5d636e; font-size: 18px; line-height: 1.62; }

        .choir-landing .before-after { display: grid; grid-template-columns: .9fr 1.1fr; gap: 0; margin-top: 52px; overflow: hidden; border: 1px solid var(--line-strong); border-radius: 17px; background: #fff; box-shadow: 0 16px 46px rgba(20,28,45,.06); }
        .choir-landing .before,
        .choir-landing .after { padding: 34px; }
        .choir-landing .before { background: #fbfbfb; border-right: 1px solid var(--line); }
        .choir-landing .after { background: linear-gradient(135deg, #f7fafe 0%, #fff 68%); }
        .choir-landing .ba-label { margin-bottom: 23px; color: #5e6470; font-size: 15px; font-weight: 700; }
        .choir-landing .after .ba-label { color: var(--navy); }
        .choir-landing .solo-list { display: grid; gap: 11px; }
        .choir-landing .solo-row { display: grid; grid-template-columns: 38px 1fr; align-items: center; gap: 12px; min-height: 68px; padding: 12px 13px; border: 1px solid var(--line); border-radius: 11px; background: #fff; transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 200ms ease, border-color 200ms ease; }
        .choir-landing .solo-row:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(20,28,45,.07); border-color: var(--line-strong); }
        .choir-landing .solo-avatar { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: #e5e6eb; color: #555b66; font-size: 13px; font-weight: 700; }
        .choir-landing .solo-row strong { display: block; font-size: 15px; }
        .choir-landing .solo-row > div > span { display: block; margin-top: 3px; color: #707682; font-size: 13px; }
        .choir-landing .lost-note { margin-top: 17px; padding: 14px 3px 0; border-top: 1px solid #d7d9de; color: #626975; font-size: 14px; line-height: 1.55; }
        .choir-landing .moment-card { overflow: hidden; border: 1px solid var(--app-line-strong); border-radius: 17px; background: var(--app-bg); color: var(--app-fg); box-shadow: 0 14px 36px rgba(37,80,143,.08); font-family: var(--font-hanken-grotesk), system-ui, sans-serif; }
        .choir-landing .moment-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 58px; padding: 0 18px; border-bottom: 1px solid var(--app-line); background: var(--app-sunken); }
        .choir-landing .moment-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
        .choir-landing .moment-title span { display: inline-flex; padding: 3px 8px; border: 1px solid var(--app-team-line); border-radius: 999px; background: var(--app-team-soft); color: var(--app-team); font-family: var(--font-hanken-grotesk), sans-serif; font-size: 12px; }
        .choir-landing .moment-body { padding: 20px; }
        .choir-landing .moment-prompt { max-width: 86%; margin-left: auto; padding: 11px 14px; border: 1px solid var(--app-private-line); border-radius: 15px 15px 5px 15px; background: var(--app-private-soft); color: var(--app-fg); font-size: 14px; }
        .choir-landing .moment-ai { display: grid; grid-template-columns: 32px 1fr; gap: 10px; margin-top: 17px; }
        .choir-landing .moment-ai p { color: var(--app-fg); font-size: 14px; line-height: 1.58; }
        .choir-landing .moment-published { margin-top: 17px; padding: 13px 14px; border: 1px solid var(--app-team-line); border-radius: 12px; background: var(--app-team-soft); }
        .choir-landing .moment-published strong { display: block; color: var(--app-team); font-size: 13px; }
        .choir-landing .moment-published p { margin-top: 6px; color: var(--app-fg); font-size: 14px; line-height: 1.55; }
        .choir-landing .moment-decision { display: flex; align-items: center; gap: 9px; margin-top: 12px; color: var(--app-decision); font-size: 13px; font-weight: 700; }

        .choir-landing .privacy-grid { display: grid; grid-template-columns: .78fr 1.22fr; gap: 68px; align-items: center; }
        .choir-landing .privacy-points { display: grid; gap: 21px; margin-top: 33px; }
        .choir-landing .privacy-point { display: grid; grid-template-columns: 34px 1fr; gap: 13px; align-items: start; }
        .choir-landing .privacy-icon { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 9px; color: #555c68; background: #fff; }
        .choir-landing .privacy-icon svg { width: 16px; height: 16px; }
        .choir-landing .privacy-point strong { display: block; margin-bottom: 4px; font-size: 16px; }
        .choir-landing .privacy-point p { color: #626975; font-size: 15px; line-height: 1.55; }

        .choir-landing .private-window { overflow: hidden; border: 1px solid var(--app-line-strong); border-radius: 19px; background: var(--app-bg); box-shadow: var(--shadow); color: var(--app-fg); font-family: var(--font-hanken-grotesk), system-ui, sans-serif; }
        .choir-landing .private-head { display: flex; align-items: center; gap: 10px; min-height: 72px; padding: 0 15px; border-bottom: 1px solid var(--app-line); }
        .choir-landing .private-head-copy { min-width: 0; flex: 1; }
        .choir-landing .private-head-copy strong { font-size: 15px; }
        .choir-landing .private-head-copy p { color: var(--app-subtle); font-size: 13px; }
        .choir-landing .private-actions { display: flex; gap: 4px; }
        .choir-landing .private-action { display: inline-flex; align-items: center; min-height: 40px; padding: 0 12px; border: 1px solid var(--app-line); border-radius: 999px; background: var(--app-card); color: var(--app-muted); font-size: 13px; font-weight: 650; }
        .choir-landing .private-action.active { border-color: var(--app-private-line); background: var(--app-private-soft); color: var(--app-private); }
        .choir-landing .private-layout { display: grid; grid-template-columns: minmax(0,1fr) 280px; min-height: 470px; overflow: hidden; }
        .choir-landing .private-chat { display: flex; min-width: 0; flex-direction: column; padding: 26px 24px 20px; background: var(--app-sunken); }
        .choir-landing .private-chat .moment-prompt { max-width: 90%; border-color: var(--app-private-line); background: var(--app-private-soft); color: var(--app-fg); }
        .choir-landing .private-context { min-width: 0; border-left: 1px solid var(--app-line); background: var(--app-card); }
        .choir-landing .context-head { padding: 14px 15px; border-bottom: 1px solid var(--app-line); }
        .choir-landing .context-head strong { display: block; color: var(--app-team); font-size: 14px; font-weight: 700; }
        .choir-landing .context-head span { display: block; margin-top: 2px; color: var(--app-subtle); font-size: 12px; }
        .choir-landing .context-note { padding: 13px 15px; border-bottom: 1px solid var(--app-team-line); background: var(--app-team-soft); color: var(--app-muted); font-size: 13px; line-height: 1.55; }
        .choir-landing .context-message { display: flex; gap: 9px; padding: 16px; }
        .choir-landing .context-message p { color: var(--app-fg); font-size: 13px; line-height: 1.55; }
        .choir-landing .context-message strong { display: block; margin-bottom: 3px; font-size: 13px; }
        .choir-landing .private-composer { margin-top: auto; padding-top: 22px; }

        .choir-landing .workflow-preview { display: grid; grid-template-columns: 1.12fr .88fr; margin-top: 52px; overflow: hidden; border: 1px solid var(--app-line-strong); border-radius: 19px; background: var(--app-bg); box-shadow: 0 16px 48px rgba(20,28,45,.08); color: var(--app-fg); font-family: var(--font-hanken-grotesk), system-ui, sans-serif; }
        .choir-landing .workflow-pane { min-height: 510px; padding: 28px; }
        .choir-landing .workflow-pane.private { background: var(--app-sunken); border-right: 1px solid var(--app-line); }
        .choir-landing .workflow-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 22px; }
        .choir-landing .workflow-head strong { display: block; font-size: 16px; }
        .choir-landing .workflow-head span { color: var(--app-subtle); font-size: 13px; }
        .choir-landing .privacy-status { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border: 1px solid var(--app-private-line); border-radius: 999px; background: var(--app-private-soft); color: var(--app-private)!important; font-size: 13px!important; font-weight: 700; }
        .choir-landing .privacy-status svg { width: 13px; height: 13px; }
        .choir-landing .workflow-message { margin-top: 13px; padding: 11px 13px; border: 1px solid var(--app-line); border-radius: 13px; background: var(--app-card); color: var(--app-fg); font-size: 14px; line-height: 1.55; }
        .choir-landing .workflow-message.own { margin-left: 12%; border-color: var(--app-private-line); border-radius: 13px 13px 5px 13px; background: var(--app-private-soft); }
        .choir-landing .share-instruction { margin: -28px -28px 24px; padding: 14px 20px; border-bottom: 1px solid var(--app-private-line); background: var(--app-private-soft); color: var(--app-private); font-size: 13px; line-height: 1.45; }
        .choir-landing .share-row { display: grid; grid-template-columns: 22px 1fr; gap: 10px; align-items: start; margin-top: 13px; }
        .choir-landing .selection-box { display: grid; place-items: center; width: 20px; height: 20px; margin-top: 8px; border: 1px solid var(--app-line-strong); border-radius: 5px; background: var(--app-card); color: white; font-size: 12px; font-weight: 700; }
        .choir-landing .selection-box.selected { border-color: var(--app-private); background: var(--app-private); }
        .choir-landing .selected-answer { padding: 11px 13px; border: 1px solid var(--app-line); border-radius: 13px; background: var(--app-card); }
        .choir-landing .selected-answer p { font-size: 14px; line-height: 1.55; }
        .choir-landing .selected-controls { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
        .choir-landing .selected-controls span { flex: 1; color: var(--app-private); font-size: 13px; font-weight: 700; }
        .choir-landing .cancel-share { color: var(--app-muted); font-size: 13px; font-weight: 600; }
        .choir-landing .share-preview { padding: 16px; border: 1px solid var(--app-team-line); border-radius: 14px; background: var(--app-team-soft); }
        .choir-landing .share-preview-label { display: flex; align-items: center; gap: 7px; color: var(--app-team); font-size: 13px; font-weight: 700; }
        .choir-landing .share-preview p { margin-top: 9px; color: var(--app-fg); font-size: 15px; line-height: 1.58; }
        .choir-landing .source-trail { display: flex; align-items: center; gap: 7px; margin-top: 12px; color: var(--app-muted); font-size: 13px; }
        .choir-landing .published-card { padding: 14px; border: 1px solid var(--app-team-line); border-radius: 13px; background: var(--app-team-soft); }
        .choir-landing .published-card small { display: block; color: var(--app-team); font-size: 13px; font-weight: 700; }
        .choir-landing .published-card p { margin-top: 7px; font-size: 14px; line-height: 1.55; }
        .choir-landing .decision-big { margin-top: 18px; padding: 14px 15px; border: 1px solid var(--app-decision-line); border-radius: 13px; background: var(--app-decision-soft); }
        .choir-landing .decision-big span { color: var(--app-decision); font-size: 13px; font-weight: 700; }
        .choir-landing .decision-big strong { display: block; margin-top: 5px; font-size: 15px; }
        .choir-landing .decision-big p { margin-top: 4px; color: #705d44; font-size: 13px; }

        .choir-landing .difference-wrap { display: grid; grid-template-columns: .83fr 1.17fr; gap: 64px; align-items: start; }
        .choir-landing .comparison { overflow: hidden; border: 1px solid var(--line-strong); border-radius: 15px; background: #fff; box-shadow: 0 12px 38px rgba(20,28,45,.05); }
        .choir-landing .compare-head,
        .choir-landing .compare-row { display: grid; grid-template-columns: .72fr 1fr 1.14fr; }
        .choir-landing .compare-head { background: #f3f4f6; color: #555b66; font-size: 13px; font-weight: 700; }
        .choir-landing .compare-head div,
        .choir-landing .compare-row div { padding: 14px 15px; }
        .choir-landing .compare-row { border-top: 1px solid var(--line); color: #555c67; font-size: 14px; line-height: 1.48; }
        .choir-landing .compare-row div:last-child,
        .choir-landing .compare-head div:last-child { border-left: 1px solid var(--navy-line); background: rgba(237,243,251,.68); color: #294f83; }
        .choir-landing .compare-row div:first-child { color: #30343b; font-weight: 700; }

        .choir-landing .audience-section { overflow: hidden; border-block: 1px solid #ececef; background: #fbfbfb; }
        .choir-landing .audience-layout { display: grid; grid-template-columns: 1.05fr .95fr; gap: 76px; align-items: end; padding-block: 96px; }
        .choir-landing .audience-title { max-width: 680px; font-family: var(--font-newsreader), Georgia, serif; font-size: clamp(45px, 5.4vw, 68px); font-weight: 400; line-height: 1.03; letter-spacing: -.044em; }
        .choir-landing .audience-copy { color: #5b616c; font-size: 18px; line-height: 1.65; }
        .choir-landing .audience-copy strong { color: var(--ink); }
        .choir-landing .audience-list { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 23px; }
        .choir-landing .audience-list span { padding: 8px 12px; border: 1px solid var(--line-strong); border-radius: 999px; background: #fff; color: #484e59; font-size: 14px; font-weight: 600; }

        .choir-landing .trust-band { display: grid; grid-template-columns: .92fr 1.08fr; gap: 72px; align-items: start; padding: 58px; border: 1px solid var(--line-strong); border-radius: 21px; background: linear-gradient(135deg,#fafbfc,#fff); box-shadow: var(--shadow); }
        .choir-landing .trust-title { max-width: 520px; font-family: var(--font-newsreader), Georgia, serif; font-size: clamp(42px,5vw,64px); font-weight: 400; line-height: 1.02; letter-spacing: -.043em; }
        .choir-landing .trust-list { display: grid; gap: 0; }
        .choir-landing .trust-item { display: grid; grid-template-columns: 36px 1fr; gap: 13px; padding: 17px 0; border-bottom: 1px solid var(--line); transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1); }
        .choir-landing .trust-item:hover { transform: translateX(4px); }
        .choir-landing .trust-item:first-child { padding-top: 0; }
        .choir-landing .trust-item:last-child { padding-bottom: 0; border-bottom: 0; }
        .choir-landing .trust-item > svg { width: 19px; height: 19px; margin-top: 3px; color: var(--navy); }
        .choir-landing .trust-item strong { display: block; margin-bottom: 3px; font-size: 16px; }
        .choir-landing .trust-item p { color: #606772; font-size: 14px; line-height: 1.55; }

        .choir-landing .final-cta { padding: 70px 44px; border-radius: 22px; background: #1d2027; color: white; text-align: center; }
        .choir-landing .final-cta h2 { max-width: 750px; margin-inline: auto; font-family: var(--font-newsreader), Georgia, serif; font-size: clamp(43px,5.6vw,68px); font-weight: 400; line-height: 1; letter-spacing: -.042em; }
        .choir-landing .final-cta p { max-width: 620px; margin: 20px auto 0; color: #cfd2d8; font-size: 18px; line-height: 1.6; }
        .choir-landing .final-cta .hero-actions { margin-top: 28px; }
        .choir-landing .footer { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 110px; border-top: 1px solid var(--line); }
        .choir-landing .footer-left { display: flex; align-items: center; gap: 18px; }
        .choir-landing .footer-note { color: #6b717b; font-size: 14px; }
        .choir-landing .footer-links { display: flex; align-items: center; gap: 24px; color: #555b66; font-size: 14px; font-weight: 600; }

        .choir-landing .logo-outro { padding-top: 20px; padding-bottom: 28px; }
        .choir-landing .logo-outro-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
        .choir-landing .logo-outro-caption { color: var(--subtle); font-size: 13px; font-weight: 600; letter-spacing: -.01em; }

        @media (max-width: 1020px) {
          .choir-landing .nav-links { display: none; }
          .choir-landing .choir-app { grid-template-columns: 56px 190px minmax(0,1fr); }
          .choir-landing .difference-wrap { grid-template-columns: 1fr; }
          .choir-landing .comparison { margin-top: 10px; }
          .choir-landing .privacy-grid { grid-template-columns: 1fr; gap: 45px; }
          .choir-landing .trust-band { grid-template-columns: 1fr; gap: 44px; }
        }

        @media (max-width: 760px) {
          .choir-landing .wrap { width: min(100% - 32px, 1120px); }
          .choir-landing .site-header { height: 68px; }
          .choir-landing .nav-actions .btn-light { display: none; }
          .choir-landing .hero { padding-top: 44px; }
          .choir-landing h1 { font-size: clamp(45px,13vw,64px); line-height: 1; }
          .choir-landing .hero-lede { font-size: 17px; }
          .choir-landing .product-stage { margin-top: 14px; padding-inline: 0; }
          .choir-landing .choir-app { display: block; min-height: 590px; }
          .choir-landing .classic-rail,
          .choir-landing .app-sidebar { display: none; }
          .choir-landing .app-header { min-height: auto; padding-block: 12px; align-items: center; }
          .choir-landing .app-title p { display: none; }
          .choir-landing .app-actions .app-action:nth-child(-n+2) { display: none; }
          .choir-landing .presence-stack { display: none; }
          .choir-landing .app-messages { padding: 20px 17px 14px; }
          .choir-landing .message-body { max-width: 100%; font-size: 14px; }
          .choir-landing .app-composer-wrap { padding-inline: 14px; }
          .choir-landing .app-composer { flex-wrap: wrap; }
          .choir-landing .app-composer > span:first-child { flex: 1 0 100%; }
          .choir-landing .section { padding: 78px 0; }
          .choir-landing .section-tight { padding-top: 54px; }
          .choir-landing .section-heading,
          .choir-landing .audience-title { font-size: clamp(40px,12vw,54px); }
          .choir-landing .section-lede { font-size: 17px; }
          .choir-landing .before-after,
          .choir-landing .workflow-preview { grid-template-columns: 1fr; }
          .choir-landing .before { border-right: 0; border-bottom: 1px solid var(--line); }
          .choir-landing .before,
          .choir-landing .after,
          .choir-landing .workflow-pane { padding: 22px; }
          .choir-landing .workflow-pane.private { border-right: 0; border-bottom: 1px solid var(--app-line); }
          .choir-landing .private-actions { display: none; }
          .choir-landing .private-layout { grid-template-columns: 1fr; min-height: 0; }
          .choir-landing .private-chat { min-height: 480px; max-width: none; padding-right: 22px; }
          .choir-landing .private-context { width: auto; border-top: 1px solid var(--app-line); border-left: 0; box-shadow: none; }
          .choir-landing .compare-head,
          .choir-landing .compare-row { grid-template-columns: .82fr 1fr; }
          .choir-landing .compare-head div:nth-child(2),
          .choir-landing .compare-row div:nth-child(2) { display: none; }
          .choir-landing .audience-layout { grid-template-columns: 1fr; gap: 32px; padding-block: 72px; }
          .choir-landing .trust-band { padding: 28px 22px; }
          .choir-landing .final-cta { padding: 54px 22px; }
          .choir-landing .footer { align-items: flex-start; flex-direction: column; justify-content: center; padding-block: 28px; }
          .choir-landing .footer-left { align-items: flex-start; flex-direction: column; gap: 7px; }
          .choir-landing .footer-links { flex-wrap: wrap; gap: 15px 22px; }
        }

        @media (max-width: 430px) {
          .choir-landing .nav-actions .btn { padding-inline: 14px; font-size: 13px; }
          .choir-landing .hero-actions { flex-direction: column; }
          .choir-landing .hero-actions .btn { width: 100%; }
          .choir-landing .app-actions .app-action { padding-inline: 7px; }
          .choir-landing .app-action span.label { display: none; }
          .choir-landing .app-message { gap: 8px; }
          .choir-landing .message-avatar { width: 30px; height: 30px; }
          .choir-landing .audience-list span { font-size: 13px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .choir-landing *,
          .choir-landing *::before,
          .choir-landing *::after { animation-duration: 1ms!important; animation-iteration-count: 1!important; transition-duration: 1ms!important; }
          .choir-landing { scroll-behavior: auto; }
        }
      `}</style>

      <ScrollReveal />
      <a className="skip-link" href="#choir-main">Skip to content</a>

      <header className="wrap site-header" id="top">
        <a className="brand" href="#top" aria-label="Choir home">
          <Logo />
          <span>Choir</span>
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          <a className="nav-link" href="#why">Why Choir</a>
          <a className="nav-link" href="#how">How it works</a>
          <a className="nav-link" href="#teams">For small teams</a>
          <a className="nav-link" href="#privacy">Privacy</a>
        </nav>
        <div className="nav-actions">
          <Link className="btn btn-light btn-small" href="/login">Sign in</Link>
          <Link className="btn btn-dark btn-small" href={SIGN_UP}>Create workspace</Link>
        </div>
      </header>

      <main id="choir-main">
        <section className="hero" aria-labelledby="hero-title">
          <span className="hero-glow glow-a" />
          <span className="hero-glow glow-b" />
          <span className="hero-glow glow-c" />
          <div className="wrap">
            <div className="hero-copy">
              <div className="eyebrow"><span className="eyebrow-dot" />One shared AI chat for your whole team</div>
              <h1 id="hero-title">One team chat. <em>One shared AI.</em></h1>
              <p className="hero-lede">Ask AI in Team Space, explore privately when you need to, and publish what&rsquo;s worth sharing. Nobody explains the project twice.</p>
              <div className="hero-actions">
                <Link className="btn btn-dark" href={SIGN_UP}>Create workspace <span aria-hidden="true">&rarr;</span></Link>
                <a className="btn btn-light" href="#how">See how it works</a>
              </div>
            </div>

            <div className="product-stage" aria-label="A polished vision of the Choir Team Space interface">
              <div className="choir-app">
                <aside className="classic-rail" aria-label="Team switcher">
                  <span className="classic-logo"><Logo /></span>
                  <span className="rail-team">ER</span>
                  <span className="rail-team muted">+</span>
                  <div className="rail-bottom"><Bell /><Settings /></div>
                </aside>
                <aside className="app-sidebar" aria-label="Choir workspace sidebar">
                  <div className="team-switcher">
                    <span className="team-mark">ER</span>
                    <div className="team-copy"><strong>EcoRoute</strong><span>Product sprint</span></div>
                    <ChevronsUpDown style={{ width: 16, color: "var(--app-subtle)" }} />
                  </div>
                  <nav className="thread-nav" aria-label="Example threads">
                    <div className="nav-title">Shared</div>
                    <div className="app-thread-link active"><MessagesSquare className="team-icon" /><span>Team Space</span><span className="thread-meta unread">3</span></div>
                    <div className="app-thread-link"><Pin className="team-icon" /><span>Decisions</span><span className="thread-meta">4</span></div>
                    <div className="nav-title" style={{ marginTop: 14 }}>
                      Private threads <Plus style={{ width: 14, float: "right" }} />
                    </div>
                    <div className="app-thread-link"><LockKeyhole className="private-icon" /><span>Launch positioning</span></div>
                    <div className="app-thread-link"><LockKeyhole className="private-icon" /><span>Judging Q&amp;A</span></div>
                  </nav>
                  <div className="account-row">
                    <span className="person-avatar">AR<span className="status" /></span>
                    <div className="account-copy"><strong>Asha Rao</strong><span>Online</span></div>
                    <MoreHorizontal style={{ width: 18, marginLeft: "auto", color: "var(--app-subtle)" }} />
                  </div>
                </aside>

                <section className="app-center" aria-label="Team Space conversation">
                  <div className="app-header">
                    <span className="space-symbol"><Users /></span>
                    <div className="app-title"><div className="app-title-line"><strong>Team Space</strong></div><p>Shared project context for everyone</p></div>
                    <div className="app-actions">
                      <span className="app-action primary-action"><Sparkles /><span className="label">Catch me up</span></span>
                      <span className="app-action"><Pin /><span className="label">Decisions</span><span className="count">4</span></span>
                      <span className="app-action" aria-label="More actions"><MoreHorizontal /></span>
                    </div>
                  </div>
                  <div className="app-messages">
                    <div className="day-row">Today</div>
                    <article className="app-message">
                      <span className="message-avatar">DL</span>
                      <div className="app-message-content">
                        <div className="message-meta"><strong>Devon Lee</strong><span>10:18 AM</span></div>
                        <div className="message-body teammate-bubble">The new match flow is ready. We still need one clear story for why the ETA belongs in the first demo.</div>
                      </div>
                    </article>
                    <article className="app-message own">
                      <div className="app-message-content">
                        <div className="message-meta"><span>10:21 AM</span></div>
                        <div className="message-body own-bubble">@AI, use the interview notes and Priya&rsquo;s test results. What should we lead with?</div>
                      </div>
                    </article>
                    <article className="app-message">
                      <span className="message-avatar ai">C</span>
                      <div className="app-message-content">
                        <div className="message-meta"><strong>Choir AI</strong><span>Using Team Space context</span></div>
                        <div className="message-body ai-answer">Lead with confidence, not speed. Riders said uncertainty was the real barrier. Matching plus a reliable ETA makes the first demo feel complete.</div>
                      </div>
                    </article>
                    <article className="app-message">
                      <span className="message-avatar">PN</span>
                      <div className="app-message-content">
                        <div className="message-meta"><strong>Priya Nair</strong><span>10:24 AM</span></div>
                        <div className="message-body published-bubble">
                          <span className="published-label"><Send style={{ width: 13 }} />Published from a private thread</span><br />
                          Position the ETA as the trust layer. It turns a possible match into a plan someone can act on.
                        </div>
                      </div>
                    </article>
                    <article className="app-message own">
                      <div className="app-message-content">
                        <div className="message-meta"><span>10:27 AM</span></div>
                        <div className="message-body own-bubble">That is the story. Matching finds the ride, ETA makes it dependable.</div>
                        <div className="seen-row">
                          <span className="decision-badge"><Pin style={{ width: 11 }} />Decision</span>
                          <span>Seen by</span>
                          <span className="seen-dots"><span>D</span><span>P</span></span>
                        </div>
                      </div>
                    </article>
                  </div>
                  <div className="app-composer-wrap">
                    <div className="app-composer">
                      <Plus style={{ width: 17 }} />
                      <span>Message Team Space or ask @AI</span>
                      <span className="composer-model">Claude Haiku 4.5</span>
                      <span className="send-control"><ArrowUp style={{ width: 17 }} /></span>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-tight" id="why" aria-labelledby="why-title">
          <div className="wrap">
            <h2 className="section-heading" id="why-title">You keep explaining the same project to AI, over and over.</h2>
            <p className="section-lede">Useful answers get stuck in one person&rsquo;s chat. Teammates repeat research someone already did. Decisions get lost in scrollback.</p>
            <div className="before-after">
              <div className="before">
                <div className="ba-label">Without Choir</div>
                <div className="solo-list">
                  <div className="solo-row"><span className="solo-avatar">A</span><div><strong>Asha defines the scope</strong><span>The reasoning stays in her AI chat.</span></div></div>
                  <div className="solo-row"><span className="solo-avatar">D</span><div><strong>Devon plans the build</strong><span>The project is explained again from scratch.</span></div></div>
                  <div className="solo-row"><span className="solo-avatar">P</span><div><strong>Priya validates the demo</strong><span>The latest decision is missing.</span></div></div>
                </div>
                <p className="lost-note">Copy-paste becomes the collaboration layer. The source, reasoning, and final call are easy to lose.</p>
              </div>
              <div className="after">
                <div className="ba-label">With Choir</div>
                <div className="moment-card">
                  <div className="moment-head">
                    <div className="moment-title">Team Space <span>Shared</span></div>
                    <div className="presence-stack"><span className="app-avatar">P</span><span className="app-avatar">A</span><span className="app-avatar">V</span></div>
                  </div>
                  <div className="moment-body">
                    <div className="moment-prompt">@AI Which scope gives us the strongest complete demo by Friday?</div>
                    <div className="moment-ai">
                      <span className="message-avatar ai">C</span>
                      <p><strong>Choir AI</strong><br />Keep matching, ETA, and the carbon counter. That fits Priya&rsquo;s result and Devon&rsquo;s implementation estimate.</p>
                    </div>
                    <div className="moment-published">
                      <strong>Asha published from a private thread</strong>
                      <p>The dashboard can wait. These three pieces make a coherent demo and fit the sprint.</p>
                      <div className="moment-decision"><Pin style={{ width: 14 }} />Decision saved with its source</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section alt" aria-labelledby="private-title">
          <div className="wrap privacy-grid">
            <div>
              <h2 className="section-heading" id="private-title">Ask together. <em>Think alone when you need to.</em></h2>
              <p className="section-lede">A private thread can read Team Space. Nothing you write there reaches the team unless you publish it.</p>
              <div className="privacy-points">
                <div className="privacy-point"><span className="privacy-icon"><Users /></span><div><strong>Team Space is shared</strong><p>People, messages, published findings, and Decisions stay visible to project members.</p></div></div>
                <div className="privacy-point"><span className="privacy-icon"><LockKeyhole /></span><div><strong>Private threads stay yours</strong><p>Your prompts, drafts, and AI answers remain owner-only.</p></div></div>
                <div className="privacy-point"><span className="privacy-icon"><Send /></span><div><strong>You choose what crosses over</strong><p>Post selected messages or edit an AI-drafted finding before publishing.</p></div></div>
              </div>
            </div>

            <div className="private-window" aria-label="A polished vision of a Choir private thread">
              <div className="private-head">
                <span className="space-symbol" style={{ borderColor: "var(--app-private-line)", background: "var(--app-private-soft)", color: "var(--app-private)" }}>
                  <LockKeyhole style={{ width: 16 }} />
                </span>
                <div className="private-head-copy"><strong>Launch positioning</strong><p>Only visible to you</p></div>
                <div className="private-actions">
                  <span className="private-action active"><ShieldCheck style={{ width: 14, marginRight: 5 }} />Private</span>
                  <span className="private-action">Select</span>
                  <span className="private-action">Publish findings</span>
                </div>
              </div>
              <div className="private-layout">
                <section className="private-chat" aria-label="Private conversation">
                  <div className="moment-prompt">Help me pressure-test the story. Why does the ETA matter more than adding another matching filter?</div>
                  <div className="moment-ai">
                    <span className="message-avatar ai">C</span>
                    <p><strong>Choir AI</strong><br />The team already learned that uncertainty blocks action. A better filter improves discovery, but the ETA helps someone trust the ride enough to commit.</p>
                  </div>
                  <div className="moment-prompt" style={{ marginTop: 18 }}>Turn that into one finding I can share without exposing this whole draft.</div>
                  <div className="moment-ai">
                    <span className="message-avatar ai">C</span>
                    <p><strong>Choir AI</strong><br /><strong>Finding:</strong> Position ETA as the trust layer. It converts a possible match into a dependable plan.</p>
                  </div>
                  <div className="private-composer">
                    <div className="app-composer">
                      <span>Think privately with AI...</span>
                      <span className="send-control"><ArrowUp style={{ width: 17 }} /></span>
                    </div>
                  </div>
                </section>
                <aside className="private-context" aria-label="Team Space context">
                  <div className="context-head"><strong>Team Space context</strong><span>Available to AI, read-only here</span></div>
                  <div className="context-note">Your private prompts and drafts never appear here. You choose the final finding to publish.</div>
                  <div className="context-message"><span className="message-avatar">DL</span><p><strong>Devon Lee</strong>The new match flow is ready. We need one clear story for the ETA.</p></div>
                  <div className="context-message"><span className="message-avatar">PN</span><p><strong>Priya Nair</strong>Interview notes point to uncertainty, not a shortage of filters.</p></div>
                  <div className="context-message"><span className="message-avatar ai">C</span><p><strong>Decision</strong>Matching finds the ride. ETA makes it dependable.</p></div>
                </aside>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="how" aria-labelledby="how-title">
          <div className="wrap">
            <div className="section-marker">How Choir works</div>
            <h2 className="section-heading" id="how-title">Ask together. Explore privately. Publish what matters.</h2>
            <p className="section-lede">No copying between tools. Select the useful part, review exactly what the team will see, then publish it with its source attached.</p>
            <div className="workflow-preview" aria-label="A private finding being prepared for Team Space">
              <section className="workflow-pane private" aria-label="Private thread preview">
                <div className="share-instruction">Select only the answer you want to share. The rest of this thread stays private.</div>
                <div className="workflow-head"><div><strong>Launch positioning</strong><span>Private thread</span></div><span className="privacy-status"><LockKeyhole />Only you</span></div>
                <div className="share-row"><span className="selection-box" /><div className="workflow-message own">What should we cut if the demo runs long?</div></div>
                <div className="share-row"><span className="selection-box selected">✓</span><div className="selected-answer"><p>Keep matching and ETA together. They form one complete promise: find a ride and know when it will happen.</p></div></div>
                <div className="share-row"><span className="selection-box" /><div className="workflow-message own">Give me three alternate headlines for that story.</div></div>
                <div className="selected-controls"><span>1 answer selected</span><span className="cancel-share">Cancel</span><PublishDemo label="Review post" /></div>
              </section>
              <section className="workflow-pane team" aria-label="Share preview">
                <div className="workflow-head"><div><strong>Review before sharing</strong><span>Nothing has been posted yet</span></div><Eye style={{ width: 18, color: "var(--app-team)" }} /></div>
                <div className="share-preview">
                  <div className="share-preview-label"><Send style={{ width: 14 }} />Will appear in Team Space</div>
                  <p>Keep matching and ETA together. They form one complete promise: find a ride and know when it will happen.</p>
                  <div className="source-trail"><Link2 style={{ width: 14 }} />Source: Asha&rsquo;s private thread</div>
                </div>
                <div className="published-card" style={{ marginTop: 18 }}>
                  <small>After publishing</small>
                  <p>Teammates can discuss the finding, ask @AI to connect it to project context, or pin it as a Decision.</p>
                </div>
                <div className="decision-big"><span>Decision</span><strong>Lead the demo with matching plus ETA.</strong><p>The decision keeps the published source attached.</p></div>
                <div className="selected-controls" style={{ marginTop: 20 }}><span>You control the boundary</span><PublishDemo label="Post to Team Space" /></div>
              </section>
            </div>
          </div>
        </section>

        <section className="section alt" aria-labelledby="difference-title">
          <div className="wrap difference-wrap">
            <div>
              <h2 className="section-heading" id="difference-title">Most AI chats forget your team exists. <em>Choir doesn&rsquo;t.</em></h2>
              <p className="section-lede">It&rsquo;s not another model picker. It&rsquo;s the connection between people, private thinking, shared discussion, and Decisions.</p>
            </div>
            <div className="comparison" role="table" aria-label="Ordinary AI chat compared with Choir">
              <div className="compare-head" role="row"><div role="columnheader">What changes</div><div role="columnheader">Ordinary AI chat</div><div role="columnheader">Choir</div></div>
              <div className="compare-row" role="row"><div role="rowheader">Project context</div><div role="cell">Re-explained in each chat</div><div role="cell">Lives in Team Space and stays available</div></div>
              <div className="compare-row" role="row"><div role="rowheader">Private work</div><div role="cell">Disconnected from the team</div><div role="cell">Informed by shared context, private by default</div></div>
              <div className="compare-row" role="row"><div role="rowheader">Sharing</div><div role="cell">Copy-paste loses the source</div><div role="cell">Published deliberately with its trail attached</div></div>
              <div className="compare-row" role="row"><div role="rowheader">Decisions</div><div role="cell">Buried in chat history</div><div role="cell">Pinned, visible, and available to Catch me up</div></div>
              <div className="compare-row" role="row"><div role="rowheader">Collaboration</div><div role="cell">One person and one bot</div><div role="cell">Live messages, presence, Seen by, and @AI</div></div>
              <div className="compare-row" role="row"><div role="rowheader">Providers</div><div role="cell">A separate silo per tool</div><div role="cell">Anthropic, OpenAI, Gemini, or Groq</div></div>
            </div>
          </div>
        </section>

        <section className="audience-section" id="teams" aria-labelledby="teams-title">
          <div className="wrap audience-layout">
            <h2 className="audience-title" id="teams-title">Built first for small teams that move before process catches up.</h2>
            <div className="audience-copy">
              <p><strong>Small teams are Choir&rsquo;s beachhead.</strong> They feel context loss fastest and can adopt a shared way of working without a long rollout.</p>
              <p style={{ marginTop: 14 }}>The collaboration model can grow toward larger organizations later. Today, the product stays focused on helping a tight team move together.</p>
              <div className="audience-list" aria-label="Teams Choir is built for">
                <span>Founding teams</span><span>Hackathon crews</span><span>Agency sprints</span><span>Game jams</span><span>Student projects</span><span>Open-source groups</span>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="privacy" aria-labelledby="trust-title">
          <div className="wrap">
            <div className="section-marker">Privacy and trust</div>
            <div className="trust-band">
              <div>
                <h2 className="trust-title" id="trust-title">Your private work and provider keys stay <em>under your control.</em></h2>
                <p className="section-lede">Choir keeps the sharing boundary explicit and the key model out of the team&rsquo;s way.</p>
              </div>
              <div className="trust-list">
                <div className="trust-item"><EyeOff /><div><strong>Private means owner-only</strong><p>Private threads are not visible to teammates and are never silently added to Team Space.</p></div></div>
                <div className="trust-item"><KeyRound /><div><strong>Keys stay server-side</strong><p>Provider keys are encrypted and never sent back to the browser.</p></div></div>
                <div className="trust-item"><ShieldCheck /><div><strong>Lent keys respect the boundary</strong><p>A voluntarily lent key may help Team Space. It is never used inside another person&rsquo;s private thread.</p></div></div>
                <div className="trust-item"><Waypoints /><div><strong>Use the provider that fits the work</strong><p>Choose from supported Anthropic, OpenAI, Gemini, and Groq models without splitting the team&rsquo;s project context.</p></div></div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-tight" aria-labelledby="cta-title">
          <div className="wrap">
            <div className="final-cta">
              <h2 id="cta-title">Give your next team one shared AI conversation.</h2>
              <p>Create a workspace, invite your team, and stop repeating the project to AI.</p>
              <div className="hero-actions">
                <Link className="btn btn-light" href={SIGN_UP}>Create workspace <span aria-hidden="true">&rarr;</span></Link>
                <Link className="btn btn-ghost" href="/login">Sign in</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <section className="section section-tight logo-outro" aria-label="The Choir mark">
        <div className="wrap logo-outro-wrap">
          <InteractiveMark />
          <p className="logo-outro-caption">Move your cursor through it.</p>
        </div>
      </section>

      <footer className="wrap footer">
        <div className="footer-left">
          <a className="brand" href="#top" aria-label="Choir home">
            <Logo />
            <span>Choir</span>
          </a>
          <span className="footer-note">One shared AI. Private threads. Team decisions.</span>
        </div>
        <div className="footer-links">
          <a href="#why">Why Choir</a>
          <a href="#teams">For small teams</a>
          <a href="#privacy">Privacy</a>
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
