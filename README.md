# OGILA TRADERS — Professional Dashboard

A trading-dashboard terminal with **real live market prices**, **real AI market analysis**, a **working strategy/bot builder**, and **real Deriv account trading** (real money or Deriv's free virtual/demo account — your choice, made at login).

## ⚠️ Read before enabling real trading

Once a user connects a **real-money** Deriv account and sets a strategy's Execution to "Real Deriv account", the bot places actual contracts with actual funds. There is no simulation in that path. Before pointing this at real money:
- Test extensively with a Deriv **virtual/demo account** first (the account picker labels these clearly, and defaults to a virtual account when available).
- The bot has no circuit breaker beyond the take-profit/stop-loss % you set per strategy and a balance-depleted stop — there's no daily loss cap, no max-trades-per-session limit, and no cooldown after a losing streak. Consider adding these before letting anyone but you use it live.
- Session-based token storage (below) is fine for a demo; harden it (encrypted store, short-lived tokens, re-auth prompts) before real users' funds depend on it.

## What's actually live now

- **Prices** — Volatility 75, Boom 500, Crash 500 stream live from Deriv's public WebSocket feed (no login needed for this part).
- **AI Analysis** — sends recent live ticks to your server, which calls the real Anthropic API for a trend/momentum/risk readout. Requires `ANTHROPIC_API_KEY`.
- **Strategy Builder** — save a rule (market, direction, stake, TP/SL %, and now **Execution**: Simulated or Real Deriv account).
- **Deriv account connection** — "Connect Deriv Account" starts a real OAuth login on Deriv's own site. Deriv hands back every account the user owns (real and virtual); the dropdown lets them pick which is active, and clearly flags real-money accounts in red with a warning banner.
- **Run Bot** — for a Simulated strategy, trades are decided locally from real price direction against your local demo balance (no funds move). For a Real Deriv strategy, each cycle places an actual 5-tick rise/fall contract via Deriv's authenticated API on whichever account is active, waits for it to settle, and logs the real result. The balance shown updates from Deriv's real balance endpoint.

## Deploy on Render

- Runtime: Node · Branch: main · Build Command: `npm install` · Start Command: `npm start`

### Environment variables

| Variable | Required for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Real AI Analysis | console.anthropic.com |
| `SESSION_SECRET` | Session security | Any random string; set this in production |
| `DERIV_CLIENT_ID` | Deriv login & real trading | The **App ID** from your registered Deriv application (see below) |
| `DERIV_REDIRECT_URI` | Documentation only | Not sent in the OAuth request — Deriv redirects to whatever URL is registered against your App ID (see below). Keep this env var in sync with that registration for your own reference. |

### Register a Deriv application (one-time)

1. Log into Deriv, go to the API Token / Application registration page (**api.deriv.com → Register Application**, or your Deriv account's "Manage Applications").
2. Set the **Redirect URL** to exactly: `https://<your-render-domain>/auth/deriv/callback`
3. Copy the generated **App ID** into `DERIV_CLIENT_ID` on Render.
4. Redeploy. "Connect Deriv Account" will now log in for real.

## Still not built (by design, for safety)

- No spend/loss caps beyond per-strategy TP/SL.
- No email/SMS confirmation before a real trade fires from the bot loop — only the one-time checkbox at strategy save time.
- Deriv tokens live in the server session (in-memory) only; they're lost on restart and never sent to the browser.

If you want any of the above hardened before real users touch this, that's the natural next step.
