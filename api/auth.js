// api/auth.js
// Matches exactly how DIGIT workbench authenticates:
// POST /user/oauth/token with form body + Basic auth header

const BASE_URL  = 'https://bauchi-hcm.digit.org';
const TENANT_ID = 'ba';

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

  try {
    // Exact same format as the working curl from the DIGIT workbench
    const params = new URLSearchParams();
    params.append('username',   username);
    params.append('password',   password);
    params.append('grant_type', 'password');
    params.append('scope',      'read');
    params.append('tenantId',   TENANT_ID);
    params.append('userType',   'EMPLOYEE');

    const oauthRes = await fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: {
        'accept':        'application/json, text/plain, */*',
        'content-type':  'application/x-www-form-urlencoded',
        'authorization': 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      body: params.toString(),
    });

    const responseText = await oauthRes.text();
    let data = null;
    try { data = JSON.parse(responseText); } catch {}

    // Not authenticated
    if (!oauthRes.ok || !data?.access_token) {
      return res.status(401).json({
        success: false,
        error:   'Invalid username or password',
        debug:   { status: oauthRes.status, body: responseText.slice(0, 400) }
      });
    }

    const authToken = data.access_token;

    // Fetch full user profile using the token — same RequestInfo pattern as events API
    let userInfo = null;
    try {
      const userRes = await fetch(`${BASE_URL}/user/v1/_search?tenantId=${TENANT_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: {
            apiId:     'hcm',
            ver:       '.01',
            ts:        Date.now(),
            action:    '_search',
            did:       '1',
            key:       '1',
            authToken,
            userInfo: {
              id: 0, uuid: '', userName: username,
              tenantId: TENANT_ID, roles: []
            },
            tenantId: TENANT_ID,
          },
          userName: [username],
          tenantId: TENANT_ID,
          active:   true,
          type:     'EMPLOYEE',
        }),
      });
      if (userRes.ok) {
        const ud = await userRes.json();
        userInfo = ud?.user?.[0] || ud?.User?.[0] || null;
      }
    } catch {}

    res.status(200).json({
      success:   true,
      authToken,
      tokenType: data.token_type || 'bearer',
      expiresIn: data.expires_in || 3600,
      userInfo:  userInfo ? {
        id:            userInfo.id            || 0,
        uuid:          userInfo.uuid          || '',
        userName:      userInfo.userName      || username,
        name:          userInfo.name          || username,
        mobileNumber:  userInfo.mobileNumber  || '',
        emailId:       userInfo.emailId       || null,
        locale:        userInfo.locale        || null,
        active:        userInfo.active        !== false,
        tenantId:      TENANT_ID,
        permanentCity: userInfo.permanentCity || null,
        gender:        userInfo.gender        || null,
        roles:         userInfo.roles         || [],
      } : {
        id: 0, uuid: '', userName: username, name: username,
        mobileNumber: '', emailId: null, locale: null,
        active: true, tenantId: TENANT_ID,
        permanentCity: null, gender: null, roles: [],
      },
    });

  } catch (err) {
    console.error('[api/auth]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
