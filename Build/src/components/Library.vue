<template>
  <div v-if="!isLoading" class="flex flex-col w-full h-screen">
    <LibraryHeader
      :active-tab="activeTab"
      @change-active-tab="changeActiveTab"
      @show-config="openConfigModal"
      @show-about="openAboutModal"
      @show-download-viewer="openDownloadViewer"
      @refresh-library="refreshLibrary"
      @uninitialize-library="$emit('uninitializeLibrary')"
      @manage-directories="$emit('manageDirectories')"
      @export-all-lyrics="handleExportAllLyrics"
      @show-export-viewer="openExportViewer"
    />

    <div class="relative grow overflow-hidden">
      <TrackList :is-active="activeTab === 'tracks'" />

      <AlbumList :is-active="activeTab === 'albums'" />

      <ArtistList :is-active="activeTab === 'artists'" />

      <MyLrclib :is-active="activeTab === 'my-lrclib'" />
    </div>

    <NowPlaying class="flex-none" />
  </div>

  <div v-else class="flex flex-col justify-center items-center w-full h-full">
    <div class="animate-spin text-xl text-neutral-800">
      <Loading />
    </div>
    <div v-if="isScanning" class="flex flex-col items-center justify-center text-sm text-neutral-500">
      <div>Scanning library...</div>
      <div v-if="scanProgress" class="mt-1 font-medium">
        {{ scanProgress.message }}
      </div>
    </div>

    <div v-else class="flex flex-col items-center justify-center text-sm text-neutral-500">
      <div>Loading library...</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import Loading from '~icons/mdi/loading'
import _ from 'lodash'
import LibraryHeader from './library/LibraryHeader.vue'
import NowPlaying from './NowPlaying.vue'
import TrackList from './library/TrackList.vue'
import AlbumList from './library/AlbumList.vue'
import ArtistList from './library/ArtistList.vue'
import MyLrclib from './library/MyLrclib.vue'
import DownloadViewer from './library/DownloadViewer.vue'
import ExportViewer from './library/ExportViewer.vue'
import Config from './library/Config.vue'
import About from './About.vue'
import { useToast } from 'vue-toastification'
import { useModal } from 'vue-final-modal'
import { parseBlob } from 'music-metadata'
import { useExporter } from '@/composables/export.js'
import { usePlayer } from '@/composables/player.js'
import { useLibraryStore } from '@/composables/useLibraryStore.js'

const LIBRARY_INIT_KEY = 'lrcget-library-initialized'

const props = defineProps({
  shouldScan: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['uninitializeLibrary', 'scanComplete', 'manageDirectories'])

const toast = useToast()

const isLoading = ref(true)
const isScanning = ref(false)
const scanProgress = ref(null)
const scanResult = ref(null)
const activeTab = ref('tracks')

const { open: openAboutModal, close: closeAboutModal } = useModal({
  component: About,
  attrs: {
    onClose() {
      closeAboutModal()
    },
  },
})

const { open: openConfigModal, close: closeConfigModal } = useModal({
  component: Config,
  attrs: {
    onClose() {
      closeConfigModal()
    },
    onRefreshLibrary() {
      refreshLibrary()
    },
    onFullScanLibrary() {
      fullScanLibrary()
    },
    onManageDirectories() {
      emit('manageDirectories')
    },
  },
})

const { open: openDownloadViewer, close: closeDownloadViewer } = useModal({
  component: DownloadViewer,
  attrs: {
    onClose() {
      closeDownloadViewer()
    },
  },
})

const { open: openExportViewer, close: closeExportViewer } = useModal({
  component: ExportViewer,
  attrs: {
    onClose() {
      closeExportViewer()
    },
  },
})

const { addToQueue: addToExportQueue, setFileHandleMap, restoreFileHandleMap } = useExporter()
const { setFileHandleMap: setPlayerFileHandleMap } = usePlayer()

const changeActiveTab = tab => {
  activeTab.value = tab
}

const handleExportAllLyrics = async formats => {
  try {
    openExportViewer()
    const store = useLibraryStore()
    const trackIds = await store.getTrackIds({ with_lyrics: true })

    if (trackIds.length === 0) {
      toast.info('No tracks with lyrics found to export')
      closeExportViewer()
      return
    }

    addToExportQueue(trackIds, formats)
  } catch (error) {
    console.error(error)
    toast.error(`Failed to start export: ${error}`)
    closeExportViewer()
  }
}

const AUDIO_EXTENSIONS = /\.(mp3|flac|ogg|wav|m4a|wma|aac|opus)$/i

const scanFilesRecursive = async (dirHandle, path = '') => {
  const results = []
  for await (const entry of dirHandle.values()) {
    if (entry.name.startsWith('._')) continue
    if (entry.kind === 'file' && AUDIO_EXTENSIONS.test(entry.name)) {
      results.push({ name: entry.name, handle: entry, parentHandle: dirHandle, path: path ? `${path}/${entry.name}` : entry.name })
    } else if (entry.kind === 'directory') {
      const subResults = await scanFilesRecursive(entry, path ? `${path}/${entry.name}` : entry.name)
      results.push(...subResults)
    }
  }
  return results
}

const getAudioDuration = file => {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(audio.duration)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    audio.src = url
  })
}

const parseTrackInfoFallback = (fileName, filePath) => {
  const nameWithoutExt = fileName.replace(/\.[^.]+$/, '')
  const parts = filePath.split('/')
  const parentDir = parts.length > 1 ? parts[parts.length - 2] : null
  const grandparentDir = parts.length > 2 ? parts[parts.length - 3] : null

  let title = nameWithoutExt
  let artistName = 'Unknown Artist'
  let albumName = parentDir || 'Unknown Album'
  let trackNumber = null

  const artistTitleMatch = nameWithoutExt.match(/^(.+?)\s*[-–—]\s*(.+)$/)
  if (artistTitleMatch) {
    artistName = artistTitleMatch[1].trim()
    title = artistTitleMatch[2].trim()
  }

  const numTitleMatch = title.match(/^(\d+)[.\s)]+\s*(.+)/)
  if (numTitleMatch) {
    trackNumber = parseInt(numTitleMatch[1], 10)
    title = numTitleMatch[2].trim()
  }

  if (artistName === 'Unknown Artist' && parentDir && !parentDir.startsWith('._')) {
    artistName = parentDir
    if (grandparentDir && !grandparentDir.startsWith('._')) {
      albumName = grandparentDir
    }
  } else if (artistName !== 'Unknown Artist' && albumName === artistName && grandparentDir && !grandparentDir.startsWith('._')) {
    albumName = grandparentDir
  }

  return { title, artistName, albumName, trackNumber }
}

const getFileMetadata = async (fileEntry) => {
  try {
    const file = await fileEntry.handle.getFile()
    const metadata = await parseBlob(file, { duration: true })
    const c = metadata.common
    const f = metadata.format
    return {
      title: c.title || null,
      artistName: c.artist || null,
      albumName: c.album || null,
      trackNumber: c.track?.no || null,
      duration: f.duration || null,
    }
  } catch {
    return null
  }
}

const scanLibrary = async (isRefresh = false) => {
  isLoading.value = true
  isScanning.value = true
  scanProgress.value = null
  scanResult.value = null

  try {
    const libraryStore = useLibraryStore()
    if (isRefresh) {
      await libraryStore.clearAllData()
    }

    // Retrieve directory handles from IndexedDB
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('lrcget-fs', 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onupgradeneeded = (e) => {
        if (!e.target.result.objectStoreNames.contains('handles')) {
          e.target.result.createObjectStore('handles')
        }
      }
    })

    // Check if handles store exists
    if (!db.objectStoreNames.contains('handles')) {
      console.warn('IndexedDB lrcget-fs has no "handles" store')
      isScanning.value = false
      isLoading.value = false
      emit('scanComplete')
      return
    }

    // Use a cursor to get all handles in a single transaction
    const dirHandles = await new Promise(resolve => {
      const tx = db.transaction('handles', 'readonly')
      const store = tx.objectStore('handles')
      const results = []
      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          console.log(`IDB cursor key: ${cursor.key}, kind: ${cursor.value?.kind}`)
          if (String(cursor.key).startsWith('lrcget-dir-handle-')) {
            results.push(cursor.value)
          }
          cursor.continue()
        } else {
          console.log(`Found ${results.length} directory handles in IDB`)
          resolve(results)
        }
      }
      req.onerror = () => {
        console.error('IDB cursor error:', req.error)
        resolve([])
      }
    })

    console.log(`Total directory handles to scan: ${dirHandles.length}`)

    const fileHandleMap = {}

    // Pre-load existing tracks once to avoid repeated getAllTracks calls
    const existingTracks = await libraryStore.getAllTracks()
    restoreFileHandleMap(existingTracks)
    let nextId = Date.now()

    for (const handle of dirHandles) {
      if (!handle) {
        console.warn('Skipping null/undefined handle')
        continue
      }
      console.log(`Processing handle: ${handle.name}, kind=${handle.kind}`)

      try {
        let perm = await handle.queryPermission({ mode: 'read' })
        console.log(`queryPermission for ${handle.name}: ${perm}`)
        if (perm !== 'granted') {
          perm = await handle.requestPermission({ mode: 'read' })
          console.log(`requestPermission for ${handle.name}: ${perm}`)
        }
        if (perm !== 'granted') {
          console.warn(`Permission denied for directory: ${handle.name}`)
          continue
        }
      } catch (permError) {
        console.warn(`Could not get permission for ${handle.name}:`, permError)
        continue
      }

      scanProgress.value = { message: `Scanning ${handle.name}...` }

      const audioFiles = await scanFilesRecursive(handle)
      console.log(`Found ${audioFiles.length} audio files in ${handle.name}`)

      let scanned = 0

      for (const fileEntry of audioFiles) {
        scanProgress.value = {
          message: `Processing ${fileEntry.name} (${scanned + 1}/${audioFiles.length})`,
        }

        try {
          nextId++
          let title, artistName, albumName, duration, trackNumber
          const meta = await getFileMetadata(fileEntry)
          if (meta && meta.title) {
            title = meta.title
            artistName = meta.artistName || 'Unknown Artist'
            albumName = meta.albumName || 'Unknown Album'
            duration = meta.duration
            trackNumber = meta.trackNumber
          } else {
            const info = parseTrackInfoFallback(fileEntry.name, fileEntry.path)
            const file = await fileEntry.handle.getFile()
            duration = await getAudioDuration(file)
            title = info.title
            artistName = info.artistName
            albumName = info.albumName
            trackNumber = info.trackNumber
          }

          const existing = existingTracks.find(
            t => t.file_path === fileEntry.path && t.artist_name === artistName
          )

          const trackData = {
            id: existing?.id ?? nextId,
            title,
            artist_name: artistName,
            album_name: albumName,
            duration: duration || null,
            file_path: fileEntry.path,
            track_number: trackNumber,
            lyricsfile: existing?.lyricsfile || null,
            lyricsfile_id: existing?.lyricsfile_id || null,
            file_handle: fileEntry.handle,
            parent_handle: fileEntry.parentHandle,
          }

          if (existing) {
            await libraryStore.updateTrack(trackData)
          } else {
            await libraryStore.addTrack(trackData)
          }

          fileHandleMap[trackData.id] = { fileHandle: fileEntry.handle, parentHandle: fileEntry.parentHandle }
        } catch (error) {
          console.warn(`Failed to process ${fileEntry.name}:`, error)
        }

        scanned++
      }
    }

    console.log(`Scan complete. FileHandleMap has ${Object.keys(fileHandleMap).length} entries`)
    // Sync albums and artists from tracks
    await libraryStore.syncAlbumsAndArtists()
    setFileHandleMap(fileHandleMap)
    setPlayerFileHandleMap(fileHandleMap)
    isScanning.value = false
    isLoading.value = false
    emit('scanComplete')
  } catch (error) {
    console.error(error)
    toast.error(`Scan error: ${error.message || error}`)
    isScanning.value = false
    isLoading.value = false
    emit('scanComplete')
  }
}

const refreshLibrary = async () => {
  await scanLibrary(true)
}

const fullScanLibrary = async () => {
  await scanLibrary(true)
}

onMounted(async () => {
  const init = localStorage.getItem(LIBRARY_INIT_KEY) === 'true'
  if (init) {
    // Restore file handles from stored tracks so export/playback work immediately
    const store = useLibraryStore()
    const existing = await store.getAllTracks()
    restoreFileHandleMap(existing)
  }
  if (!init || props.shouldScan) {
    // First time initialization or directories changed - run a full scan
    await scanLibrary(false)
  } else {
    // Library already initialized
    isLoading.value = false
  }
})

onUnmounted(() => {
  // Cleanup if needed
})

watch(
  () => props.shouldScan,
  newValue => {
    if (newValue && !isScanning.value) {
      scanLibrary(false)
    }
  }
)
</script>
