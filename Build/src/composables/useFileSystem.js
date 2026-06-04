import { ref } from 'vue'

const selectedRoot = ref(null)
const SELECTED_ROOT_KEY = 'lrcget-selected-root-handle'

// Store handle in IndexedDB for persistence across sessions
const saveHandleToIDB = async (handle) => {
  if (!handle) return
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('lrcget-fs')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    const tx = db.transaction('handles', 'readwrite')
    const store = tx.objectStore('handles')
    await new Promise((resolve, reject) => {
      const req = store.put(handle, 'root')
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch (error) {
    console.warn('Could not persist directory handle:', error)
  }
}

const loadHandleFromIDB = async () => {
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

    return new Promise((resolve) => {
      const tx = db.transaction('handles', 'readonly')
      const store = tx.objectStore('handles')
      const req = store.get('root')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    })
  } catch (error) {
    console.warn('Could not load directory handle:', error)
    return null
  }
}

// Stream file content as ReadableStream for memory efficiency
const readFileAsStream = async (fileHandle) => {
  const file = await fileHandle.getFile()
  return file.stream()
}

// Stream file content as text
const readFileAsText = async (fileHandle) => {
  const file = await fileHandle.getFile()
  return file.text()
}

// Stream file content with chunks (for large files)
const readFileInChunks = async (fileHandle, onChunk, chunkSize = 65536) => {
  const file = await fileHandle.getFile()
  const stream = file.stream()
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk(value)
    }
  } finally {
    reader.releaseLock()
  }
}

// Write file with streaming support
const writeFile = async (fileHandle, content) => {
  const writable = await fileHandle.createWritable()
  try {
    if (typeof content === 'string') {
      await writable.write(content)
    } else if (content instanceof Blob) {
      await writable.write(content)
    } else {
      await writable.write(new Blob([content]))
    }
  } finally {
    await writable.close()
  }
}

// Find files by pattern recursively
const findFilesRecursive = async (dirHandle, pattern, maxResults = Infinity) => {
  const results = []
  const regex = new RegExp(pattern)

  const search = async (dir) => {
    if (results.length >= maxResults) return

    try {
      for await (const entry of dir.values()) {
        if (results.length >= maxResults) return

        if (entry.kind === 'file' && regex.test(entry.name)) {
          results.push({ name: entry.name, handle: entry })
        } else if (entry.kind === 'directory') {
          try {
            await search(entry)
          } catch (e) {
            console.warn(`Could not search directory ${entry.name}:`, e)
          }
        }
      }
    } catch (error) {
      console.warn('Error during recursive search:', error)
    }
  }

  await search(dirHandle)
  return results
}

// List all files in directory (single level)
const listFiles = async (dirHandle) => {
  const files = []
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        files.push(entry)
      }
    }
  } catch (error) {
    console.warn('Error listing files:', error)
  }
  return files
}

// List all directories (single level)
const listDirs = async (dirHandle) => {
  const dirs = []
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'directory') {
        dirs.push(entry)
      }
    }
  } catch (error) {
    console.warn('Error listing directories:', error)
  }
  return dirs
}

// Get file size
const getFileSize = async (fileHandle) => {
  const file = await fileHandle.getFile()
  return file.size
}

// Get OPFS root (persistent access)
const getOPFSRoot = async () => {
  try {
    return await navigator.storage.getDirectory()
  } catch (error) {
    console.warn('OPFS not available:', error)
    return null
  }
}

// Create or get subdirectory in OPFS
const getOrCreateOPFSDir = async (dirName) => {
  const root = await getOPFSRoot()
  if (!root) return null
  return root.getDirectoryHandle(dirName, { create: true })
}

export function useFileSystem() {
  const selectDirectory = async () => {
    if (!window.showDirectoryPicker) {
      throw new Error('showDirectoryPicker is not available in this browser')
    }

    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      selectedRoot.value = handle
      await saveHandleToIDB(handle)
      return handle
    } catch (error) {
      if (error.name === 'AbortError') {
        return null
      }
      throw error
    }
  }

  const getSelectedDirectory = async () => {
    if (selectedRoot.value) {
      return selectedRoot.value
    }

    // Try to load from IDB
    const handle = await loadHandleFromIDB()
    if (handle) {
      try {
        // Verify handle is still valid
        await handle.queryPermission({ mode: 'readwrite' })
        selectedRoot.value = handle
        return handle
      } catch (error) {
        console.warn('Stored directory handle is no longer valid:', error)
      }
    }

    return null
  }

  const readLyricsFiles = async (dirHandle, onProgress) => {
    const lyrics = []
    const patterns = [/\.lrc$/i, /\.txt$/i]

    for (const pattern of patterns) {
      const files = await findFilesRecursive(dirHandle, pattern, 1000)
      for (const file of files) {
        try {
          const content = await readFileAsText(file.handle)
          lyrics.push({
            name: file.name,
            path: file.name,
            content,
          })
          onProgress?.({ current: lyrics.length, type: 'lyrics' })
        } catch (error) {
          console.warn(`Could not read lyrics file ${file.name}:`, error)
        }
      }
    }

    return lyrics
  }

  const readAudioMetadata = async (fileHandle) => {
    const file = await fileHandle.getFile()
    return {
      name: fileHandle.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    }
  }

  return {
    selectedRoot,
    selectDirectory,
    getSelectedDirectory,
    readFileAsStream,
    readFileAsText,
    readFileInChunks,
    writeFile,
    findFilesRecursive,
    listFiles,
    listDirs,
    getFileSize,
    readLyricsFiles,
    readAudioMetadata,
    getOPFSRoot,
    getOrCreateOPFSDir,
  }
}
