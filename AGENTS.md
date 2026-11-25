# RelayHUD — Agent Guide

Multi-account AI orchestration HUD inspired by Parallem HUD, built for **2 Google accounts + 1 Claude account** on macOS.

## Architecture Map
- `src/domain/` — Shared TypeScript domain contracts, pricing/quota formulas, routing policies (pure, zero I/O).
- `src/server/` — Server-only modules: AES-256-GCM credential vault (`vault.ts`), account/job state store (`store.ts`), Google Gemini API/OAuth & Anthropic Claude API/CLI providers (`providers/`), macOS host telemetry (`host-telemetry.ts`), ARW failover router & live job runner (`runner.ts`).
- `src/app/api/` — Next.js Route Handlers validating all inputs via Zod; never leak decrypted secrets.
- `src/components/` — Reusable dark HUD UI primitives (LED capacity bar, status pill, switch, modal shell).
- `src/features/hud/` — Interactive two-column topology canvas, SVG Bezier wire overlay, orthogonal green failover bus, inspector panel, live terminal drawer, and toolbar overlays.

## Commands
- `npm run dev` — Start local HUD on `http://localhost:3456`
- `npm run check` — Strict typecheck (`tsc --noEmit`) + ESLint + Vitest suite
- `npm run build` — Production Next.js build
- `npm run start` — Serve production build on `http://localhost:3456`

## Guardrails & Verification
- UI code (`src/features/`, `src/components/`) must never import `@/server/*` (enforced by ESLint).
- Zero `any`, `@ts-ignore`, empty `catch`, or `setTimeout(..., 0)` hacks (enforced by ESLint).
- Verify all changes against the running app using `.agents/skills/verify-app/SKILL.md`.
