# RelayHUD

A dark macOS telemetry and multi-account AI orchestration HUD inspired by Parallem HUD — built to connect, monitor, and route work across **unlimited AI accounts** (starting with 2 Google + 1 Claude, plus OpenAI, OpenRouter, Groq, Local Ollama, and custom OIDC-backed gateways) with **Google & Enterprise OIDC SSO**.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3456](http://localhost:3456) in your browser to monitor live Apple Silicon host telemetry, local `ps` processes, and connect your AI accounts.

## Features

- **Unlimited Pluggable Connectors**: Start with 2 Google + 1 Claude slots or add unlimited connectors via **Accounts → + Add Connector** (`Google Gemini`, `Anthropic Claude`, `OpenAI`, `OpenRouter`, `Groq`, `Local Ollama / LM Studio`, or any OpenAI-compatible `/v1` gateway).
- **Local AES-256-GCM Credential Vault**: All API keys, OAuth refresh tokens, and OIDC client secrets are encrypted at rest in `.data/vault.enc` (`0600` permissions) and never sent back to the browser.
- **Google + Generic OIDC SSO**:
  - **App Unlock SSO**: Protect remote tunnel access with Google Sign-In or any OIDC provider (Okta, Microsoft Entra ID, Auth0, Keycloak) using PKCE `S256` and a fail-closed email/domain allowlist, alongside an optional one-time passcode fallback.
  - **Account OAuth / OIDC**: Link unlimited Google accounts via Google OAuth 2.0 (`select_account consent`) or authenticate OpenAI-compatible AI gateways via OIDC Bearer tokens.
- **Two-Column Topology Canvas + Scalable Failover Bus**: Real-time macOS host telemetry (`os` / `sysctl` / `vm_stat` / `ps`) and Dispatch Router Hub on the left; dynamic account pool on the right connected by Bezier wires, protocol badges (`API`, `OAuth`, `SSO`, `CLI`, `Failover`), and a scalable right-edge failover trunk spine.
- **ARW Auto-Routing & Failover**: Route via `Auto-Balance`, `Priority Order`, `Google-First`, `Claude-First`, or `Lowest Latency`, filter by `#pool` tags, or **Fan-Out** in parallel with automatic `429` / `5xx` failover.

## Remote Tunnel Mode

```bash
RELAY_HUD_REMOTE_PASSCODE="your-strong-passcode" npm run build && npm run start
```

Point a Cloudflare Tunnel (`cloudflared tunnel --url http://127.0.0.1:3456`) at the local server. All non-loopback requests require either a valid passcode or an allowlisted Google / OIDC SSO session cookie (`HttpOnly; Secure; SameSite=Lax`).

## Verification

```bash
npm run check   # strict TypeScript + ESLint + Vitest suite
npm run build   # production Next.js build
```
