const $ = (s) => document.querySelector(s);

const toastEl = $('#toast');
let toastTimer;

function toast(message){
  if (!toastEl) return;
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

function scrollToId(id){
  document.getElementById(id)?.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });
}


// ---------------------------------------------------------------------------
// LIVE PRICES — Deriv public WebSocket feed
// ---------------------------------------------------------------------------

const SYMBOLS = ['R_75', 'BOOM500', 'CRASH500'];

const priceState = {};

SYMBOLS.forEach(symbol => {
  priceState[symbol] = {
    last: null,
    open: null,
    history: []
  };
});

let priceSocket = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

const DERIV_PUBLIC_WS =
  'wss://api.derivws.com/trading/v1/options/ws/public';


// ---------------------------------------------------------------------------
// LIVE CHART STATE
// ---------------------------------------------------------------------------

let liveChartSymbol = 'R_75';


// ---------------------------------------------------------------------------
// CONNECT TO DERIV LIVE PRICE FEED
// ---------------------------------------------------------------------------

async function connectPriceFeed(){

  try {

    priceSocket = new WebSocket(DERIV_PUBLIC_WS);

  } catch (e) {

    console.error(
      'Could not create Deriv public WebSocket:',
      e
    );

    setFeedStatus(false);
    scheduleReconnect();

    return;
  }


  priceSocket.onopen = () => {

    reconnectAttempts = 0;

    setFeedStatus(true);

    SYMBOLS.forEach(symbol => {

      priceSocket.send(
        JSON.stringify({
          ticks: symbol,
          subscribe: 1
        })
      );

    });

  };


  priceSocket.onmessage = (event) => {

    let data;

    try {

      data = JSON.parse(event.data);

    } catch (e) {

      return;
    }


    if (
      data.msg_type === 'tick' &&
      data.tick
    ) {

      const symbol = data.tick.symbol;
      const quote = Number(data.tick.quote);

      handleTick(symbol, quote);

    }


    if (data.error) {

      console.error(
        'Deriv API error:',
        data.error.message || data.error
      );

    }


    if (Array.isArray(data.errors)) {

      data.errors.forEach(err => {

        console.error(
          'Deriv API error:',
          err.message || err
        );

      });

    }

  };


  priceSocket.onclose = () => {

    setFeedStatus(false);

    scheduleReconnect();

  };


  priceSocket.onerror = () => {

    try {
      priceSocket.close();
    } catch (e) {}

  };

}


// ---------------------------------------------------------------------------
// RECONNECT
// ---------------------------------------------------------------------------

function scheduleReconnect(){

  clearTimeout(reconnectTimer);

  reconnectAttempts++;

  const delay = Math.min(
    4000 * reconnectAttempts,
    30000
  );

  reconnectTimer = setTimeout(
    connectPriceFeed,
    delay
  );

}


// ---------------------------------------------------------------------------
// FEED STATUS
// ---------------------------------------------------------------------------

function setFeedStatus(live){

  const statusEl = $('#feedStatus');
  const pulseEl = $('#feedPulse');

  if (!statusEl) return;

  statusEl.textContent =
    live
      ? 'LIVE MARKET FEED'
      : 'RECONNECTING…';

  if (pulseEl) {

    pulseEl.style.background =
      live ? '#1ee5a6' : '#b56e3d';

    pulseEl.style.boxShadow =
      live
        ? '0 0 12px #1ee5a6'
        : '0 0 12px #b56e3d';

  }

}


// ---------------------------------------------------------------------------
// HANDLE LIVE TICK
// ---------------------------------------------------------------------------

function handleTick(symbol, quote){

  const state = priceState[symbol];

  if (
    !state ||
    !Number.isFinite(quote)
  ) {
    return;
  }


  if (state.open === null) {
    state.open = quote;
  }


  state.last = quote;

  state.history.push(quote);


  if (state.history.length > 60) {

    state.history.shift();

  }


  const priceEl =
    $('#price-' + symbol);

  const changeEl =
    $('#change-' + symbol);


  if (priceEl) {

    priceEl.textContent =
      quote.toLocaleString(
        undefined,
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      );

  }


  if (changeEl && state.open !== 0) {

    const pct =
      ((quote - state.open) / state.open) * 100;

    const sign =
      pct >= 0 ? '+' : '';

    changeEl.textContent =
      `${sign}${pct.toFixed(2)}%`;

    changeEl.style.color =
      pct >= 0
        ? '#c7a33a'
        : '#b56e3d';

  }


  if (
    $('#liveMarketPanel') &&
    symbol === liveChartSymbol
  ) {

    drawLiveChart();

  }

}


// ---------------------------------------------------------------------------
// MARKET LABEL
// ---------------------------------------------------------------------------

function labelSymbol(symbol){

  return {
    R_75: 'Volatility 75',
    BOOM500: 'Boom 500',
    CRASH500: 'Crash 500'
  }[symbol] || symbol;

}


// ---------------------------------------------------------------------------
// OPEN LIVE CHARTS
// ---------------------------------------------------------------------------

function openLiveCharts(){

  let panel =
    document.getElementById(
      'liveMarketPanel'
    );


  if (!panel) {

    panel =
      document.createElement('section');

    panel.id =
      'liveMarketPanel';

    panel.className =
      'feature-panel';

    panel.style.marginTop =
      '18px';


    panel.innerHTML = `

      <div class="panel-label">
        LIVE MARKET
      </div>

      <div
        class="panel-head"
        style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:12px;
        "
      >

        <h2 id="liveChartTitle">
          Volatility 75
        </h2>

        <button
          class="ghost"
          onclick="closeLiveCharts()"
        >
          Close
        </button>

      </div>


      <div
        style="
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          margin:12px 0;
        "
      >

        <button
          class="ghost"
          onclick="selectLiveMarket('R_75')"
        >
          Volatility 75
        </button>

        <button
          class="ghost"
          onclick="selectLiveMarket('BOOM500')"
        >
          Boom 500
        </button>

        <button
          class="ghost"
          onclick="selectLiveMarket('CRASH500')"
        >
          Crash 500
        </button>

      </div>


      <div
        id="liveMarketPrice"
        style="
          font-size:28px;
          font-weight:800;
          margin-bottom:10px;
        "
      >
        —
      </div>


      <canvas
        id="liveMarketCanvas"
        height="280"
        style="
          width:100%;
          display:block;
          background:rgba(0,0,0,.18);
          border-radius:14px;
        "
      ></canvas>


      <div
        id="liveMarketStatus"
        style="
          margin-top:10px;
          opacity:.75;
        "
      >
        Waiting for live ticks…
      </div>

    `;


    const target =
      document.querySelector(
        '.tools-grid'
      );


    if (target) {

      target.appendChild(panel);

    } else {

      document.querySelector(
        'main'
      )?.appendChild(panel);

    }

  }


  panel.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });


  drawLiveChart();

}


// ---------------------------------------------------------------------------
// SELECT MARKET FOR CHART
// ---------------------------------------------------------------------------

function selectLiveMarket(symbol){

  if (!priceState[symbol]) {
    return;
  }

  liveChartSymbol = symbol;


  const title =
    $('#liveChartTitle');

  if (title) {

    title.textContent =
      labelSymbol(symbol);

  }


  drawLiveChart();

}


// ---------------------------------------------------------------------------
// CLOSE LIVE CHART
// ---------------------------------------------------------------------------

function closeLiveCharts(){

  const panel =
    $('#liveMarketPanel');

  if (panel) {

    panel.remove();

  }

}


// ---------------------------------------------------------------------------
// DRAW LIVE LINE CHART
// ---------------------------------------------------------------------------

function drawLiveChart(){

  const canvas =
    $('#liveMarketCanvas');

  const state =
    priceState[liveChartSymbol];


  if (
    !canvas ||
    !state
  ) {
    return;
  }


  const price =
    $('#liveMarketPrice');

  const status =
    $('#liveMarketStatus');


  if (state.last === null) {

    if (price) {
      price.textContent = '—';
    }

    if (status) {
      status.textContent =
        'Waiting for live ticks…';
    }

    return;

  }


  if (price) {

    price.textContent =
      state.last.toLocaleString(
        undefined,
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      );

  }


  if (status) {

    status.textContent =
      'LIVE • ' +
      labelSymbol(liveChartSymbol);

  }


  if (state.history.length < 2) {
    return;
  }


  const ctx =
    canvas.getContext('2d');


  if (!ctx) {
    return;
  }


  const dpr =
    window.devicePixelRatio || 1;

  const width =
    canvas.clientWidth || 700;

  const height =
    280;


  canvas.width =
    width * dpr;

  canvas.height =
    height * dpr;


  ctx.setTransform(
    dpr,
    0,
    0,
    dpr,
    0,
    0
  );


  ctx.clearRect(
    0,
    0,
    width,
    height
  );


  const values =
    state.history.slice(-60);


  const min =
    Math.min(...values);

  const max =
    Math.max(...values);

  const range =
    max - min || 1;


  ctx.beginPath();


  values.forEach(
    (value, index) => {

      const x =
        12 +
        index *
        (width - 24) /
        Math.max(
          1,
          values.length - 1
        );


      const y =
        height -
        18 -
        (
          (value - min) /
          range
        ) *
        (height - 36);


      if (index === 0) {

        ctx.moveTo(x, y);

      } else {

        ctx.lineTo(x, y);

      }

    }
  );


  ctx.strokeStyle =
    '#1ee5a6';

  ctx.lineWidth =
    2;

  ctx.stroke();

}


// Refresh chart once per second

setInterval(() => {

  if ($('#liveMarketPanel')) {

    drawLiveChart();

  }

}, 1000);


// Start live feed

connectPriceFeed();


// ---------------------------------------------------------------------------
// AI ANALYSIS
// ---------------------------------------------------------------------------

async function runAnalysis(){

  const btn =
    $('#analyzeBtn');

  const summaryEl =
    $('#aiSummary');


  if (btn) {

    btn.disabled = true;
    btn.textContent = 'Analyzing…';

  }


  if (summaryEl) {

    summaryEl.textContent =
      'Reading live ticks and generating a readout…';

  }


  const markets = {};


  SYMBOLS.forEach(symbol => {

    markets[symbol] =
      priceState[symbol]
        .history
        .slice(-20);

  });


  try {

    const res =
      await fetch('/api/analyze', {

        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({
            markets
          })

      });


    const data =
      await res.json();


    if (!res.ok) {

      toast(
        data.error ||
        'Analysis failed.'
      );

      if (summaryEl) {

        summaryEl.textContent =
          'Analysis failed — try again in a moment.';

      }

      return;

    }


    if (data.fallback) {

      toast(
        'AI Analysis needs setup — see README (ANTHROPIC_API_KEY).'
      );

      if (summaryEl) {

        summaryEl.textContent =
          data.summary;

      }

      return;

    }


    if ($('#scanScore')) {

      $('#scanScore').innerHTML =
        `${data.score}<span>%</span>`;

    }


    if ($('#scanMeter')) {

      $('#scanMeter').style.width =
        `${data.score}%`;

    }


    if ($('#scanMomentum')) {

      $('#scanMomentum').textContent =
        data.momentum;

    }


    if ($('#scanTrend')) {

      $('#scanTrend').textContent =
        data.trend;

    }


    if ($('#scanRisk')) {

      $('#scanRisk').textContent =
        data.risk;

    }


    if ($('#scanSubtitle')) {

      $('#scanSubtitle').textContent =
        'Live AI readout across tracked markets.';

    }


    if (summaryEl) {

      summaryEl.textContent =
        data.summary;

    }


    toast(
      `AI Analysis: ${data.trend} · momentum ${data.momentum} · risk ${data.risk}`
    );


  } catch (err) {

    console.error(err);

    toast(
      'Could not reach the analysis service.'
    );


    if (summaryEl) {

      summaryEl.textContent =
        'Could not reach the analysis service.';

    }


  } finally {

    if (btn) {

      btn.disabled = false;
      btn.textContent = 'Analyze market';

    }

  }

}
// ---------------------------------------------------------------------------
// DERIV ACCOUNT CONNECTION
// ---------------------------------------------------------------------------

const derivState = {
  connected: false,
  accounts: [],
  active: null,
  isVirtual: null,
  currency: 'USD'
};


// ---------------------------------------------------------------------------
// CONNECT DERIV ACCOUNT
// ---------------------------------------------------------------------------

function connectDerivAccount(){

  window.location.href =
    '/auth/deriv/login';

}


// ---------------------------------------------------------------------------
// CHECK DERIV CONNECTION STATUS
// ---------------------------------------------------------------------------

async function checkDerivStatus(){

  try {

    const res =
      await fetch('/api/deriv/accounts');

    const data =
      await res.json();


    derivState.connected =
      data.connected;

    derivState.accounts =
      data.accounts || [];

    derivState.active =
      data.active;


    updateDerivUI();


    if (data.connected) {

      await refreshRealBalance();

    }


  } catch (e) {

    console.error(
      'Could not check Deriv status:',
      e
    );

  }

}


// ---------------------------------------------------------------------------
// UPDATE DERIV UI
// ---------------------------------------------------------------------------

function updateDerivUI(){

  const btn =
    $('#derivConnectBtn');

  const panel =
    $('#derivPanel');

  const badge =
    $('#accountBadge');

  const select =
    $('#derivAccountSelect');

  const warning =
    $('#derivRealWarning');


  if (!derivState.connected){

    if (btn){

      btn.textContent =
        'Connect Deriv Account';

      btn.classList.remove(
        'connected'
      );

    }


    if (panel){

      panel.hidden = true;

    }


    if (badge){

      badge.textContent =
        'LOCAL DEMO';

      badge.className =
        'acct-badge local';

    }


    return;

  }


  if (btn){

    btn.textContent =
      'Deriv Connected ✓';

    btn.classList.add(
      'connected'
    );

  }


  if (panel){

    panel.hidden = false;

  }


  if (select){

    select.innerHTML =
      derivState.accounts
        .map(account => `

          <option
            value="${account.loginid}"
            ${
              account.loginid ===
              derivState.active
                ? 'selected'
                : ''
            }
          >

            ${account.loginid}
            —
            ${account.currency}

            ${
              account.isVirtual
                ? '(Virtual/Demo)'
                : '(REAL MONEY)'
            }

          </option>

        `)
        .join('');

  }


  const active =
    derivState.accounts.find(
      account =>
        account.loginid ===
        derivState.active
    );


  derivState.isVirtual =
    active
      ? active.isVirtual
      : null;


  derivState.currency =
    active
      ? active.currency
      : 'USD';


  if (warning){

    warning.hidden =
      !(active && !active.isVirtual);

  }


  if (badge){

    badge.textContent =
      active && active.isVirtual
        ? 'DERIV VIRTUAL'
        : 'DERIV REAL';


    badge.className =
      'acct-badge ' +
      (
        active && active.isVirtual
          ? 'virtual'
          : 'real'
      );

  }


  const currencyEl =
    $('#balanceCurrency');


  if (currencyEl){

    currencyEl.textContent =
      derivState.currency;

  }

}


// ---------------------------------------------------------------------------
// SELECT DERIV ACCOUNT
// ---------------------------------------------------------------------------

async function selectDerivAccount(loginid){

  try {

    const res =
      await fetch(
        '/api/deriv/select',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              loginid
            })
        }
      );


    const data =
      await res.json();


    if (!res.ok){

      toast(
        data.error ||
        'Could not switch account.'
      );

      return;

    }


    derivState.active =
      data.active;


    updateDerivUI();


    await refreshRealBalance();


    toast(
      `Switched to ${data.active} (${
        data.isVirtual
          ? 'Virtual'
          : 'REAL MONEY'
      }).`
    );


  } catch (e){

    console.error(e);

    toast(
      'Could not switch account.'
    );

  }

}


// ---------------------------------------------------------------------------
// DISCONNECT DERIV
// ---------------------------------------------------------------------------

async function disconnectDeriv(){

  if (
    typeof activeBot !== 'undefined' &&
    activeBot.strategy &&
    activeBot.strategy.execution === 'deriv' &&
    typeof running !== 'undefined' &&
    running
  ){

    stopBot(
      'Bot stopped — Deriv account disconnected.'
    );

  }


  await fetch(
    '/auth/deriv/logout',
    {
      method: 'POST'
    }
  ).catch(() => {});


  derivState.connected =
    false;

  derivState.accounts =
    [];

  derivState.active =
    null;

  derivState.isVirtual =
    null;


  updateDerivUI();


  const balance =
    $('#balance');

  const currency =
    $('#balanceCurrency');


  if (balance){

    balance.textContent =
      '10,000.00';

  }


  if (currency){

    currency.textContent =
      'USD';

  }


  toast(
    'Disconnected from Deriv. Back to local demo balance.'
  );

}


// ---------------------------------------------------------------------------
// REFRESH DERIV BALANCE
// ---------------------------------------------------------------------------

async function refreshRealBalance(){

  if (!derivState.connected){

    return;

  }


  try {

    const res =
      await fetch(
        '/api/deriv/balance'
      );


    const data =
      await res.json();


    if (!res.ok){

      toast(
        data.error ||
        'Could not fetch Deriv balance.'
      );

      return;

    }


    const balance =
      $('#balance');

    const currency =
      $('#balanceCurrency');


    if (balance){

      balance.textContent =
        Number(data.balance)
          .toLocaleString(
            undefined,
            {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            }
          );

    }


    if (currency){

      currency.textContent =
        data.currency;

    }


  } catch (e){

    console.error(
      'Could not refresh balance:',
      e
    );

  }

}


// ---------------------------------------------------------------------------
// HANDLE DERIV OAUTH RESULT
// ---------------------------------------------------------------------------

(function initDerivFromUrl(){

  const params =
    new URLSearchParams(
      window.location.search
    );


  if (
    params.get(
      'derivConnected'
    )
  ){

    toast(
      'Deriv account connected.'
    );


    history.replaceState(
      {},
      '',
      '/'
    );

  }


  if (
    params.get(
      'derivError'
    )
  ){

    toast(
      params.get(
        'derivError'
      )
    );


    history.replaceState(
      {},
      '',
      '/'
    );

  }

})();


// Check account when page loads

checkDerivStatus();


// ---------------------------------------------------------------------------
// STRATEGY BUILDER
// ---------------------------------------------------------------------------

let strategies = [];


const activeBot = {

  running: false,

  strategy: null,

  startBalance: 0

};


// ---------------------------------------------------------------------------
// OPEN STRATEGY MODAL
// ---------------------------------------------------------------------------

function openStrategyModal(){

  const modal =
    $('#strategyModal');

  if (modal){

    modal.classList.add(
      'show'
    );

  }

  loadStrategies();

}


// ---------------------------------------------------------------------------
// CLOSE STRATEGY MODAL
// ---------------------------------------------------------------------------

function closeStrategyModal(){

  const modal =
    $('#strategyModal');

  if (modal){

    modal.classList.remove(
      'show'
    );

  }

}


// ---------------------------------------------------------------------------
// EXECUTION MODE CHANGE
// ---------------------------------------------------------------------------

function onExecutionChange(){

  const execution =
    $('#stExecution');

  const confirmWrap =
    $('#stConfirmRealWrap');


  if (!execution){

    return;

  }


  const isDeriv =
    execution.value ===
    'deriv';


  if (confirmWrap){

    confirmWrap.hidden =
      !isDeriv;

  }


  if (
    isDeriv &&
    !derivState.connected
  ){

    toast(
      'Connect a Deriv account to use Deriv execution.'
    );

  }

}


// ---------------------------------------------------------------------------
// LOAD SAVED STRATEGIES
// ---------------------------------------------------------------------------

async function loadStrategies(){

  try {

    const res =
      await fetch(
        '/api/strategies'
      );


    const data =
      await res.json();


    strategies =
      data.strategies || [];


    renderStrategies();


  } catch (e){

    console.error(e);

    toast(
      'Could not load saved strategies.'
    );

  }

}


// ---------------------------------------------------------------------------
// RENDER STRATEGIES
// ---------------------------------------------------------------------------

function renderStrategies(){

  const list =
    $('#strategyList');


  if (!list){

    return;

  }


  if (!strategies.length){

    list.innerHTML =
      '<span class="empty">No strategies saved yet.</span>';

    return;

  }


  list.innerHTML =
    strategies
      .map(strategy => `

        <div class="strategy-item">

          <span>

            <b>
              ${labelSymbol(
                strategy.symbol
              )}
            </b>

            ·
            ${strategy.direction}

            ·
            ${strategy.stake}
            stake

            ·

            ${
              strategy.execution ===
              'deriv'
                ? 'REAL DERIV'
                : 'SIMULATED'
            }

            ·

            TP
            ${strategy.takeProfit}%

            /

            SL
            ${strategy.stopLoss}%

          </span>


          <span
            style="
              display:flex;
              gap:6px;
            "
          >

            <button
              class="use-btn"
              onclick="setActiveStrategy('${strategy.id}')"
            >
              Use
            </button>


            <button
              class="del-btn"
              onclick="deleteStrategy('${strategy.id}')"
            >
              ✕
            </button>

          </span>

        </div>

      `)
      .join('');

}


// ---------------------------------------------------------------------------
// SAVE STRATEGY
// ---------------------------------------------------------------------------

const strategyForm =
  $('#strategyForm');


if (strategyForm){

  strategyForm.addEventListener(
    'submit',
    async (e) => {

      e.preventDefault();


      const execution =
        $('#stExecution')?.value;


      // Deriv execution requires connection

      if (
        execution === 'deriv'
      ){

        if (!derivState.connected){

          toast(
            'Connect a Deriv account first.'
          );

          return;

        }


        // Real-money account requires confirmation

        if (
          !derivState.isVirtual &&
          !$('#stConfirmReal')?.checked
        ){

          toast(
            'Please confirm you understand this uses real funds.'
          );

          return;

        }

      }


      const payload = {

        symbol:
          $('#stSymbol')?.value,

        direction:
          $('#stDirection')?.value,

        stake:
          Number(
            $('#stStake')?.value
          ),

        takeProfit:
          Number(
            $('#stTakeProfit')?.value
          ),

        stopLoss:
          Number(
            $('#stStopLoss')?.value
          ),

        execution

      };


      try {

        const res =
          await fetch(
            '/api/strategies',
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json'
              },

              body:
                JSON.stringify(
                  payload
                )

            }
          );


        const data =
          await res.json();


        if (!res.ok){

          toast(
            data.error ||
            'Could not save strategy.'
          );

          return;

        }


        strategies.push(
          data.strategy
        );


        renderStrategies();


        setActiveStrategy(
          data.strategy.id
        );


        toast(
          'Strategy saved and set active.'
        );


      } catch (err){

        console.error(err);

        toast(
          'Could not save strategy.'
        );

      }

    }
  );

}


// ---------------------------------------------------------------------------
// DELETE STRATEGY
// ---------------------------------------------------------------------------

async function deleteStrategy(id){

  try {

    const res =
      await fetch(
        '/api/strategies/' + id,
        {
          method: 'DELETE'
        }
      );


    if (!res.ok){

      const data =
        await res.json()
          .catch(() => ({}));

      toast(
        data.error ||
        'Could not delete strategy.'
      );

      return;

    }


    strategies =
      strategies.filter(
        strategy =>
          strategy.id !== id
      );


    if (
      activeBot.strategy &&
      activeBot.strategy.id === id
    ){

      activeBot.strategy =
        null;


      const label =
        $('#activeStrategyLabel');


      if (label){

        label.textContent =
          'None — build one to run the bot';

      }

    }


    renderStrategies();


  } catch (e){

    console.error(e);

    toast(
      'Could not delete strategy.'
    );

  }

}


// ---------------------------------------------------------------------------
// SET ACTIVE STRATEGY
// ---------------------------------------------------------------------------

function setActiveStrategy(id){

  const strategy =
    strategies.find(
      item =>
        item.id === id
    );


  if (!strategy){

    return;

  }


  activeBot.strategy =
    strategy;


  const mode =
    strategy.execution === 'deriv'

      ? (
          derivState.isVirtual
            ? 'REAL Deriv (virtual)'
            : 'REAL Deriv (REAL MONEY)'
        )

      : 'Simulated';


  const label =
    $('#activeStrategyLabel');


  if (label){

    label.textContent =
      `${labelSymbol(
        strategy.symbol
      )} · ${
        strategy.direction
      } · ${
        strategy.stake
      } stake · ${mode}`;

  }


  closeStrategyModal();

}


// ---------------------------------------------------------------------------
// INITIAL STRATEGY LOAD
// ---------------------------------------------------------------------------

loadStrategies();
// ---------------------------------------------------------------------------
// BOT LOOP — SIMULATED LOCALLY OR DERIV EXECUTION
// ---------------------------------------------------------------------------

let running = false;
let botTimer = null;


// ---------------------------------------------------------------------------
// TOGGLE BOT
// ---------------------------------------------------------------------------

function toggleBot(){

  if (!running){

    if (!activeBot.strategy){

      toast(
        'Build and select a strategy first.'
      );

      openStrategyModal();

      return;

    }


    if (
      activeBot.strategy.execution ===
      'deriv' &&
      !derivState.connected
    ){

      toast(
        'Deriv account disconnected. Reconnect or switch to simulated.'
      );

      return;

    }


    startBot();

  } else {

    stopBot(
      'Demo bot stopped.'
    );

  }

}


// ---------------------------------------------------------------------------
// START BOT
// ---------------------------------------------------------------------------

async function startBot(){

  if (!activeBot.strategy){

    toast(
      'Select a strategy first.'
    );

    return;

  }


  running = true;


  activeBot.running =
    true;


  activeBot.startBalance =
    getBalance();


  const runIcon =
    $('#runIcon');

  const runText =
    $('#runText');

  const status =
    $('#botStatus');


  if (runIcon){

    runIcon.textContent =
      '■';

  }


  if (runText){

    runText.textContent =
      'Stop Bot';

  }


  if (status){

    status.textContent =
      'RUNNING';

  }


  if (
    activeBot.strategy.execution ===
    'deriv'
  ){

    toast(
      'Bot started — using the selected Deriv account.'
    );

  } else {

    toast(
      'Demo bot started. No real trades are executed.'
    );

  }


  tradeCycle();

}


// ---------------------------------------------------------------------------
// STOP BOT
// ---------------------------------------------------------------------------

function stopBot(message){

  running = false;


  activeBot.running =
    false;


  if (botTimer){

    clearTimeout(
      botTimer
    );

    botTimer =
      null;

  }


  const runIcon =
    $('#runIcon');

  const runText =
    $('#runText');

  const status =
    $('#botStatus');


  if (runIcon){

    runIcon.textContent =
      '▶';

  }


  if (runText){

    runText.textContent =
      'Run Demo Bot';

  }


  if (status){

    status.textContent =
      'READY';

  }


  if (message){

    toast(message);

  }

}


// ---------------------------------------------------------------------------
// BOT SPEED
// ---------------------------------------------------------------------------

function speedIntervalMs(){

  const range =
    $('#speedRange');


  const speed =
    range
      ? Number(range.value)
      : 2;


  return {

    1: 6000,

    2: 3500,

    3: 1800

  }[speed] || 3500;

}


// ---------------------------------------------------------------------------
// TRADE CYCLE
// ---------------------------------------------------------------------------

async function tradeCycle(){

  if (
    !running ||
    !activeBot.strategy
  ){

    return;

  }


  const strategy =
    activeBot.strategy;


  try {

    let result;


    // ---------------------------------------------------------
    // DERIV EXECUTION
    // ---------------------------------------------------------

    if (
      strategy.execution ===
      'deriv'
    ){

      result =
        await executeDerivTrade(
          strategy
        );

    }

    // ---------------------------------------------------------
    // LOCAL SIMULATION
    // ---------------------------------------------------------

    else {

      result =
        executeLocalSimTrade(
          strategy
        );

    }


    // No new trade yet because there
    // is not enough market history.

    if (!result){

      if (running){

        botTimer =
          setTimeout(
            tradeCycle,
            speedIntervalMs()
          );

      }

      return;

    }


    // ---------------------------------------------------------
    // TAKE PROFIT / STOP LOSS
    // ---------------------------------------------------------

    const balance =
      getBalance();


    const startingBalance =
      activeBot.startBalance;


    let changePct = 0;


    if (startingBalance > 0){

      changePct =
        (
          (
            balance -
            startingBalance
          ) /
          startingBalance
        ) * 100;

    }


    // Take profit

    if (
      strategy.takeProfit > 0 &&
      changePct >=
      strategy.takeProfit
    ){

      stopBot(
        `Take-profit hit (+${changePct.toFixed(1)}%). Bot stopped.`
      );

      return;

    }


    // Stop loss

    if (
      strategy.stopLoss > 0 &&
      changePct <=
      -strategy.stopLoss
    ){

      stopBot(
        `Stop-loss hit (${changePct.toFixed(1)}%). Bot stopped.`
      );

      return;

    }


    // Balance depleted

    if (balance <= 0){

      stopBot(
        'Balance depleted. Bot stopped.'
      );

      return;

    }


  } catch (err){

    console.error(
      'Bot error:',
      err
    );


    stopBot(
      'Bot stopped: ' +
      (
        err.message ||
        'Unknown error.'
      )
    );


    return;

  }


  if (running){

    botTimer =
      setTimeout(
        tradeCycle,
        speedIntervalMs()
      );

  }

}


// ---------------------------------------------------------------------------
// LOCAL SIMULATED TRADE
// ---------------------------------------------------------------------------

function executeLocalSimTrade(strategy){

  const state =
    priceState[
      strategy.symbol
    ];


  if (!state){

    return null;

  }


  const history =
    state.history;


  // Need at least two prices

  if (
    !history ||
    history.length < 2
  ){

    return null;

  }


  const previous =
    history[
      history.length - 2
    ];


  const current =
    history[
      history.length - 1
    ];


  if (
    !Number.isFinite(previous) ||
    !Number.isFinite(current)
  ){

    return null;

  }


  const movedUp =
    current > previous;


  const predictedUp =
    strategy.direction ===
    'RISE';


  const win =
    movedUp ===
    predictedUp;


  // Simulated payout

  const payoutRate =
    0.85;


  const pnl =
    win

      ? +(
          strategy.stake *
          payoutRate
        ).toFixed(2)

      : -strategy.stake;


  adjustBalance(
    pnl
  );


  logTrade(
    strategy,
    win,
    pnl,
    current,
    'SIM'
  );


  return {

    win,

    pnl

  };

}


// ---------------------------------------------------------------------------
// DERIV TRADE
// ---------------------------------------------------------------------------

async function executeDerivTrade(strategy){

  const res =
    await fetch(
      '/api/deriv/trade',
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify({

            symbol:
              strategy.symbol,

            direction:
              strategy.direction,

            stake:
              strategy.stake

          })

      }
    );


  const data =
    await res.json();


  if (!res.ok){

    throw new Error(
      data.error ||
      'Deriv trade failed.'
    );

  }


  // Refresh the account balance

  await refreshRealBalance();


  const price =
    Number.isFinite(
      Number(
        data.sellPrice
      )
    )

      ? Number(
          data.sellPrice
        )

      : Number(
          data.buyPrice
        );


  logTrade(

    strategy,

    Boolean(
      data.isWin
    ),

    Number(
      data.profit
    ),

    price,

    data.isVirtual
      ? 'VIRTUAL'
      : 'REAL'

  );


  return {

    win:
      data.isWin,

    pnl:
      data.profit

  };

}


// ---------------------------------------------------------------------------
// GET CURRENT BALANCE
// ---------------------------------------------------------------------------

function getBalance(){

  const balance =
    $('#balance');


  if (!balance){

    return 0;

  }


  return (
    Number(
      balance.textContent
        .replace(
          /,/g,
          ''
        )
    ) || 0
  );

}


// ---------------------------------------------------------------------------
// ADJUST LOCAL DEMO BALANCE
// ---------------------------------------------------------------------------

function adjustBalance(delta){

  const current =
    getBalance();


  const next =
    Math.max(
      0,
      current + Number(delta || 0)
    );


  const balance =
    $('#balance');


  if (balance){

    balance.textContent =
      next.toLocaleString(
        undefined,
        {
          minimumFractionDigits: 2,

          maximumFractionDigits: 2

        }
      );

  }

}


// ---------------------------------------------------------------------------
// TRADE LOG
// ---------------------------------------------------------------------------

function logTrade(
  strategy,
  win,
  pnl,
  price,
  tag
){

  const log =
    $('#tradeLog');


  if (!log){

    return;

  }


  // Remove empty placeholder

  const empty =
    log.querySelector(
      '.empty'
    );


  if (empty){

    empty.remove();

  }


  const row =
    document.createElement(
      'div'
    );


  row.className =
    'trade-row ' +
    (
      win
        ? 'win'
        : 'loss'
    );


  const time =
    new Date()
      .toLocaleTimeString();


  const numericPrice =
    Number(price);


  const priceLabel =
    Number.isFinite(
      numericPrice
    )

      ? numericPrice.toFixed(2)

      : '—';


  const pnlNumber =
    Number(pnl) || 0;


  row.innerHTML = `

    <span>

      ${time}

      ·

      ${labelSymbol(
        strategy.symbol
      )}

      ·

      ${strategy.direction}

      @

      ${priceLabel}

      ·

      [${tag}]

    </span>


    <span>

      ${
        win
          ? 'WIN'
          : 'LOSS'
      }

      ${
        pnlNumber >= 0
          ? '+'
          : ''
      }

      ${pnlNumber.toFixed(2)}

    </span>

  `;


  log.appendChild(
    row
  );


  // Keep only the latest 25 trades

  while (
    log.children.length >
    25
  ){

    log.removeChild(
      log.firstChild
    );

  }


  log.scrollTop =
    log.scrollHeight;

}


// ---------------------------------------------------------------------------
// BOT SPEED DISPLAY
// ---------------------------------------------------------------------------

const speedRange =
  $('#speedRange');


if (speedRange){

  speedRange.addEventListener(
    'input',
    e => {

      const labels = {

        1: 'SAFE SPEED',

        2: 'NORMAL SPEED',

        3: 'FAST SPEED'

      };


      const value =
        $('#speedValue');


      if (value){

        value.textContent =
          labels[
            e.target.value
          ] ||
          'NORMAL SPEED';

      }

    }
  );

}


// ---------------------------------------------------------------------------
// CLOSE STRATEGY MODAL WHEN CLICKING BACKDROP
// ---------------------------------------------------------------------------

const strategyModal =
  $('#strategyModal');


if (strategyModal){

  strategyModal.addEventListener(
    'click',
    e => {

      if (
        e.target.id ===
        'strategyModal'
      ){

        closeStrategyModal();

      }

    }
  );

}


// ---------------------------------------------------------------------------
// FINAL HEALTH CHECK
// ---------------------------------------------------------------------------

fetch(
  '/api/health'
).catch(
  () => {}
);


// ---------------------------------------------------------------------------
// WINDOW RESIZE — REDRAW LIVE CHART
// ---------------------------------------------------------------------------

window.addEventListener(
  'resize',
  () => {

    if (
      $('#liveMarketPanel')
    ){

      drawLiveChart();

    }

  }
);


// ---------------------------------------------------------------------------
// INITIAL UI STATE
// ---------------------------------------------------------------------------

if (
  typeof setFeedStatus ===
  'function'
){

  setFeedStatus(
    false
  );

}


// ---------------------------------------------------------------------------
// SAFETY: STOP BOT BEFORE LEAVING PAGE
// ---------------------------------------------------------------------------

window.addEventListener(
  'beforeunload',
  () => {

    if (
      running
    ){

      running =
        false;

    }


    if (
      botTimer
    ){

      clearTimeout(
        botTimer
      );

    }

  }
);
