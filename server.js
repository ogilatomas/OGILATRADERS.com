const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');

const app = express();

// ============================================================
// RENDER CONFIGURATION
// ============================================================

// Render runs Node.js behind a reverse proxy.
// This is required for secure session cookies to work correctly
// during the Deriv OAuth redirect.
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// ============================================================
// DERIV CONFIGURATION
// ============================================================

const DERIV_API_BASE = 'https://api.derivws.com';
const DERIV_AUTH_BASE = 'https://auth.deriv.com';
const DERIV_PUBLIC_WS =
  'wss://api.derivws.com/trading/v1/options/ws/public';

// ============================================================
// EXPRESS
// ============================================================

app.use(express.json());

// ============================================================
// SESSION
// ============================================================

app.use(session({
  secret:
    process.env.SESSION_SECRET ||
    'ogila-demo-session-change-me',

  resave: false,

  saveUninitialized: false,

  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ============================================================
// STATIC WEBSITE
// ============================================================

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'OGILA TRADERS',
    mode: 'demo',
    api: 'deriv-new'
  });
});

// ============================================================
// CONFIGURATION
// ============================================================

app.get('/api/config', (req, res) => {
  res.json({
    derivConfigured: Boolean(
      process.env.DERIV_CLIENT_ID &&
      process.env.DERIV_REDIRECT_URI
    ),

    aiConfigured: Boolean(
      process.env.ANTHROPIC_API_KEY
    ),

    priceAppId: null,

    mode: 'demo',

    derivApi: 'new'
  });
});

// ============================================================
// DERIV OAUTH 2.0 + PKCE
// ============================================================

function derivConfigured() {
  return Boolean(
    process.env.DERIV_CLIENT_ID &&
    process.env.DERIV_REDIRECT_URI
  );
}

// ============================================================
// BASE64 URL
// ============================================================

function base64Url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// ============================================================
// PKCE
// ============================================================

function makePkce() {

  const verifier = base64Url(
    crypto.randomBytes(32)
  );

  const challenge = base64Url(
    crypto
      .createHash('sha256')
      .update(verifier)
      .digest()
  );

  return {
    verifier,
    challenge
  };
}

// ============================================================
// STATE
// ============================================================

function makeState() {

  return base64Url(
    crypto.randomBytes(24)
  );
}

// ============================================================
// DERIV LOGIN
// ============================================================

app.get('/auth/deriv/login', (req, res) => {

  if (!derivConfigured()) {

    return res.redirect(
      '/?derivError=' +
      encodeURIComponent(
        'Deriv OAuth is not configured. Set DERIV_CLIENT_ID and DERIV_REDIRECT_URI.'
      )
    );
  }

  // Create a new PKCE pair
  const {
    verifier,
    challenge
  } = makePkce();

  // Create OAuth state
  const state = makeState();

  // Store OAuth information in the user's session
  req.session.derivOAuth = {
    state,
    verifier
  };

  // IMPORTANT:
  // Save the session before redirecting away from Render.
  req.session.save((saveErr) => {

    if (saveErr) {

      console.error(
        'Could not save Deriv OAuth session:',
        saveErr
      );

      return res.redirect(
        '/?derivError=' +
        encodeURIComponent(
          'Could not start Deriv OAuth session.'
        )
      );
    }

    // ========================================================
    // DERIV AUTHORIZATION PARAMETERS
    // ========================================================

    const params = new URLSearchParams({

      response_type: 'code',

      client_id:
        process.env.DERIV_CLIENT_ID,

      redirect_uri:
        process.env.DERIV_REDIRECT_URI,

      scope:
        'trade',

      state,

      code_challenge:
        challenge,

      code_challenge_method:
        'S256'
    });

    const authorizationUrl =
      `${DERIV_AUTH_BASE}/oauth2/auth?${params.toString()}`;

    console.log(
      'Redirecting to Deriv OAuth'
    );

    res.redirect(
      authorizationUrl
    );
  });
});

// ============================================================
// OAUTH TOKEN EXCHANGE
// ============================================================

async function exchangeOAuthCode(
  code,
  verifier
) {

  const body =
    new URLSearchParams({

      grant_type:
        'authorization_code',

      client_id:
        process.env.DERIV_CLIENT_ID,

      code,

      code_verifier:
        verifier,

      redirect_uri:
        process.env.DERIV_REDIRECT_URI
    });

  const response =
    await fetch(
      `${DERIV_AUTH_BASE}/oauth2/token`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },

        body
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (
    !response.ok ||
    !data.access_token
  ) {

    const message =
      data.error_description ||
      data.error ||
      data.message ||
      'Deriv OAuth token exchange failed.';

    throw new Error(message);
  }

  return data;
}

// ============================================================
// DERIV REST HELPER
// ============================================================

async function derivRest(
  pathname,
  accessToken,
  options = {}
) {

  const headers = {

    Authorization:
      `Bearer ${accessToken}`,

    ...(options.headers || {})
  };

  const response =
    await fetch(
      `${DERIV_API_BASE}${pathname}`,
      {
        ...options,
        headers
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {

    const apiMessage =
      data?.errors?.[0]?.message ||
      data?.error?.message ||
      data?.message ||
      `Deriv API request failed (${response.status}).`;

    const err =
      new Error(apiMessage);

    err.status =
      response.status;

    err.deriv =
      data;

    throw err;
  }

  return data;
}

// ============================================================
// EXTRACT DERIV ACCOUNTS
// ============================================================

function extractAccounts(payload) {

  const raw =
    payload?.data?.accounts ||
    payload?.data ||
    payload?.accounts ||
    [];

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((a) => {

      const accountId =
        String(
          a.account_id ??
          a.accountId ??
          a.loginid ??
          a.login_id ??
          a.id ??
          ''
        );

      const accountType =
        String(
          a.account_type ??
          a.accountType ??
          (a.is_virtual
            ? 'demo'
            : '') ??
          ''
        ).toLowerCase();

      const currency =
        String(
          a.currency ||
          'USD'
        );

      return {

        loginid:
          accountId,

        accountId,

        token:
          null,

        currency,

        accountType,

        isVirtual:
          accountType === 'demo' ||
          accountType === 'virtual'
      };
    })
    .filter(
      a => a.accountId
    );
}

// ============================================================
// DERIV OAUTH CALLBACK
// ============================================================

app.get(
  '/auth/deriv/callback',
  async (req, res) => {

    const {
      code,
      state,
      error,
      error_description
    } = req.query;

    // Retrieve the OAuth information
    // saved before redirecting to Deriv.
    const pending =
      req.session.derivOAuth;

    // --------------------------------------------------------
    // DERIV RETURNED AN ERROR
    // --------------------------------------------------------

    if (error) {

      delete req.session.derivOAuth;

      return res.redirect(
        '/?derivError=' +
        encodeURIComponent(
          error_description ||
          error ||
          'Deriv authorization was cancelled.'
        )
      );
    }

    // --------------------------------------------------------
    // VALIDATE CALLBACK
    // --------------------------------------------------------

    if (
      !code ||
      !state ||
      !pending ||
      state !== pending.state
    ) {

      console.error(
        'Invalid Deriv OAuth callback',
        {
          hasCode: Boolean(code),
          hasState: Boolean(state),
          hasSession: Boolean(pending)
        }
      );

      delete req.session.derivOAuth;

      return res.redirect(
        '/?derivError=' +
        encodeURIComponent(
          'Invalid or expired Deriv OAuth callback.'
        )
      );
    }

    // --------------------------------------------------------
    // EXCHANGE AUTHORIZATION CODE
    // --------------------------------------------------------

    try {

      const tokenData =
        await exchangeOAuthCode(
          code,
          pending.verifier
        );

      // ------------------------------------------------------
      // GET DERIV ACCOUNTS
      // ------------------------------------------------------

      const accountsPayload =
        await derivRest(
          '/trading/v1/options/accounts',
          tokenData.access_token
        );

      const accounts =
        extractAccounts(
          accountsPayload
        );

      if (!accounts.length) {

        throw new Error(
          'Deriv login succeeded, but no Options trading accounts were returned.'
        );
      }

      // Prefer virtual/demo account
      const preferred =
        accounts.find(
          a => a.isVirtual
        ) ||
        accounts[0];

      // ------------------------------------------------------
      // STORE DERIV SESSION
      // ------------------------------------------------------

      req.session.deriv = {

        accessToken:
          tokenData.access_token,

        expiresAt:
          tokenData.expires_in
            ? Date.now() +
              Number(
                tokenData.expires_in
              ) * 1000
            : null,

        accounts,

        activeLoginid:
          preferred.loginid
      };

      // OAuth process finished
      delete req.session.derivOAuth;

      // Save the authenticated session
      req.session.save(
        (saveErr) => {

          if (saveErr) {

            console.error(
              'Could not save authenticated Deriv session:',
              saveErr
            );

            return res.redirect(
              '/?derivError=' +
              encodeURIComponent(
                'Deriv connected, but the session could not be saved.'
              )
            );
          }

          res.redirect(
            '/?derivConnected=1'
          );
        }
      );

    } catch (err) {

      console.error(
        'Deriv OAuth callback error:',
        err.message
      );

      delete req.session.derivOAuth;

      res.redirect(
        '/?derivError=' +
        encodeURIComponent(
          err.message ||
          'Deriv login failed.'
        )
      );
    }
  }
);

// ============================================================
// LOGOUT
// ============================================================

app.post(
  '/auth/deriv/logout',
  (req, res) => {

    delete req.session.deriv;

    delete req.session.derivOAuth;

    res.json({
      ok: true
    });
  }
);

// ============================================================
// DERIV ACCOUNTS
// ============================================================

app.get(
  '/api/deriv/accounts',
  (req, res) => {

    const d =
      req.session.deriv;

    if (!d) {

      return res.json({

        connected:
          false,

        configured:
          derivConfigured(),

        accounts:
          [],

        active:
          null
      });
    }

    res.json({

      connected:
        true,

      configured:
        true,

      accounts:
        d.accounts.map(
          a => ({

            loginid:
              a.loginid,

            currency:
              a.currency,

            isVirtual:
              a.isVirtual
          })
        ),

      active:
        d.activeLoginid
    });
  }
);

// ============================================================
// SELECT ACCOUNT
// ============================================================

app.post(
  '/api/deriv/select',
  (req, res) => {

    const d =
      req.session.deriv;

    if (!d) {

      return res.status(401)
        .json({
          error:
            'Not connected to Deriv.'
        });
    }

    const requested =
      String(
        req.body?.loginid ||
        ''
      );

    const acct =
      d.accounts.find(
        a =>
          a.loginid ===
          requested
      );

    if (!acct) {

      return res.status(400)
        .json({
          error:
            'Unknown account.'
        });
    }

    d.activeLoginid =
      acct.loginid;

    res.json({

      ok:
        true,

      active:
        acct.loginid,

      isVirtual:
        acct.isVirtual,

      currency:
        acct.currency
    });
  }
);

// ============================================================
// ACTIVE ACCOUNT
// ============================================================

function getActiveAccount(req) {

  const d =
    req.session.deriv;

  if (!d) {
    return null;
  }

  return (
    d.accounts.find(
      a =>
        a.loginid ===
        d.activeLoginid
    ) ||
    null
  );
}

// ============================================================
// ACCESS TOKEN
// ============================================================

function getAccessToken(req) {

  return (
    req.session.deriv
      ?.accessToken ||
    null
  );
}

// ============================================================
// SERVER START
// ============================================================

app.get(
  '*',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        'public',
        'index.html'
      )
    );
  }
);

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `OGILA TRADERS running on port ${PORT}`
    );
  }
); 
