import { computed, markRaw, ref } from 'vue'
import { useLibraryStore } from './useLibraryStore.js'
import { getLyricsBySignature, searchLyrics, getLyricsById } from '@/api/proxy.js'
import { parseLrcLines, serializeLyricsfile } from '@/utils/lyricsfile.js'

const delay = time => new Promise(resolve => setTimeout(resolve, time))

const downloadQueue = ref([])
const log = ref([])
const successCount = ref(0)
const failureCount = ref(0)
const downloadedCount = ref(0)
const isDownloading = ref(false)
const totalCount = ref(0)

const addLog = logObj => {
  log.value.unshift(markRaw(logObj))
  if (log.value.length > 100) {
    log.value.pop()
  }
}

const isDotUnderscore = s => s && s.startsWith('._')

const saveLyrics = async (track, result) => {
  const store = useLibraryStore()
  const trackData = await store.getTrack(track.id)
  if (!trackData) return false

  const syncedLines = result.syncedLyrics ? parseLrcLines(result.syncedLyrics) : []
  const plainLyrics = result.plainLyrics || ''
  const lyricsfile = serializeLyricsfile({
    track: {
      title: track.title,
      artist_name: track.artist_name,
      album_name: track.album_name,
      duration: track.duration,
    },
    plainLyrics,
    syncedLines,
    isInstrumental: !!result.instrumental,
  })
  trackData.lyricsfile = lyricsfile
  await store.updateTrack(trackData)
  return true
}

const hasGoodMetadata = track =>
  track.duration != null && track.album_name && track.album_name !== 'Unknown Album'

const fetchViaGet = async track => {
  return getLyricsBySignature({
    track_name: track.title,
    artist_name: track.artist_name,
    album_name: track.album_name || undefined,
    duration: track.duration || undefined,
  })
}

const fetchViaSearch = async track => {
  const results = await searchLyrics({
    track_name: track.title,
    artist_name: track.artist_name,
  })
  if (!Array.isArray(results) || results.length === 0) return null
  const match = results.find(
    r =>
      r.trackName?.toLowerCase() === track.title?.toLowerCase() &&
      r.artistName?.toLowerCase() === track.artist_name?.toLowerCase()
  ) || results[0]
  return getLyricsById(match.id)
}

const downloadLyrics = async track => {
  try {
    if (!isDownloading.value) return

    if (isDotUnderscore(track.title) || isDotUnderscore(track.artist_name)) {
      addLog({ status: 'skipped', title: track.title, artistName: track.artist_name, message: 'Skipped macOS resource file' })
      failureCount.value++
      downloadedCount.value++
      return
    }

    let result = null

    if (hasGoodMetadata(track)) {
      try {
        result = await fetchViaGet(track)
      } catch (getErr) {
        if (getErr?.status === 404) {
          result = null
        } else {
          throw getErr
        }
      }
    }

    if (!result || (!result.syncedLyrics && !result.plainLyrics)) {
      try {
        result = await fetchViaSearch(track)
      } catch {
        result = null
      }
    }

    if (result && (result.syncedLyrics || result.plainLyrics || result.instrumental)) {
      await saveLyrics(track, result)
      successCount.value++
      addLog({
        status: 'success',
        title: track.title,
        artistName: track.artist_name,
        message: result.syncedLyrics ? 'Downloaded synced lyrics' : result.plainLyrics ? 'Downloaded plain lyrics' : 'Instrumental',
      })
    } else {
      failureCount.value++
      addLog({
        status: 'failure',
        title: track.title,
        artistName: track.artist_name,
        message: 'No lyrics found',
      })
    }
  } catch (error) {
    if (!isDownloading.value) return
    addLog({ status: 'failure', title: track.title, artistName: track.artist_name, message: error?.data?.message || error.message || 'Download failed' })
    failureCount.value++
  }

  downloadedCount.value++
}

const downloadNext = async () => {
  while (true) {
    if (downloadQueue.value.length === 0) {
      await delay(1000)
      continue
    }

    const trackId = downloadQueue.value.shift()
    try {
      const store = useLibraryStore()
      const track = await store.getTrack(trackId)
      if (track) {
        await downloadLyrics(track)
      }
    } catch (error) {
      console.error('Failed to get track for download:', error)
      failureCount.value++
    }

    await delay(500)
  }
}

const downloadProgress = computed(() => {
  if (!isDownloading.value) return 0.0
  if (totalCount.value === 0) return 0.0
  if (downloadedCount.value >= totalCount.value) return 1.0
  return downloadedCount.value / totalCount.value
})

const addToQueue = trackIds => {
  isDownloading.value = true
  for (let i = 0; i < trackIds.length; i++) {
    downloadQueue.value.push(trackIds[i])
  }
  totalCount.value += trackIds.length
  console.log(`Added ${totalCount.value} tracks to download queue`)
}

const startOver = () => {
  downloadQueue.value = []
  log.value = []
  successCount.value = 0
  failureCount.value = 0
  downloadedCount.value = 0
  totalCount.value = 0
  isDownloading.value = false
}

const stopDownloading = () => {
  startOver()
}

export function useDownloader() {
  return {
    isDownloading,
    downloadQueue,
    downloadProgress,
    successCount,
    failureCount,
    totalCount,
    downloadedCount,
    log,
    addToQueue,
    startOver,
    stopDownloading,
    downloadNext,
  }
}
