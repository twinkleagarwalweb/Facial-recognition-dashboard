// api/events.js
// Vercel serverless function — proxies DIGIT face auth API
// Runs server-side so no CORS issue and auth token stays hidden from browser

const API_BASE = 'https://bauchi-hcm-uat.digit.org/attendance/face-auth/v1/_search';
const AUTH_TOKEN = '6edda9c7-e97c-4cb1-b73c-93d1dd56c837';
const TENANT_ID = 'ba';
const PAGE_SIZE = 100;

const REQUEST_INFO = {
  apiId: 'hcm',
  ver: '.01',
  action: '_search',
  did: '1',
  key: '1',
  authToken: AUTH_TOKEN,
  userInfo: {
    id: 8864,
    uuid: 'd8ea8b4a-8e0b-44ee-afe8-6cff4a6460e8',
    userName: 'USR-011471',
    name: 'A4',
    mobileNumber: '9423213459',
    emailId: null,
    locale: null,
    active: true,
    tenantId: TENANT_ID,
    permanentCity: null,
    gender: null,
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
  if (!res.ok) throw new Error(`DIGIT API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export default async function handler(req, res) {
  // Allow GET and POST from the dashboard
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // First page — find out total count
    const first = await fetchPage(0);

    // DIGIT APIs typically return totalCount in the response
    // Check common locations for it
    const totalCount =
      first?.totalCount ||
      first?.faceAuthEventResponse?.totalCount ||
      first?.faceAuthEvents?.totalCount ||
      (first?.faceAuthEvents?.length ?? PAGE_SIZE);

    // Collect first page events
    const events = extractEvents(first);

    // Fetch remaining pages in parallel if needed
    if (totalCount > PAGE_SIZE) {
      const offsets = [];
      for (let offset = PAGE_SIZE; offset < totalCount; offset += PAGE_SIZE) {
        offsets.push(offset);
      }
      const pages = await Promise.all(offsets.map(o => fetchPage(o)));
      pages.forEach(page => events.push(...extractEvents(page)));
    }

    // Normalise to the same structure the dashboard expects
    const normalised = events.map(normalise);

    res.status(200).json({
      success: true,
      count: normalised.length,
      totalCount,
      fetchedAt: new Date().toISOString(),
      events: normalised
    });

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      events: []
    });
  }
}

// Extract event array from wherever DIGIT puts it in the response
function extractEvents(data) {
  return (
    data?.faceAuthEvents ||
    data?.faceAuthEventResponse?.faceAuthEvents ||
    data?.FaceAuthEvents ||
    []
  );
}

// Normalise to the column structure we mapped from the Excel
function normalise(e) {
  const ts = e.timestamp ? new Date(e.timestamp) : null;
  const popup = e.popupTime ? new Date(e.popupTime) : null;
  const response = e.responseTime ? new Date(e.responseTime) : null;

  return {
    id:                  e.id || null,
    eventType:           e.eventType || null,
    responseType:        e.responseType || null,
    outcome:             e.outcome || null,
    confidence:          parseFloat(e.confidence) || 0,
    failedAttemptCount:  parseInt(e.failedAttemptCount) || 0,
    individualId:        e.individualId || null,
    tenantId:            e.tenantId || TENANT_ID,
    boundaryCode:        e.boundaryCode || null,
    lat:                 parseFloat(e.latitude) || 0,
    lng:                 parseFloat(e.longitude) || 0,
    locationAccuracy:    parseFloat(e.locationAccuracy) || 0,
    anomalyFlags:        e.anomalyFlags || null,
    faceImage:           e.faceImage && e.faceImage !== 'No Image' ? e.faceImage : null,
    deviceId:            e.deviceId || null,
    // Human-readable timestamps
    timestamp:           ts ? formatDT(ts) : null,
    popupTime:           popup ? formatDT(popup) : null,
    responseTime:        response ? formatDT(response) : null,
    // Raw epoch values kept for sorting
    timestamp_epoch:     e.timestamp || null,
    popupTime_epoch:     e.popupTime || null,
  };
}

function formatDT(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
