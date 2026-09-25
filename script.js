const $ = (s) => document.querySelector(s);
const toastEl = $('#toast');
let toastTimer;
function toast(message){ clearTimeout(toastTimer); toastEl.textContent=message; toastEl.classList.add('show'); toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2600); }
function scrollToId(id){ document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'center'}); }

// ---------------------------------------------------------------------------
// LIVE PRICES — Deriv public WebSocket feed (no login required for ticks)
// ---------------------------------------------------------------------------
const SYMBOLS = ['R_75', 'BOOM500', 'CRASH500'];
const priceState = {};
SYMBOLS.forEach(s => priceState[s] = { last: null, open: null, history: [] });

let priceSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let derivAppId = '1089'; // falls back to Deriv's shared test app_id if none configured

async function connectPriceFeed(){
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    if (cfg.priceAppId) derivAppId = cfg.priceAppId;
  } catch (e) { /* keep default */ }

  try {
    priceSocket = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(derivAppId)}`);
  } catch (e) {
    setFeedStatus(false);
    scheduleReconnect();
    return;
  }

  priceSocket.onopen = () => {
    reconnectAttempts = 0;
    setFeedStatus(true);
    SYMBOLS.forEach(symbol => priceSocket.send(JSON.stringify({ ticks: symbol, subscribe: 1 })));
  };

  priceSocket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch (e) { return; }
    if (data.msg_type === 'tick' && data.tick) handleTick(data.tick.symbol, Number(data.tick.quote));
    if (data.error) console.error('Deriv API error:', data.error.message);
  };

  priceSocket.onclose = () => { setFeedStatus(false); scheduleReconnect(); };
  priceSocket.onerror = () => { priceSocket.close(); };
}

function scheduleReconnect(){
  clearTimeout(reconnectTimer);
  reconnectAttempts++;
  // back off up to 30s so repeated 520s don't hammer Deriv's edge and make things worse
  const delay = Math.min(4000 * reconnectAttempts, 30000);
  reconnectTimer = setTimeout(connectPriceFeed, delay);
}

function setFeedStatus(live){
  const statusEl = $('#feedStatus');
  const pulseEl = $('#feedPulse');
  if (!statusEl) return;
  statusEl.textContent = live ? 'LIVE MARKET FEED' : 'RECONNECTING…';
  pulseEl.style.background = live ? '#1ee5a6' : '#b56e3d';
  pulseEl.style.boxShadow = live ? '0 0 12px #1ee5a6' : '0 0 12px #b56e3d';
}

function handleTick(symbol, quote){
  const state = priceState[symbol];
  if (!state || !Number.isFinite(quote)) return;
  if (state.open === null) state.open = quote;
  state.last = quote;
  state.history.push(quote);
  if (state.history.length > 60) state.history.shift();

  const priceEl = $('#price-' + symbol);
  const changeEl = $('#change-' + symbol);
  if (priceEl) priceEl.textContent = quote.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (changeEl) {
    const pct = ((quote - state.open) / state.open) * 100;
    const sign = pct >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${pct.toFixed(2)}%`;
    changeEl.style.color = pct >= 0 ? '#c7a33a' : '#b56e3d';
  }
}

connectPriceFeed();

// ---------------------------------------------------------------------------
// AI ANALYSIS
// ---------------------------------------------------------------------------
async function runAnalysis(){
  const btn = $('#analyzeBtn');
  const summaryEl = $('#aiSummary');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  if (summaryEl) summaryEl.textContent = 'Reading live ticks and generating a readout…';

  const markets = {};
  SYMBOLS.forEach(s => { markets[s] = priceState[s].history.slice(-20); });

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markets })
    });
    const data = await res.json();

    if (!res.ok) { toast(data.error || 'Analysis failed.'); if (summaryEl) summaryEl.textContent = 'Analysis failed — try again in a moment.'; return; }
    if (data.fallback) { toast('AI Analysis needs setup — see README (ANTHROPIC_API_KEY).'); if (summaryEl) summaryEl.textContent = data.summary; return; }

    $('#scanScore').innerHTML = `${data.score}<span>%</span>`;
    $('#scanMeter').style.width = `${data.score}%`;
    $('#scanMomentum').textContent = data.momentum;
    $('#scanTrend').textContent = data.trend;
    $('#scanRisk').textContent = data.risk;
    $('#scanSubtitle').textContent = 'Live AI readout across tracked markets.';
    if (summaryEl) summaryEl.textContent = data.summary;
    toast(`AI Analysis: ${data.trend} · momentum ${data.momentum} · risk ${data.risk}`);
  } catch (err) {
    toast('Could not reach the analysis service.');
    if (summaryEl) summaryEl.textContent = 'Could not reach the analysis service.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Analyze market'; }
  }
}

// ---------------------------------------------------------------------------
// DERIV ACCOUNT CONNECTION (real OAuth login, real or virtual account)
// ---------------------------------------------------------------------------
const derivState = { connected: false, accounts: [], active: null, isVirtual: null, currency: 'USD' };

function connectDerivAccount(){ window.location.href = '/auth/deriv/login'; }

async function checkDerivStatus(){
  try {
    const res = await fetch('/api/deriv/accounts');
    const data = await res.json();
    derivState.connected = data.connected;
    derivState.accounts = data.accounts || [];
    derivState.active = data.active;
    updateDerivUI();
    if (data.connected) await refreshRealBalance();
  } catch (e) { /* silent */ }
}

function updateDerivUI(){
  const btn = $('#derivConnectBtn');
  const panel = $('#derivPanel');
  const badge = $('#accountBadge');
  const select = $('#derivAccountSelect');
  const warning = $('#derivRealWarning');

  if (!derivState.connected) {
    btn.textContent = 'Connect Deriv Account';
    btn.classList.remove('connected');
    panel.hidden = true;
    badge.textContent = 'LOCAL DEMO';
    badge.className = 'acct-badge local';
    return;
  }

  btn.textContent = 'Deriv Connected ✓';
  btn.classList.add('connected');
  panel.hidden = false;

  select.innerHTML = derivState.accounts.map(a =>
    `<option value="${a.loginid}" ${a.loginid === derivState.active ? 'selected' : ''}>${a.loginid} — ${a.currency} ${a.isVirtual ? '(Virtual/Demo)' : '(REAL MONEY)'}</option>`
  ).join('');

  const active = derivState.accounts.find(a => a.loginid === derivState.active);
  derivState.isVirtual = active ? active.isVirtual : null;
  derivState.currency = active ? active.currency : 'USD';
  warning.hidden = !(active && !active.isVirtual);
  badge.textContent = active && active.isVirtual ? 'DERIV VIRTUAL' : 'DERIV REAL';
  badge.className = 'acct-badge ' + (active && active.isVirtual ? 'virtual' : 'real');
  $('#balanceCurrency').textContent = derivState.currency;
}

async function selectDerivAccount(loginid){
  try {
    const res = await fetch('/api/deriv/select', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginid })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not switch account.'); return; }
    derivState.active = data.active;
    updateDerivUI();
    await refreshRealBalance();
    toast(`Switched to ${data.active} (${data.isVirtual ? 'Virtual' : 'REAL MONEY'}).`);
  } catch (e) { toast('Could not switch account.'); }
}

async function disconnectDeriv(){
  if (activeBot.strategy && activeBot.strategy.execution === 'deriv' && running) stopBot('Bot stopped — Deriv account disconnected.');
  await fetch('/auth/deriv/logout', { method: 'POST' }).catch(() => {});
  derivState.connected = false; derivState.accounts = []; derivState.active = null;
  updateDerivUI();
  $('#balance').textContent = '10,000.00';
  $('#balanceCurrency').textContent = 'USD';
  toast('Disconnected from Deriv. Back to local demo balance.');
}

async function refreshRealBalance(){
  if (!derivState.connected) return;
  try {
    const res = await fetch('/api/deriv/balance');
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not fetch Deriv balance.'); return; }
    $('#balance').textContent = Number(data.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $('#balanceCurrency').textContent = data.currency;
  } catch (e) { /* silent */ }
}

(function initDerivFromUrl(){
  const params = new URLSearchParams(window.location.search);
  if (params.get('derivConnected')) { toast('Deriv account connected.'); history.replaceState({}, '', '/'); }
  if (params.get('derivError')) { toast(params.get('derivError')); history.replaceState({}, '', '/'); }
})();
checkDerivStatus();

// ---------------------------------------------------------------------------
// STRATEGY BUILDER
// ---------------------------------------------------------------------------
let strategies = [];
const activeBot = { running: false, strategy: null, startBalance: 0 };

function openStrategyModal(){ $('#strategyModal').classList.add('show'); loadStrategies(); }
function closeStrategyModal(){ $('#strategyModal').classList.remove('show'); }

function onExecutionChange(){
  const isDeriv = $('#stExecution').value === 'deriv';
  $('#stConfirmRealWrap').hidden = !isDeriv;
  if (isDeriv && !derivState.connected) toast('Connect a Deriv account to use real execution.');
}

async function loadStrategies(){
  try {
    const res = await fetch('/api/strategies');
    const data = await res.json();
    strategies = data.strategies || [];
    renderStrategies();
  } catch (e) { toast('Could not load saved strategies.'); }
}

function renderStrategies(){
  const list = $('#strategyList');
  if (!strategies.length) { list.innerHTML = '<span class="empty">No strategies saved yet.</span>'; return; }
  list.innerHTML = strategies.map(s => `
    <div class="strategy-item">
      <span><b>${labelSymbol(s.symbol)}</b> · ${s.direction} · ${s.stake} stake · ${s.execution === 'deriv' ? 'REAL DERIV' : 'SIMULATED'} · TP ${s.takeProfit}% / SL ${s.stopLoss}%</span>
      <span style="display:flex;gap:6px">
        <button class="use-btn" onclick="setActiveStrategy('${s.id}')">Use</button>
        <button class="del-btn" onclick="deleteStrategy('${s.id}')">✕</button>
      </span>
    </div>`).join('');
}

function labelSymbol(sym){ return { R_75: 'Volatility 75', BOOM500: 'Boom 500', CRASH500: 'Crash 500' }[sym] || sym; }

$('#strategyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const execution = $('#stExecution').value;

  if (execution === 'deriv') {
    if (!derivState.connected) { toast('Connect a Deriv account first.'); return; }
    if (!derivState.isVirtual && !$('#stConfirmReal').checked) {
      toast('Please confirm you understand this uses real funds.');
      return;
    }
  }

  const payload = {
    symbol: $('#stSymbol').value,
    direction: $('#stDirection').value,
    stake: Number($('#stStake').value),
    takeProfit: Number($('#stTakeProfit').value),
    stopLoss: Number($('#stStopLoss').value),
    execution
  };
  try {
    const res = await fetch('/api/strategies', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Could not save strategy.'); return; }
    strategies.push(data.strategy);
    renderStrategies();
    setActiveStrategy(data.strategy.id);
    toast('Strategy saved and set active.');
  } catch (err) { toast('Could not save strategy.'); }
});

async function deleteStrategy(id){
  try {
    await fetch('/api/strategies/' + id, { method: 'DELETE' });
    strategies = strategies.filter(s => s.id !== id);
    if (activeBot.strategy && activeBot.strategy.id === id) {
      activeBot.strategy = null;
      $('#activeStrategyLabel').textContent = 'None — build one to run the bot';
    }
    renderStrategies();
  } catch (e) { toast('Could not delete strategy.'); }
}

function setActiveStrategy(id){
  const s = strategies.find(x => x.id === id);
  if (!s) return;
  activeBot.strategy = s;
  const mode = s.execution === 'deriv' ? (derivState.isVirtual ? 'REAL Deriv (virtual)' : 'REAL Deriv (REAL MONEY)') : 'Simulated';
  $('#activeStrategyLabel').textContent = `${labelSymbol(s.symbol)} · ${s.direction} · ${s.stake} stake · ${mode}`;
  closeStrategyModal();
}

// ---------------------------------------------------------------------------
// BOT LOOP — simulated locally, or real trades via the Deriv API
// ---------------------------------------------------------------------------
let running = false;
let botTimer = null;

function toggleBot(){
  if (!running) {
    if (!activeBot.strategy) { toast('Build and select a strategy first.'); openStrategyModal(); return; }
    if (activeBot.strategy.execution === 'deriv' && !derivState.connected) { toast('Deriv account disconnected. Reconnect or switch to simulated.'); return; }
    startBot();
  } else {
    stopBot('Demo bot stopped.');
  }
}

async function startBot(){
  running = true;
  activeBot.startBalance = getBalance();
  $('#runIcon').textContent = '■';
  $('#runText').textContent = 'Stop Bot';
  $('#botStatus').textContent = 'RUNNING';
  toast(activeBot.strategy.execution === 'deriv' ? 'Bot started — placing REAL trades on Deriv.' : 'Demo bot started. No real trades are executed.');
  tradeCycle();
}

function stopBot(message){
  running = false;
  clearTimeout(botTimer);
  $('#runIcon').textContent = '▶';
  $('#runText').textContent = 'Run Demo Bot';
  $('#botStatus').textContent = 'READY';
  if (message) toast(message);
}

function speedIntervalMs(){
  const speed = Number($('#speedRange').value);
  return { 1: 6000, 2: 3500, 3: 1800 }[speed] || 3500;
}

async function tradeCycle(){
  if (!running || !activeBot.strategy) return;
  const s = activeBot.strategy;

  try {
    let result;
    if (s.execution === 'deriv') {
      result = await executeDerivTrade(s);
    } else {
      result = executeLocalSimTrade(s);
    }

    if (!result) { botTimer = setTimeout(tradeCycle, speedIntervalMs()); return; }

    const balance = getBalance();
    const changePct = ((balance - activeBot.startBalance) / activeBot.startBalance) * 100;
    if (s.takeProfit > 0 && changePct >= s.takeProfit) { stopBot(`Take-profit hit (+${changePct.toFixed(1)}%). Bot stopped.`); return; }
    if (s.stopLoss > 0 && changePct <= -s.stopLoss) { stopBot(`Stop-loss hit (${changePct.toFixed(1)}%). Bot stopped.`); return; }
    if (balance <= 0) { stopBot('Balance depleted. Bot stopped.'); return; }
  } catch (err) {
    stopBot('Bot stopped: ' + err.message);
    return;
  }

  if (running) botTimer = setTimeout(tradeCycle, speedIntervalMs());
}

function executeLocalSimTrade(s){
  const state = priceState[s.symbol];
  const hist = state.history;
  if (hist.length < 2) return null;

  const prev = hist[hist.length - 2];
  const curr = hist[hist.length - 1];
  const movedUp = curr > prev;
  const predictedUp = s.direction === 'RISE';
  const win = movedUp === predictedUp;

  const payoutRate = 0.85;
  const pnl = win ? +(s.stake * payoutRate).toFixed(2) : -s.stake;
  adjustBalance(pnl);
  logTrade(s, win, pnl, curr, 'SIM');
  return { win, pnl };
}

async function executeDerivTrade(s){
  const res = await fetch('/api/deriv/trade', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: s.symbol, direction: s.direction, stake: s.stake })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Deriv trade failed.');

  await refreshRealBalance();
  logTrade(s, data.isWin, data.profit, data.sellPrice || data.buyPrice, data.isVirtual ? 'VIRTUAL' : 'REAL');
  return { win: data.isWin, pnl: data.profit };
}

function getBalance(){ return Number($('#balance').textContent.replace(/,/g, '')) || 0; }
function adjustBalance(delta){
  const next = Math.max(0, getBalance() + delta);
  $('#balance').textContent = next.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function logTrade(strategy, win, pnl, price, tag){
  const log = $('#tradeLog');
  const empty = log.querySelector('.empty');
  if (empty) empty.remove();
  const row = document.createElement('div');
  row.className = 'trade-row ' + (win ? 'win' : 'loss');
  const time = new Date().toLocaleTimeString();
  const priceLabel = Number.isFinite(price) ? price.toFixed(2) : '—';
  row.innerHTML = `<span>${time} · ${labelSymbol(strategy.symbol)} · ${strategy.direction} @ ${priceLabel} · [${tag}]</span><span>${win ? 'WIN' : 'LOSS'} ${pnl >= 0 ? '+' : ''}${Number(pnl).toFixed(2)}</span>`;
  log.appendChild(row);
  while (log.children.length > 25) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

$('#speedRange').addEventListener('input', e => {
  const labels = { 1: 'SAFE SPEED', 2: 'NORMAL SPEED', 3: 'FAST SPEED' };
  $('#speedValue').textContent = labels[e.target.value];
});

$('#strategyModal').addEventListener('click', (e) => { if (e.target.id === 'strategyModal') closeStrategyModal(); });

loadStrategies();
fetch('/api/health').catch(() => {});
