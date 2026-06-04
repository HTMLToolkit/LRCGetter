const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://lrcgetter-backend.neeljaiswal23.workers.dev/api'

async function proxyFetch(endpoint, options = {}) {
  const url = BACKEND_URL + endpoint
  const headers = {
    Accept: 'application/json',
    ...options.headers,
  }

  let res
  try {
    res = await fetch(url, { ...options, headers, credentials: 'same-origin' })
  } catch (networkError) {
    console.error('Network error:', networkError)
    throw {
      status: 0,
      data: {
        message: 'Network error - check your connection or the API may be down',
      },
    }
  }

  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { message: text || 'Unknown error' }
  }

  if (!res.ok) {
    throw { status: res.status, data }
  }

  return data
}

/**
 * Build URL query string from object, filtering empty values.
 */
function buildQueryString(params) {
  return Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

/**
 * Request a proof-of-work challenge from the proxy.
 */
export async function requestChallenge() {
  return proxyFetch('/request-challenge', { method: 'POST' })
}

/**
 * Publish lyrics payload via the proxy.
 * @param {Object} payload - The publish payload (track metadata + lyricsfile)
 * @param {string} publishToken - The X-Publish-Token value (prefix:nonce)
 */
export async function publishLyrics(payload, publishToken) {
  const headers = publishToken ? { 'X-Publish-Token': publishToken } : {}
  return proxyFetch('/publish', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify(payload),
  })
}

/**
 * Search lyrics via proxy (if supported).
 * @param {Object} params - Query parameters {q, track_name, artist_name, album_name}
 */
export async function searchLyrics(params) {
  const qs = buildQueryString(params)
  return proxyFetch(`/search?${qs}`)
}

/**
 * Get lyrics by signature via proxy.
 * @param {Object} params - Query parameters {track_name, artist_name, album_name, duration}
 * @param {boolean} cached - Use /get-cached instead of /get
 */
export async function getLyricsBySignature(params, cached = false) {
  const qs = buildQueryString(params)
  const endpoint = cached ? '/get-cached' : '/get'
  return proxyFetch(`${endpoint}?${qs}`)
}

/**
 * Get lyrics by ID via proxy.
 * @param {string} id - The lyrics ID
 */
export async function getLyricsById(id) {
  return proxyFetch(`/get/${encodeURIComponent(id)}`)
}

export default {
  requestChallenge,
  publishLyrics,
  searchLyrics,
  getLyricsBySignature,
  getLyricsById,
}
