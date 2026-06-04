import { ref } from 'vue'

const DB_NAME = 'lrcget-library'
const DB_VERSION = 1

const STORES = {
  TRACKS: 'tracks',
  ALBUMS: 'albums',
  ARTISTS: 'artists',
}

let db = null

const initDB = async () => {
  if (db) return db

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => {
      console.error('IndexedDB failed to open:', request.error)
      reject(request.error)
    }

    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }

    request.onupgradeneeded = event => {
      const newDB = event.target.result

      // Create object stores
      if (!newDB.objectStoreNames.contains(STORES.TRACKS)) {
        const trackStore = newDB.createObjectStore(STORES.TRACKS, { keyPath: 'id' })
        trackStore.createIndex('title', 'title', { unique: false })
        trackStore.createIndex('artist_name', 'artist_name', { unique: false })
        trackStore.createIndex('album_name', 'album_name', { unique: false })
      }

      if (!newDB.objectStoreNames.contains(STORES.ALBUMS)) {
        const albumStore = newDB.createObjectStore(STORES.ALBUMS, { keyPath: 'id' })
        albumStore.createIndex('album_name', 'album_name', { unique: false })
      }

      if (!newDB.objectStoreNames.contains(STORES.ARTISTS)) {
        const artistStore = newDB.createObjectStore(STORES.ARTISTS, { keyPath: 'id' })
        artistStore.createIndex('artist_name', 'artist_name', { unique: false })
      }
    }
  })
}

const getStore = async (storeName, mode = 'readonly') => {
  const database = await initDB()
  const transaction = database.transaction(storeName, mode)
  return transaction.objectStore(storeName)
}

const getAllTracks = async () => {
  const store = await getStore(STORES.TRACKS)
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

const getTrack = async (trackId) => {
  const store = await getStore(STORES.TRACKS)
  return new Promise((resolve, reject) => {
    const request = store.get(trackId)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const addTrack = async (track) => {
  const store = await getStore(STORES.TRACKS, 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.add(track)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const updateTrack = async (track) => {
  const store = await getStore(STORES.TRACKS, 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.put(track)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const deleteTrack = async (trackId) => {
  const store = await getStore(STORES.TRACKS, 'readwrite')
  return new Promise((resolve, reject) => {
    const request = store.delete(trackId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

const cleanupDotUnderscoreTracks = async () => {
  const tracks = await getAllTracks()
  const toDelete = tracks.filter(
    t => (t.title && t.title.startsWith('._')) || (t.artist_name && t.artist_name.startsWith('._'))
  )
  for (const track of toDelete) {
    await deleteTrack(track.id)
  }
  if (toDelete.length > 0) {
    console.log(`Cleaned up ${toDelete.length} macOS resource fork tracks`)
  }
  return toDelete.length
}

const getTrackIds = async (filters = {}) => {
  const tracks = await getAllTracks()
  let filtered = tracks

  if (filters.with_lyrics) {
    filtered = filtered.filter(t => t.lyricsfile || t.plain_lyrics)
  }

  // Category filters: each defaults to true (include), false means exclude
  const showSynced = filters.syncedLyricsTracks !== false
  const showPlain = filters.plainLyricsTracks !== false
  const showInstrumental = filters.instrumentalTracks !== false
  const showNoLyrics = filters.noLyricsTracks !== false

  filtered = filtered.filter(t => {
    const hasSynced = !!(t.lyricsfile && t.lyricsfile.includes('synced:'))
    const hasPlain = !!(t.lyricsfile && t.lyricsfile.includes('plain:'))
    const isInstrumental = !!(t.lyricsfile && t.lyricsfile.includes('instrumental:'))
    const hasNoLyrics = !(t.lyricsfile || t.plain_lyrics)

    if (hasSynced && !showSynced) return false
    if (hasPlain && !showPlain) return false
    if (isInstrumental && !showInstrumental) return false
    if (hasNoLyrics && !showNoLyrics) return false

    return true
  })

  return filtered.map(t => t.id)
}

const getTrackIdsWithLyrics = async () => {
  return getTrackIds({ with_lyrics: true })
}

// Album operations
const getAllAlbums = async () => {
  const store = await getStore(STORES.ALBUMS)
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

const getAlbum = async (albumId) => {
  const store = await getStore(STORES.ALBUMS)
  return new Promise((resolve, reject) => {
    const request = store.get(albumId)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const getAlbumIds = async () => {
  const albums = await getAllAlbums()
  return albums.map(a => a.id)
}

const getAlbumTrackIds = async (options) => {
  const albumId = typeof options === 'object' ? options.albumId : options
  const tracks = await getAllTracks()
  return tracks.filter(t => t.album_name === albumId).map(t => t.id)
}

// Artist operations
const getAllArtists = async () => {
  const store = await getStore(STORES.ARTISTS)
  return new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

const getArtist = async (artistId) => {
  const store = await getStore(STORES.ARTISTS)
  return new Promise((resolve, reject) => {
    const request = store.get(artistId)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const getArtistIds = async () => {
  const artists = await getAllArtists()
  return artists.map(a => a.id)
}

const getArtistTrackIds = async (options) => {
  const artistId = typeof options === 'object' ? options.artistId : options
  const tracks = await getAllTracks()
  return tracks.filter(t => t.artist_name === artistId).map(t => t.id)
}

const syncAlbumsAndArtists = async () => {
  const tracks = await getAllTracks()
  const albumMap = {}
  const artistMap = {}

  for (const t of tracks) {
    const albumName = t.album_name || 'Unknown Album'
    const artistName = t.artist_name || 'Unknown Artist'

    if (!albumMap[albumName]) {
      albumMap[albumName] = { id: albumName, name: albumName, artist_name: artistName, tracks_count: 0 }
    }
    albumMap[albumName].tracks_count++

    if (!artistMap[artistName]) {
      artistMap[artistName] = { id: artistName, name: artistName, tracks_count: 0 }
    }
    artistMap[artistName].tracks_count++
  }

  // Write albums
  const albumStore = await getStore(STORES.ALBUMS, 'readwrite')
  for (const album of Object.values(albumMap)) {
    await new Promise((resolve, reject) => {
      const req = albumStore.put(album)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  }

  // Write artists
  const artistStore = await getStore(STORES.ARTISTS, 'readwrite')
  for (const artist of Object.values(artistMap)) {
    await new Promise((resolve, reject) => {
      const req = artistStore.put(artist)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  }
}

// Clear all data
const clearAllData = async () => {
  const database = await initDB()
  for (const storeName of Object.values(STORES)) {
    const transaction = database.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.clear()
    await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

// Import tracks from JSON (for demo/testing)
const importTracks = async (tracksData) => {
  const store = await getStore(STORES.TRACKS, 'readwrite')
  for (const track of tracksData) {
    await new Promise((resolve, reject) => {
      const request = store.put(track)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

export function useLibraryStore() {
  const isInitialized = ref(false)

  const initialize = async () => {
    try {
      await initDB()
      isInitialized.value = true
    } catch (error) {
      console.error('Failed to initialize library store:', error)
      throw error
    }
  }

  return {
    isInitialized,
    initialize,
    getAllTracks,
    getTrack,
    addTrack,
    updateTrack,
    getTrackIds,
    getTrackIdsWithLyrics,
    getAllAlbums,
    getAlbum,
    getAlbumIds,
    getAlbumTrackIds,
    getAllArtists,
    getArtist,
    getArtistIds,
    getArtistTrackIds,
    syncAlbumsAndArtists,
    clearAllData,
    importTracks,
    deleteTrack,
    cleanupDotUnderscoreTracks,
  }
}
