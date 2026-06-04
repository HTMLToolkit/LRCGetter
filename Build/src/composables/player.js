import { ref } from 'vue'

const playingTrack = ref(null)
const status = ref('stopped')
const duration = ref(null)
const progress = ref(null)
const volume = ref(1.0)

let audioElement = null
let objectUrl = null
let fileHandleMap = {}

const revokeObjectUrl = () => {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}

const setupAudioEvents = () => {
  if (!audioElement) return

  audioElement.addEventListener('timeupdate', () => {
    if (audioElement.duration) {
      progress.value = audioElement.currentTime
    }
  })

  audioElement.addEventListener('loadedmetadata', () => {
    duration.value = audioElement.duration
    progress.value = 0
  })

  audioElement.addEventListener('ended', () => {
    status.value = 'stopped'
    progress.value = duration.value
  })

  audioElement.addEventListener('error', (e) => {
    console.error('Audio playback error:', e)
    status.value = 'stopped'
  })
}

const getAudioElement = () => {
  if (!audioElement) {
    audioElement = new Audio()
    audioElement.preload = 'metadata'
    setupAudioEvents()
  }
  return audioElement
}

export function usePlayer() {
  const playTrack = async track => {
    const audio = getAudioElement()
    revokeObjectUrl()

    playingTrack.value = track

    try {
      const mapEntry = fileHandleMap[track.id]
      const handle = track.file_handle || (mapEntry?.fileHandle || mapEntry)
      if (handle) {
        const file = await handle.getFile()
        objectUrl = URL.createObjectURL(file)
        audio.src = objectUrl
      } else if (track.file_path && track.file_path.startsWith('http')) {
        audio.src = track.file_path
      } else {
        console.warn('No audio source available for track:', track.title)
        status.value = 'stopped'
        return
      }

      duration.value = track.duration || null
      await audio.play()
      status.value = 'playing'
    } catch (error) {
      console.error('Failed to play track:', error)
      status.value = 'stopped'
    }
  }

  const pause = () => {
    if (!audioElement || !playingTrack.value) return

    audioElement.pause()
    status.value = 'paused'
  }

  const resume = () => {
    if (!audioElement || !playingTrack.value) return

    audioElement.play()
    status.value = 'playing'
  }

  const seek = position => {
    if (!audioElement || !playingTrack.value || position == null) return

    if (status.value === 'stopped') {
      status.value = 'playing'
    }

    audioElement.currentTime = position
    progress.value = position
  }

  const stop = () => {
    if (audioElement) {
      audioElement.pause()
      audioElement.src = ''
    }
    revokeObjectUrl()
    playingTrack.value = null
    status.value = 'stopped'
    progress.value = null
    duration.value = null
  }

  const setVolume = newVolume => {
    if (newVolume < 0 || newVolume > 1) return

    volume.value = newVolume
    if (audioElement) {
      audioElement.volume = newVolume
    }
  }

  const setFileHandleMap = (map) => {
    fileHandleMap = map || {}
  }

  return {
    playingTrack,
    status,
    duration,
    progress,
    volume,
    playTrack,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    setFileHandleMap,
  }
}
