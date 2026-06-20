// api/auth.js — proxies DIGIT login

const BASE_URL  = 'https://bauchi-hcm.digit.org';
const TENANT_ID = 'ba';

// Known DIGIT OAuth client credentials (try in order until one works)
const CLIENTS = [
  'ZWdvdi11c2VyLWNsaWVudDo=',           // egov-user-client:  (most common)
  'ZWdvdi11c2VyLWNsaWVudDplZ292LXVzZXItc2VjcmV0', // egov-user-client:egov-user-secret
  'Y2l0aXplbi1wb3J0YWw6',               // citizen-portal:
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' }); return;
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Username and password required' }); return;
  }

  const params = new URLSearchParams({
    username,
    password,
    grant_type: 'password',
    scope: 'read',
    tenantId: TENANT_ID,
    userType: 'EMPLOYEE',
  });

  // Try each client credential until one works
  let tokenData = null;
  let lastError = '';
  let lastStatus = 0;

  for (const clientB64 of CLIENTS) {
    try {
      const tokenRes = await fetch(`${BASE_URL}/user/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${clientB64}`,
        },
        body: params.toString(),
      });

      lastStatus = tokenRes.status;
      const text = await tokenRes.text();

      if (tokenRes.ok) {
        try { tokenData = JSON.parse(text); } catch {}
        if (tokenData?.access_token) break; // success
      } else {
        lastError = `${tokenRes.status}: ${text.slice(0, 150)}`;
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  if (!tokenData?.access_token) {
    // Return detailed error for debugging
    res.status(401).json({
      success: false,
      error: lastStatus === 400 || lastStatus === 401
        ? 'Invalid username or password'
        : `Auth failed (${lastStatus}): ${lastError}`,
      debug: { lastStatus, lastError }
    });
    return;
  }

  const authToken = tokenData.access_token;

  // Get user info
  let userInfo = null;
  try {
    const userRes = await fetch(`${BASE_URL}/user/v1/_search?tenantId=${TENANT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: {
          apiId: 'hcm', ver: '.01', ts: Date.now(),
          authToken,
          userInfo: { id: 0, uuid: '', userName: username, tenantId: TENANT_ID, roles: [] },
          tenantId: TENANT_ID,
        },
        userName: [username],
        tenantId: TENANT_ID,
        active: true,
        type: 'EMPLOYEE',
      }),
    });
    if (userRes.ok) {
      const ud = await userRes.json();
      userInfo = ud?.user?.[0] || ud?.User?.[0] || null;
    }
  } catch {}

  res.status(200).json({
    success: true,
    authToken,
    tokenType: tokenData.token_type || 'bearer',
    expiresIn: tokenData.expires_in,
    userInfo: userInfo ? {
      id:            userInfo.id,
      uuid:          userInfo.uuid,
      userName:      userInfo.userName || username,
      name:          userInfo.name || username,
      mobileNumber:  userInfo.mobileNumber || '',
      emailId:       userInfo.emailId || null,
      locale:        userInfo.locale  || null,
      active:        userInfo.active !== false,
      tenantId:      TENANT_ID,
      permanentCity: userInfo.permanentCity || null,
      gender:        userInfo.gender  || null,
      roles:         userInfo.roles   || [],
    } : {
      id: 0, uuid: '', userName: username, name: username,
      mobileNumber: '', emailId: null, locale: null,
      active: true, tenantId: TENANT_ID,
      permanentCity: null, gender: null, roles: [],
    },
  });
};
