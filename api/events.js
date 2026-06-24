// api/events.js — Vercel serverless proxy for DIGIT face auth API
const API_BASE  = 'https://bauchi-hcm.digit.org/attendance/face-auth/v1/_search?tenantId=ba';
const TENANT_ID = 'ba';
const PAGE_SIZE = 100;
const FALLBACK_TOKEN = '1cf6a3e1-1c7e-4520-8951-85bd220237fe';

function getRequestInfo(authToken, userInfo) {
  return {
    apiId: 'hcm', ver: '.01', action: '_search', did: '1', key: '1',
    authToken,
    userInfo: userInfo || {
      id: 8864, uuid: 'd8ea8b4a-8e0b-44ee-afe8-6cff4a6460e8',
      userName: 'USR-011471', name: 'A4', mobileNumber: '9423213459',
      emailId: null, locale: null, active: true, tenantId: TENANT_ID,
      permanentCity: null, gender: null,
      roles: [{ name: 'Distributor', code: 'DISTRIBUTOR', tenantId: TENANT_ID }]
    },
    tenantId: TENANT_ID
  };
}

async function fetchPage(offset, limit, authToken, userInfo) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      faceAuthEventSearchCriteria: {
        tenantId: TENANT_ID,
        limit: limit,
        offset: offset
      },
      RequestInfo: { ...getRequestInfo(authToken, userInfo), ts: Date.now() }
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('DIGIT API ' + res.status + ': ' + text.slice(0, 200));
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

  const authHeader = req.headers['authorization'] || '';
  const authToken = authHeader.replace('Bearer ', '') || FALLBACK_TOKEN;

  let userInfo = null;
  try {
    const uiHeader = req.headers['x-user-info'];
    if (uiHeader) userInfo = JSON.parse(decodeURIComponent(uiHeader));
  } catch {}

  const reqLimit  = parseInt(req.query?.limit  || '100');
  const startOffset = parseInt(req.query?.offset || '0');
  const FETCH_ALL = reqLimit === 0;
  const MAX_EVENTS = FETCH_ALL ? 10000 : reqLimit;

  try {
    const allEvents = [];
    let offset = startOffset;

    while (allEvents.length < MAX_EVENTS) {
      const fetchSize = Math.min(PAGE_SIZE, MAX_EVENTS - allEvents.length);
      const page = await fetchPage(offset, fetchSize, authToken, userInfo);
      const pageEvents = extractEvents(page);

      if (pageEvents.length === 0) break;
      allEvents.push(...pageEvents);
      if (pageEvents.length < fetchSize) break;
      offset += pageEvents.length;
      if (offset > startOffset + 9000) break;
    }

    const normalised = allEvents.map(normalise);

    const seen = new Set();
    const unique = normalised.filter(e => {
      if (!e.id) return true;
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    res.status(200).json({
      success: true,
      count: unique.length,
      totalCount: unique.length,
      startOffset: startOffset,
      fetchedAt: new Date().toISOString(),
      events: unique
    });

  } catch (err) {
    console.error('[api/events] error:', err.message);
    const is401 = err.message.includes('401') || err.message.includes('403');
    res.status(is401 ? 401 : 500).json({
      success: false,
      error: err.message,
      events: []
    });
  }
};
