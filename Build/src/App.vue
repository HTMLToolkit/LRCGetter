<template>
  <div class="h-screen w-screen flex flex-col select-none">
    <div class="fixed top-0 left-0 flex justify-end items-start text-sm flex-none z-50">
      <div
        class="p-0.5 m-1 rounded-full text-sm text-hoa-1400 hover:bg-hoa-600 active:bg-hoa-800 transition"
        @click="openDevtools"
      >
        <Bug />
      </div>
    </div>
    <div v-if="!loading" class="grow overflow-hidden bg-white dark:bg-neutral-950">
      <ChooseDirectory
        v-if="!init"
        @progress-step="onProgressStep"
        @directories-changed="onDirectoriesChanged"
      />
      <Library
        v-else
        :should-scan="shouldScan"
        @uninitialize-library="uninitializeLibrary"
        @manage-directories="manageDirectories"
        @scan-complete="onScanComplete"
      />
    </div>
  </div>

  <ModalsContainer />
</template>

<script setup>
import Bug from '~icons/mdi/bug'
import ChooseDirectory from './components/ChooseDirectory.vue'
import Library from './components/Library.vue'
import { ref, onMounted, watch } from 'vue'
import { ModalsContainer } from 'vue-final-modal'
import { useGlobalState } from './composables/global-state'
import { useDownloader } from '@/composables/downloader.js'
import { useExporter } from '@/composables/export.js'
import { usePlayer } from '@/composables/player.js'
import { useLibraryStore } from '@/composables/useLibraryStore.js'
import { useToast } from 'vue-toastification'

const CONFIG_STORAGE_KEY = 'lrcget-config'
const LIBRARY_INIT_KEY = 'lrcget-library-initialized'

const toast = useToast()
const { themeMode, setThemeMode, setLrclibInstance } = useGlobalState()
const { downloadNext } = useDownloader()
const { exportNext } = useExporter()
const { setVolume } = usePlayer()

const loading = ref(true)
const init = ref(false)
const shouldScan = ref(false)
const isProd = ref(import.meta.env.PROD)

const getStoredConfig = () => {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (error) {
    console.warn('Unable to read stored config', error)
    return {}
  }
}

const uninitializeLibrary = () => {
  loading.value = true
  localStorage.removeItem(LIBRARY_INIT_KEY)
  init.value = false
  loading.value = false
}

const manageDirectories = () => {
  // Just show the directory chooser without clearing the database
  // The incremental scan will handle any directory changes
  init.value = false
}

const onProgressStep = () => {
  init.value = true
  localStorage.setItem(LIBRARY_INIT_KEY, 'true')
}

const onDirectoriesChanged = () => {
  // Directories were changed, trigger a scan in Library
  shouldScan.value = true
}

const onScanComplete = () => {
  // Reset the scan flag after completion
  shouldScan.value = false
}

const isLibraryInitialized = () => {
  return localStorage.getItem(LIBRARY_INIT_KEY) === 'true'
}

const darkModeHandle = (themeMode) => {
  if (themeMode === 'dark') {
    document.documentElement.classList.add('dark')
  } else if (themeMode === 'light') {
    document.documentElement.classList.remove('dark')
  } else {
    // auto: use system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (prefersDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }
}

const openDevtools = () => {
  // No-op in web version
  console.log('Devtools would open here in desktop version')
}

const loadGlobalState = () => {
  const config = getStoredConfig()
  setThemeMode(config.themeMode || 'auto')
  setLrclibInstance(config.lrclibInstance || 'https://lrclib.net')
  const volume = config.volume !== undefined ? config.volume : 1.0
  setVolume(volume)
}

onMounted(async () => {
  init.value = isLibraryInitialized()
  loading.value = false
  loadGlobalState()
  darkModeHandle(themeMode.value)
  const libraryStore = useLibraryStore()
  await libraryStore.cleanupDotUnderscoreTracks()
  downloadNext()
  exportNext()
  
  // Listen for system theme changes
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => {
      if (themeMode.value === 'auto') {
        darkModeHandle('auto')
      }
    })
})

watch(themeMode, () => {
  darkModeHandle(themeMode.value)
})
</script>

<style></style>
