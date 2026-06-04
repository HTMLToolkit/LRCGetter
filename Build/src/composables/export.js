import { computed, markRaw, ref } from 'vue'
import { useLibraryStore } from './useLibraryStore.js'
import { parseLyricsfile } from '@/utils/lyricsfile.js'

const delay = time => new Promise(resolve => setTimeout(resolve, time))

const exportQueue = ref([])
const log = ref([])
const exportedCount = ref(0)
const skippedCount = ref(0)
const errorCount = ref(0)
const isExporting = ref(false)
const totalCount = ref(0)
const exportFormats = ref({
  plainText: false,
  syncedLrc: false,
  embedIntoTrack: false,
})

let fileHandleMap = null

const setFileHandleMap = (map) => {
  fileHandleMap = map
}

const addLog = logObj => {
  log.value.unshift(markRaw(logObj))
  if (log.value.length > 100) {
    log.value.pop()
  }
}

const exportTrack = async track => {
  try {
    if (!isExporting.value) return

    const formats = []
    if (exportFormats.value.plainText) formats.push('txt')
    if (exportFormats.value.syncedLrc) formats.push('lrc')
    if (exportFormats.value.embedIntoTrack) formats.push('embedded')

    if (formats.length === 0) return

    if (!track.lyricsfile) {
      skippedCount.value++
      addLog({
        status: 'skipped',
        title: track.title,
        artistName: track.artist_name,
        message: 'No lyrics to export',
      })
      return
    }

    const parsed = parseLyricsfile(track.lyricsfile)
    if (!parsed.plainLyrics && (!parsed.syncedLines || parsed.syncedLines.length === 0)) {
      skippedCount.value++
      addLog({
        status: 'skipped',
        title: track.title,
        artistName: track.artist_name,
        message: 'No lyrics content to export',
      })
      return
    }

    // Try to get file handle for the track's directory
    const handle = fileHandleMap?.[track.id]
    if (!handle) {
      skippedCount.value++
      addLog({
        status: 'skipped',
        title: track.title,
        artistName: track.artist_name,
        message: 'No file handle available for export',
      })
      return
    }

    const parentDir = await handle.parent?.()
    if (!parentDir) {
      skippedCount.value++
      addLog({
        status: 'skipped',
        title: track.title,
        artistName: track.artist_name,
        message: 'Could not determine parent directory',
      })
      return
    }

    for (const format of formats) {
      if (format === 'embedded') continue // Skip embedding for now

      const fileName = `${track.title}.${format}`
      let content = ''

      if (format === 'txt' && parsed.plainLyrics) {
        content = parsed.plainLyrics
      } else if (format === 'lrc' && parsed.syncedLines?.length > 0) {
        content = parsed.syncedLines
          .map(line => {
            const ts = line.start_ms != null
              ? `[${String(Math.floor(line.start_ms / 60000)).padStart(2, '0')}:${String(Math.floor((line.start_ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((line.start_ms % 1000) / 10)).padStart(2, '0')}]`
              : ''
            return `${ts}${line.text}`
          })
          .join('\n')
      }

      if (!content) {
        skippedCount.value++
        continue
      }

      const fileHandle = await parentDir.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(content)
      await writable.close()

      addLog({
        status: 'success',
        title: track.title,
        artistName: track.artist_name,
        message: `Exported ${fileName}`,
      })
      exportedCount.value++
    }
  } catch (error) {
    if (!isExporting.value) return

    addLog({
      status: 'error',
      title: track.title,
      artistName: track.artist_name,
      message: error.message || 'Export failed',
    })
    errorCount.value++
  }
}

const exportNext = async () => {
  const store = useLibraryStore()
  while (true) {
    if (exportQueue.value.length === 0) {
      await delay(1000)
      continue
    }

    const trackId = exportQueue.value.shift()
    try {
      const track = await store.getTrack(trackId)
      await exportTrack(track)
    } catch (error) {
      if (!isExporting.value) continue
      console.error('Failed to get track for export:', error)
      errorCount.value++
    }

    await delay(100)
  }
}

const exportProgress = computed(() => {
  if (!isExporting.value) return 0.0
  if (totalCount.value === 0) return 0.0
  const processedCount = exportedCount.value + skippedCount.value + errorCount.value
  if (processedCount >= totalCount.value) return 1.0
  return processedCount / totalCount.value
})

const addToQueue = (trackIds, formats) => {
  isExporting.value = true
  exportFormats.value = formats

  for (let i = 0; i < trackIds.length; i++) {
    exportQueue.value.push(trackIds[i])
  }

  totalCount.value += trackIds.length
  console.log(`Added ${trackIds.length} tracks to export queue`)
}

const startOver = () => {
  exportQueue.value = []
  log.value = []
  exportedCount.value = 0
  skippedCount.value = 0
  errorCount.value = 0
  totalCount.value = 0
  isExporting.value = false
}

const stopExporting = () => {
  startOver()
}

export function useExporter() {
  return {
    isExporting,
    exportQueue,
    exportProgress,
    exportedCount,
    skippedCount,
    errorCount,
    totalCount,
    log,
    addToQueue,
    startOver,
    stopExporting,
    exportNext,
    setFileHandleMap,
  }
}
