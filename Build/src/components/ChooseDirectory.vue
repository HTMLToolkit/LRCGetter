<template>
  <div class="flex flex-col w-full h-full justify-center items-center">
    <div class="px-4 py-2 flex flex-col gap-4 flex-none">
      <div class="text-thin text-xl text-neutral-900 dark:text-neutral-200">Select directories</div>
    </div>

    <div class="grow flex flex-col items-center justify-center gap-8 w-full max-w-screen-sm">
      <div class="flex flex-col gap-2 w-full justify-center items-center">
        <div
          v-for="(directory, index) in directories"
          :key="directory"
          class="w-full bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-200 font-bold p-4 rounded-lg flex items-center"
        >
          <div class="grow">
            {{ directory }}
          </div>
          <button
            class="flex-none button button-normal p-2 rounded-full"
            @click.prevent="removeDirectory(index)"
          >
            <Close />
          </button>
        </div>

        <button
          class="w-full bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 hover:dark:bg-neutral-800 active:bg-neutral-200/50 transition text-neutral-900 dark:text-neutral-300 font-bold p-4 rounded-lg flex items-center border border-dashed border-neutral-400 dark:border-neutral-600"
          @click.prevent="chooseDirectory"
        >
          <Plus />
          <div>Add new directory</div>
        </button>
      </div>

      <button class="button button-primary w-full p-4 rounded-lg" @click.prevent="progressStep">
        Continue
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Close from '~icons/mdi/close'
import Plus from '~icons/mdi/plus'
import { useFileSystem } from '@/composables/useFileSystem.js'
const emit = defineEmits(['progressStep', 'directoriesChanged'])

const DIRECTORIES_STORAGE_KEY = 'lrcget-directories'
const directories = ref([])
const originalDirectories = ref([])
const directoryHandles = ref([])

const getStoredDirectories = () => {
  try {
    const raw = localStorage.getItem(DIRECTORIES_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (error) {
    console.warn('Unable to read stored directories', error)
    return []
  }
}

const setStoredDirectories = (dirs) => {
  try {
    localStorage.setItem(DIRECTORIES_STORAGE_KEY, JSON.stringify(dirs))
  } catch (error) {
    console.warn('Unable to save directories', error)
  }
}

const progressStep = () => {
  setStoredDirectories(directories.value)

  const hasChanged =
    JSON.stringify(originalDirectories.value.sort()) !== JSON.stringify(directories.value.sort())

  if (hasChanged) {
    emit('directoriesChanged')
  }

  emit('progressStep')
}

onMounted(() => {
  const directoriesFromStorage = getStoredDirectories()
  if (directoriesFromStorage && directoriesFromStorage.length > 0) {
    directories.value = [...directoriesFromStorage]
    originalDirectories.value = [...directoriesFromStorage]
  } else {
    directories.value = []
    originalDirectories.value = []
  }
})

const chooseDirectory = async () => {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Directory picking is not supported in this browser')
  }

  const selectedHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
  const selected = selectedHandle?.name || ''

  if (selected && !directories.value.includes(selected)) {
    directories.value.push(selected)
    directoryHandles.value.push(selectedHandle)
    // Persist handle to IndexedDB
    const key = `lrcget-dir-handle-${selected}`
    try {
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
      await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite')
        const store = tx.objectStore('handles')
        const req = store.put(selectedHandle, key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
    } catch (error) {
      console.warn('Could not persist directory handle:', error)
    }
  }
}

const removeDirectory = async index => {
  if (index < 0) return

  const name = directories.value[index]
  directories.value.splice(index, 1)
  directoryHandles.value.splice(index, 1)

  // Update localStorage
  setStoredDirectories(directories.value)

  // Remove handle from IndexedDB
  const key = `lrcget-dir-handle-${name}`
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('lrcget-fs', 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite')
      const store = tx.objectStore('handles')
      const req = store.delete(key)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch (error) {
    console.warn('Could not remove directory handle from IndexedDB:', error)
  }

  emit('directoriesChanged')
}
</script>
