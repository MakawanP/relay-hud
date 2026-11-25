# RelayHUD Feature Map

| Feature | How Users Reach It | What Proves It Works |
| :--- | :--- | :--- |
| 3-Account Topology Canvas | `/` (Live or `?mode=demo`) | Local host node + Dispatch hub on left; Google #1, Google #2, Claude #1 nodes on right; SVG Bezier wires + right green cluster bus aligned; zoom `50%–150%` works |
| Connect 3 Accounts (2 Google + 1 Claude) | Toolbar `Accounts` or card `Connect` button | Save encrypted API key, configure Google OAuth 2.0, or select Local CLI; `Test Connection` executes live server probe; UI only ever receives masked key preview |
| Per-Account Routing Toggles | `Takes Work` & `Auto Failover` switches on account cards | Toggling persists via `PATCH /api/accounts/[id]`; reload preserves state; ARW excludes disabled accounts |
| Job Selection & Right Inspector | Click any job card on canvas or left column | Card shows green border; animated amber dashed Bezier curve connects origin to job; right panel shows WHERE, WHEN, USAGE, TOKENS, COMMAND, STARTED BY THIS, SENT ELSEWHERE |
| Live Streaming Terminal Drawer | Click `Show Log` or select a running/completed job | Bottom drawer opens with job title, `Follow` toggle, `Copy` action, and live SSE streamed output chunks |
| New Job & Parallel Fan-Out | Toolbar `+ New Job` or `Jobs by Chat` | Dispatch to Auto-Route (ARW), specific account, or Fan-Out across all 3 accounts; streams real responses or runs simulated demo execution |
| Usage Limits & Quota Bars | Toolbar `Usage Limits` + card LED Capacity bar | Shows per-account RPM, token budget, Anthropic rate-limit headers, LED segments shift green->amber->red, ceiling edits persist |
| Analytics, Host Health & Alerts | Toolbar `Analytics`, `Health`, `Alerts` | Live macOS host CPU/memory/load stats render; account usage charts render; failed/warning alerts can be dismissed or retried on failover |
| Responsive & Edge States | Resize to `390x844` or unconfigured/offline state | Mobile layout collapses cleanly without overflow; unconfigured accounts show crisp setup CTAs; errors display actionable plain-language recovery |
