---
name: verify-app
description: Runtime verification protocol for RelayHUD. Run static gates, start the real local server, verify live API/SSE flows, and capture desktop + mobile screenshots.
---

# Verify RelayHUD

Run every check below before claiming a change works:

1. **Static Gates**:
   ```bash
   npm run check && npm run build
   ```
2. **Live Server Boot**:
   ```bash
   npm run start
   ```
   Confirm `http://localhost:3456/api/hud` returns HTTP `200` with valid JSON containing `accounts` (3 slots: `google-1`, `google-2`, `claude-1`), `host`, `jobs`, and `alerts`.
3. **API & Security Checks**:
   - Confirm credential payloads returned by `GET /api/accounts` only include masked previews (`maskedKey`), never plaintext secrets.
   - Verify `PATCH /api/accounts/google-1` toggles `takesWork` / `autoFailover` and persists across reload.
   - Verify `POST /api/jobs` validates inputs (400 on invalid payloads) and rejects live dispatch to unconfigured accounts cleanly.
   - Verify `GET /api/hud?mode=demo` returns complete simulated 3-account topology for visual/interaction testing.
4. **Visual & Interactive Runtime Verification**:
   - Open `http://localhost:3456` and `http://localhost:3456/?mode=demo` in headless Playwright at `1440x900`, `1024x762`, and `390x844`.
   - Assert zero uncaught page errors and zero console errors.
   - Exercise interactive flows from `references/feature-map.md`: select job card (updates green border, animated amber Bezier wire, right inspector, bottom terminal), open Accounts modal, open Usage Limits modal, open New Job composer, toggle `Takes Work`.
   - Capture screenshots and visually inspect them against the reference layout.
