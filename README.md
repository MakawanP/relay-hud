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
- **Local AES-256-GCM Credential Vault**: API keys, OAuth refresh tokens, OIDC client secrets and job history (`.data/vault.enc`, `.data/state.json`, `0600`) are encrypted with a master key kept in the **macOS login Keychain**, not next to the ciphertext. Secrets are never sent back to the browser. Set `RELAY_HUD_KEYCHAIN=off` to keep the key in `.data/master.key` instead (default on Linux).
- **Google + Generic OIDC SSO**:
  - **App Unlock SSO**: Protect remote tunnel access with Google Sign-In or any OIDC provider (Okta, Microsoft Entra ID, Auth0, Keycloak) using PKCE `S256` and a fail-closed email/domain allowlist, alongside an optional one-time passcode fallback.
  - **Account OAuth / OIDC**: Link unlimited Google accounts via Google OAuth 2.0 (`select_account consent`) or authenticate OpenAI-compatible AI gateways via OIDC Bearer tokens.
- **Two-Column Topology Canvas + Scalable Failover Bus**: Real-time macOS host telemetry (`os` / `sysctl` / `vm_stat` / `ps`) and Dispatch Router Hub on the left; dynamic account pool on the right connected by Bezier wires, protocol badges (`API`, `OAuth`, `SSO`, `CLI`, `Failover`), and a scalable right-edge failover trunk spine.
- **ARW Auto-Routing & Failover**: Route via `Auto-Balance`, `Priority Order`, `Google-First`, `Claude-First`, or `Lowest Latency`, filter by `#pool` tags, or **Fan-Out** in parallel with automatic `429` / `5xx` failover.

## Remote Tunnel Mode

```bash
RELAY_HUD_REMOTE_PASSCODE="your-strong-passcode" npm run build && npm run start
```

Point a Cloudflare Tunnel (`cloudflared tunnel --url http://127.0.0.1:3456`) at the local server. All non-local requests require either a valid passcode or an allowlisted Google / OIDC SSO session cookie (`HttpOnly; Secure; SameSite=Lax`).

### How "local" is decided

A request skips sign-in only when its `Host` is loopback **and** it carries no proxy/tunnel headers (`X-Forwarded-For` from a non-loopback client, `X-Forwarded-Host` ≠ `Host`, `Forwarded`, `X-Real-IP`, `CF-Connecting-IP`, `CF-Ray`, …). Cloudflare Tunnel, ngrok and standard nginx/Caddy setups add these headers, so tunnelled traffic is always treated as remote even if the proxy rewrites `Host` to `127.0.0.1`.

If your proxy rewrites `Host` **and** strips all forwarding headers, RelayHUD cannot tell it apart from a local browser. In that case set:

```bash
RELAY_HUD_STRICT_AUTH=true   # every request, including from this Mac, needs the passcode or SSO
```

### Remote sessions are limited

- SSO allowlists, identity providers and the Google OAuth client can only be changed from this Mac (in strict mode: from a passcode session on `127.0.0.1`). A remote session cannot widen who is allowed in.
- SSO sessions are re-checked against the current allowlist on every request, and **Lock** revokes the session token server-side. Restarting the server signs everyone out.
- Failed passcode attempts are limited per client and server-wide.

### Local CLI jobs

`claude` and `gemini` CLI jobs run from an empty private temp folder with RelayHUD's environment variables removed, and Claude Code's file, shell and web tools are disabled, so a dispatched prompt cannot read `.data/` or other files on this Mac.

## Verification

```bash
npm run check   # strict TypeScript + ESLint + Vitest suite
npm run build   # production Next.js build
```
