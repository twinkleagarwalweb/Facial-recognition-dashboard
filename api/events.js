// api/events.js — Vercel serverless proxy for DIGIT face auth API
// Uses module.exports for maximum Node.js compatibility

const API_BASE  = 'https://bauchi-hcm-uat.digit.org/attendance/face-auth/v1/_search';
const AUTH_TOKEN = '6edda9c7-e97c-4cb1-b73c-93d1dd56c837';
const TENANT_ID  = 'ba';
const PAGE_SIZE  = 15;

const REQUEST_INFO = {
  apiId: 'hcm', ver: '.01', action: '_search', did: '1', key: '1',
  authToken: AUTH_TOKEN,
  userInfo: {
    id: 8864,
    uuid: 'd8ea8b4a-8e0b-44ee-afe8-6cff4a6460e8',
    userName: 'USR-011471', name: 'A4', mobileNumber: '9423213459',
    emailId: null, locale: null, active: true, tenantId: TENANT_ID,
    permanentCity: null, gender: null,
    roles: [{ name: 'Distributor', code: 'DISTRIBUTOR', tenantId: TENANT_ID }]
  },
  tenantId: TENANT_ID
};

async function fetchPage(offset) {
  const url = `${API_BASE}?tenantId=${TENANT_ID}&limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      faceAuthEventSearchCriteria: { tenantId: TENANT_ID },
      RequestInfo: { ...REQUEST_INFO, ts: Date.now() }
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
  const ts       = e.timestamp   ? new Date(e.timestamp)   : null;
  const popup    = e.popupTime   ? new Date(e.popupTime)   : null;
  const response = e.responseTime? new Date(e.responseTime): null;
  return {
    id:                 e.id           || null,
    eventType:          e.eventType    || null,
    responseType:       e.responseType || null,
    outcome:            e.outcome      || null,
    confidence:         parseFloat(e.confidence)        || 0,
    failedAttemptCount: parseInt(e.failedAttemptCount)  || 0,
    individualId:       e.individualId || null,
    tenantId:           e.tenantId     || TENANT_ID,
    boundaryCode:       e.boundaryCode || null,
    lat:                parseFloat(e.latitude)          || 0,
    lng:                parseFloat(e.longitude)         || 0,
    locationAccuracy:   parseFloat(e.locationAccuracy)  || 0,
    anomalyFlags:       e.anomalyFlags || null,
    faceImage:          (e.faceImage && e.faceImage !== 'No Image') ? e.faceImage : null,
    deviceId:           e.deviceId     || null,
    timestamp:          ts       ? formatDT(ts)       : null,
    popupTime:          popup    ? formatDT(popup)    : null,
    responseTime:       response ? formatDT(response) : null,
    timestamp_epoch:    e.timestamp    || null,
    popupTime_epoch:    e.popupTime    || null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // First page
    const first = await fetchPage(0);
    const events = extractEvents(first);

    // Detect total count
    const totalCount =
      first?.totalCount ||
      first?.faceAuthEventResponse?.totalCount ||
      events.length;

    // Fetch remaining pages in parallel
    if (totalCount > PAGE_SIZE) {
      const offsets = [];
      for (let o = PAGE_SIZE; o < Math.min(totalCount, PAGE_SIZE * 20); o += PAGE_SIZE) {
        offsets.push(o);
      }
      const pages = await Promise.all(offsets.map(o => fetchPage(o)));
      pages.forEach(p => events.push(...extractEvents(p)));
    }

    const normalised = events.map(normalise);

    res.status(200).json({
      success:    true,
      count:      normalised.length,
      totalCount,
      fetchedAt:  new Date().toISOString(),
      events:     normalised
    });

  } catch (err) {
    console.error('[api/events] error:', err.message);
    res.status(500).json({
      success: false,
      error:   err.message,
      events:  []
    });
  }
};
