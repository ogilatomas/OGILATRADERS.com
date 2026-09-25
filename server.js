const express = require('express');
const session = require('express-session');
const path = require('path');
const { DerivSession } = require('./lib/deriv-client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'ogila-demo-session-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax' }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'OGILA TRADERS', mode: 'demo' }));
app.get('/api/config', (req, res) => res.json({
  derivConfigured: Boolean(process.env.DERIV_CLIENT_ID),
  aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  mode: 'demo'
}));

// --- Deriv OAuth & real account trading -------------------------------------
// IMPORTANT: this places REAL trades on whichever Deriv account the user
// selects (their real-money account OR their free virtual/demo account —
// both work the same way through this flow; the user chooses which to use
// when they authorize on Deriv's login screen).

function derivConfigured() {
  return Boolean(process.env.DERIV_CLIENT_ID);
}

app.get('/auth/deriv/login', (req, res) => {
  if (!derivConfigured()) {
    return res.redirect('/?derivError=' + encodeURIComponent('Deriv login is not configured yet.'));
  }
  res.redirect(`https://oauth.deriv.com/oauth2/authorize?app_id=${encodeURIComponent(process.env.DERIV_CLIENT_ID)}`);
});

// Deriv redirects back here with acct1/token1/cur1, acct2/token2/cur2, ...
// one triple per account the user has (real + virtual). This route's full
// URL must exactly match the Redirect URL registered on your Deriv app.
app.get('/auth/deriv/callback', (req, res) => {
  const q = req.query;
  const accounts = [];
  let i = 1;
  while (q['acct' + i]) {
    const loginid = q['acct' + i];
    accounts.push({
      loginid,
      token: q['token' + i],
      currency: q['cur' + i] || 'USD',
      isVirtual: loginid.startsWith('VRTC') || loginid.startsWith('VR')
    });
    i++;
  }
  if (!accounts.length) {
    return res.redirect('/?derivError=' + encodeURIComponent('Deriv login did not return an account.'));
  }
  req.session.deriv = {
    accounts,
    // default to a virtual/demo account if the user has one, for safety
    activeLoginid: (accounts.find(a => a.isVirtual) || accounts[0]).loginid
  };
  res.redirect('/?derivConnected=1');
});

app.post('/auth/deriv/logout', (req, res) => {
  delete req.session.deriv;
  res.json({ ok: true });
});

app.get('/api/deriv/accounts', (req, res) => {
  const d = req.session.deriv;
  if (!d) return res.json({ connected: false, configured: derivConfigured(), accounts: [], active: null });
  res.json({
    connected: true,
    configured: true,
    accounts: d.accounts.map(a => ({ loginid: a.loginid, currency: a.currency, isVirtual: a.isVirtual })),
    active: d.activeLoginid
  });
});

app.post('/api/deriv/select', (req, res) => {
  const d = req.session.deriv;
  if (!d) return res.status(401).json({ error: 'Not connected to Deriv.' });
  const acct = d.accounts.find(a => a.loginid === req.body.loginid);
  if (!acct) return res.status(400).json({ error: 'Unknown account.' });
  d.activeLoginid = acct.loginid;
  res.json({ ok: true, active: acct.loginid, isVirtual: acct.isVirtual, currency: acct.currency });
});

function getActiveAccount(req) {
  const d = req.session.deriv;
  if (!d) return null;
  return d.accounts.find(a => a.loginid === d.activeLoginid) || null;
}

app.get('/api/deriv/balance', async (req, res) => {
  const acct = getActiveAccount(req);
  if (!acct) return res.status(401).json({ error: 'No active Deriv account.' });

  const session = new DerivSession(process.env.DERIV_CLIENT_ID);
  try {
    await session.connect();
    await session.authorize(acct.token);
    const bal = await session.balance();
    res.json({ balance: bal.balance, currency: bal.currency, loginid: acct.loginid, isVirtual: acct.isVirtual });
  } catch (err) {
    console.error('Deriv balance error:', err.message);
    res.status(502).json({ error: 'Could not fetch balance from Deriv.' });
  } finally {
    session.close();
  }
});

// Places one REAL rise/fall contract on the active account and waits for it
// to settle. This moves real funds if the active account is not virtual.
app.post('/api/deriv/trade', async (req, res) => {
  const acct = getActiveAccount(req);
  if (!acct) return res.status(401).json({ error: 'No active Deriv account.' });

  const { symbol, direction, stake } = req.body || {};
  if (!symbol || !['RISE', 'FALL'].includes(direction) || !(Number(stake) > 0)) {
    return res.status(400).json({ error: 'Invalid trade request.' });
  }

  const session = new DerivSession(process.env.DERIV_CLIENT_ID);
  try {
    await session.connect();
    await session.authorize(acct.token);
    const bought = await session.buyRiseFall({
      symbol, direction, stake: Number(stake), duration: 5, durationUnit: 't', currency: acct.currency
    });
    const settled = await session.waitForSettlement(bought.contractId);
    res.json({
      isVirtual: acct.isVirtual,
      loginid: acct.loginid,
      contractId: bought.contractId,
      buyPrice: bought.buyPrice,
      payout: bought.payout,
      ...settled
    });
  } catch (err) {
    console.error('Deriv trade error:', err.message);
    res.status(502).json({ error: err.message || 'Trade failed on Deriv.' });
  } finally {
    session.close();
  }
});

// --- AI Analysis -----------------------------------------------------------
// Takes recent price ticks for the visible markets and asks Claude for a
// short structured trend/momentum/risk readout. Requires ANTHROPIC_API_KEY
// to be set in the environment (Render dashboard -> Environment).
const analyzeLimiter = { lastCall: 0 };

app.post('/api/analyze', async (req, res) => {
  const now = Date.now();
  if (now - analyzeLimiter.lastCall < 4000) {
    return res.status(429).json({ error: 'Please wait a few seconds between analyses.' });
  }
  analyzeLimiter.lastCall = now;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({
      fallback: true,
      trend: 'UNAVAILABLE',
      momentum: 'N/A',
      risk: 'N/A',
      summary: 'AI Analysis is not connected yet. Set ANTHROPIC_API_KEY in your Render environment variables to enable live analysis.'
    });
  }

  const { markets } = req.body || {};
  if (!markets || typeof markets !== 'object') {
    return res.status(400).json({ error: 'Missing market data.' });
  }

  try {
    const prompt = `You are a market-structure analyst for a DEMO trading dashboard (no real trades, synthetic indices only).
Given this recent tick data (JSON, most recent price last), respond with ONLY a JSON object, no prose, no markdown fences, in this exact shape:
{"trend":"UPTREND|DOWNTREND|RANGE","momentum":"Weak|Moderate|Strong","risk":"Low|Medium|High","score":<0-100 integer>,"summary":"<one or two plain sentences, no financial advice, demo context>"}

Tick data:
${JSON.stringify(markets)}`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Anthropic API error:', apiRes.status, errText);
      return res.status(502).json({ error: 'AI analysis service returned an error.' });
    }

    const data = await apiRes.json();
    const raw = (data.content || []).map(b => b.text || '').join('').trim();
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse AI response as JSON:', raw);
      return res.status(502).json({ error: 'AI analysis returned an unexpected format.' });
    }

    res.json({ fallback: false, ...parsed });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});

// --- Strategies (demo, per-session) ----------------------------------------
// Lightweight persistence so a saved bot strategy survives a page refresh
// within the same browser session. Not shared between users/devices.
app.get('/api/strategies', (req, res) => {
  res.json({ strategies: req.session.strategies || [] });
});

app.post('/api/strategies', (req, res) => {
  const s = req.body;
  if (!s || !s.symbol || !s.direction || !s.stake) {
    return res.status(400).json({ error: 'Strategy needs symbol, direction and stake.' });
  }
  if (!req.session.strategies) req.session.strategies = [];
  const strategy = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    symbol: String(s.symbol).slice(0, 40),
    direction: s.direction === 'FALL' ? 'FALL' : 'RISE',
    stake: Math.max(1, Math.min(1000, Number(s.stake) || 10)),
    takeProfit: Math.max(0, Math.min(100, Number(s.takeProfit) || 0)),
    stopLoss: Math.max(0, Math.min(100, Number(s.stopLoss) || 0)),
    execution: s.execution === 'deriv' ? 'deriv' : 'simulated',
    createdAt: new Date().toISOString()
  };
  req.session.strategies.push(strategy);
  res.json({ strategy });
});

app.delete('/api/strategies/:id', (req, res) => {
  if (!req.session.strategies) req.session.strategies = [];
  req.session.strategies = req.session.strategies.filter(s => s.id !== req.params.id);
  res.json({ ok: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OGILA TRADERS running on port ${PORT}`);
});
