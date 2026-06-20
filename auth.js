// api/auth.js — proxies DIGIT login, returns authToken to dashboard
// Runs server-side so credentials are never exposed in browser

const AUTH_URL = 'https://bauchi-hcm.digit.org/user/oauth/token';
const USER_INFO_URL = 'https://bauchi-hcm.digit.org/user/v1/_search';
const TENANT_ID = 'ba';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ success: false, error: 'Method not allowed' }); return; }

  const { username, password } = req.body || {};
  if (!username || !password) {
    res.status(400).json({ success: false, error: 'Username and password required' });
    return;
  }

  try {
    // Step 1 — get OAuth token
    const params = new URLSearchParams({
      username,
      password,
      grant_type: 'password',
      scope: 'read',
      tenantId: TENANT_ID,
    });

    const tokenRes = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ZWdvdi11c2VyLWNsaWVudDo=', // base64 egov-user-client:
      },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '');
      // 400/401 = wrong credentials
      if (tokenRes.status === 400 || tokenRes.status === 401) {
        res.status(401).json({ success: false, error: 'Invalid username or password' });
      } else {
        res.status(500).json({ success: false, error: `Auth server error ${tokenRes.status}: ${errText.slice(0,100)}` });
      }
      return;
    }

    const tokenData = await tokenRes.json();
    const authToken = tokenData.access_token;
    if (!authToken) {
      res.status(500).json({ success: false, error: 'No access token in response' });
      return;
    }

    // Step 2 — get user info to build userInfo object for subsequent API calls
    const userRes = await fetch(`${USER_INFO_URL}?tenantId=${TENANT_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: {
          apiId: 'hcm', ver: '.01', ts: Date.now(),
          authToken,
          userInfo: { id: 0, uuid: '', userName: username, tenantId: TENANT_ID, roles: [] },
          tenantId: TENANT_ID,
        },
        userName: username,
        tenantId: TENANT_ID,
      }),
    });

    let userInfo = null;
    if (userRes.ok) {
      const userData = await userRes.json();
      userInfo = userData?.user?.[0] || userData?.User?.[0] || null;
    }

    res.status(200).json({
      success: true,
      authToken,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
      userInfo: userInfo ? {
        id: userInfo.id,
        uuid: userInfo.uuid,
        userName: userInfo.userName || username,
        name: userInfo.name || username,
        mobileNumber: userInfo.mobileNumber || '',
        emailId: userInfo.emailId || null,
        locale: userInfo.locale || null,
        active: userInfo.active !== false,
        tenantId: TENANT_ID,
        permanentCity: userInfo.permanentCity || null,
        gender: userInfo.gender || null,
        roles: userInfo.roles || [],
      } : {
        id: 0, uuid: '', userName: username, name: username,
        mobileNumber: '', emailId: null, locale: null,
        active: true, tenantId: TENANT_ID,
        permanentCity: null, gender: null, roles: [],
      },
    });

  } catch (err) {
    console.error('[api/auth] error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
