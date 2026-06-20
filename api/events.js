// api/events.js — Vercel serverless proxy for DIGIT face auth API
// Auth token comes from Authorization header (set by dashboard after login)

const API_BASE  = 'https://bauchi-hcm.digit.org/attendance/face-auth/v1/_search';
const TENANT_ID = 'ba';
const PAGE_SIZE = 100;

function getRequestInfo(authToken, userInfo) {
  return {
    apiId: 'hcm', ver: '.01', action: '_search', did: '1', key: '1',
    authToken,
    userInfo: userInfo || {
      id: 8864,
      uuid: 'd8ea8b4a-8e0b-44ee-afe8-6cff4a6460e8',
      userName: 'USR-011471', name: 'A4', mobileNumber: '9423213459',
      emailId: null, locale: null, active: true, tenantId: TENANT_ID,
      permanentCity: null, gender: null,
      roles: [{ name: 'Distributor', code: 'DISTRIBUTOR', tenantId: TENANT_ID }]
    },
    tenantId: TENANT_ID
  };
}

async function fetchPage(offset, pageSize, authToken, userInfo) {
  const url = `${API_BASE}?tenantId=${TENANT_ID}&limit=${pageSize}&offset=${offset}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      faceAuthEventSearchCriteria: { tenantId: TENANT_ID },
      RequestInfo: { ...getRequestInfo(authToken, userInfo), ts: Date.now() }
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DIGIT API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function extractEvents(data) {
  return (
    data?.faceAuthEvents ||
    data?.faceAuthEventResponse?.faceAuthEvents ||
    data?.FaceAuthEvents ||
    []
  );
}

function formatDT(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function normalise(e) {
  const ts       = e.timestamp    ? new Date(e.timestamp)    : null;
  const popup    = e.popupTime    ? new Date(e.popupTime)    : null;
  const response = e.responseTime ? new Date(e.responseTime) : null;
  return {
    id:                 e.id           || null,
    eventType:          e.eventType    || null,
    responseType:       e.responseType || null,
    outcome:            e.outcome      || null,
    confidence:         parseFloat(e.confidence)       || 0,
    failedAttemptCount: parseInt(e.failedAttemptCount) || 0,
    individualId:       e.individualId || null,
    tenantId:           e.tenantId     || TENANT_ID,
    boundaryCode:       e.boundaryCode || null,
    lat:                parseFloat(e.latitude)         || 0,
    lng:                parseFloat(e.longitude)        || 0,
    locationAccuracy:   parseFloat(e.locationAccuracy) || 0,
    anomalyFlags:       e.anomalyFlags || null,
    faceImage:          (e.faceImage && e.faceImage !== 'No Image') ? e.faceImage : null,
    deviceId:           e.deviceId     || null,
    timestamp:          ts       ? formatDT(ts)       : null,
    popupTime:          popup    ? formatDT(popup)    : null,
    responseTime:       response ? formatDT(response) : null,
    timestamp_epoch:    e.timestamp   || null,
    popupTime_epoch:    e.popupTime   || null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Info');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Get auth token from header (set by dashboard after login)
  // Fall back to hardcoded token for backward compatibility
  const authHeader = req.headers['authorization'] || '';
  const authToken = authHeader.replace('Bearer ', '') ||
    '1cf6a3e1-1c7e-4520-8951-85bd220237fe';

  // Get userInfo from header if provided
  let userInfo = null;
  try {
    const uiHeader = req.headers['x-user-info'];
    if (uiHeader) userInfo = JSON.parse(decodeURIComponent(uiHeader));
  } catch {}

  // Read requested limit from query param; 0 = fetch all
  const reqLimit = parseInt(req.query?.limit || '100');
  const FETCH_ALL = reqLimit === 0;
  const MAX_EVENTS = FETCH_ALL ? Infinity : reqLimit;

  try {
    const effectivePageSize = (!FETCH_ALL && MAX_EVENTS < PAGE_SIZE) ? MAX_EVENTS : PAGE_SIZE;
    const first = await fetchPage(0, effectivePageSize, authToken, userInfo);
    const events = extractEvents(first);

    const totalCount =
      first?.totalCount ||
      first?.faceAuthEventResponse?.totalCount ||
      events.length;

    if (totalCount > PAGE_SIZE) {
      const cap = FETCH_ALL ? totalCount : Math.min(totalCount, MAX_EVENTS);
      const offsets = [];
      for (let o = PAGE_SIZE; o < cap; o += PAGE_SIZE) offsets.push(o);
      if (offsets.length > 0) {
        const pages = await Promise.all(offsets.map(o => fetchPage(o, PAGE_SIZE, authToken, userInfo)));
        pages.forEach(p => events.push(...extractEvents(p)));
      }
    }
    if (!FETCH_ALL && events.length > MAX_EVENTS) events.splice(MAX_EVENTS);

    const normalised = events.map(normalise);

    res.status(200).json({
      success: true,
      count: normalised.length,
      totalCount,
      fetchedAt: new Date().toISOString(),
      events: normalised
    });

  } catch (err) {
    console.error('[api/events] error:', err.message);
    // If auth error, signal 401 so dashboard can redirect to login
    const is401 = err.message.includes('401') || err.message.includes('403');
    res.status(is401 ? 401 : 500).json({
      success: false,
      error: err.message,
      events: []
    });
  }
};
