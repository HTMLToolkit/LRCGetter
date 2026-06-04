import { ref } from 'vue'
import PowWorker from '../workers/pow-worker.js?worker&inline'
import { requestChallenge, publishLyrics } from '@/api/proxy'

export function useLRCLibPublish() {
  const isPublishing = ref(false)
  const progress = ref({
    requestChallenge: 'Pending',
    solveChallenge: 'Pending',
    publishLyrics: 'Pending',
  })

  async function solvePow(prefix, target, onProgress) {
    const numWorkers = navigator.hardwareConcurrency || 4
    const batchSize = 2048
    let solved = false
    let result = null
    let cancelled = false
    const startTime = Date.now()
    const workers = []
    let lastAttempts = 0

    function terminateAll() {
      workers.forEach((w) => w.terminate())
    }

    function handleWorkerMessage(e) {
      if (cancelled) return
      if (e.data.found) {
        solved = true
        result = {
          nonce: String(e.data.nonce),
          hash: e.data.hash,
          attempts: e.data.attempts,
          time: Date.now() - startTime,
        }
        terminateAll()
      } else if (e.data.progress && onProgress) {
        lastAttempts += batchSize
        onProgress(lastAttempts, Date.now() - startTime)
      } else if (e.data.cancelled) {
        terminateAll()
      }
    }

    for (let i = 0; i < numWorkers; i++) {
      const worker = new PowWorker()
      workers.push(worker)
      worker.onmessage = handleWorkerMessage
      worker.postMessage({
        prefix,
        target,
        start: i,
        stride: numWorkers,
        batchSize,
      })
    }

    let solverCancelled = false
    const cancelInterval = setInterval(() => {
      if (solverCancelled && !cancelled) {
        cancelled = true
        workers.forEach((w) => w.postMessage({ cancel: true }))
        terminateAll()
      }
    }, 50)

    while (!solved && !cancelled) {
      await new Promise((r) => setTimeout(r, 50))
    }
    clearInterval(cancelInterval)

    if (result) return result
    throw new Error(solverCancelled ? 'Cancelled' : 'Not found')
  }

  async function doPublish(payload) {
    isPublishing.value = true
    progress.value = {
      requestChallenge: 'Loading...',
      solveChallenge: 'Pending',
      publishLyrics: 'Pending',
    }

    try {
      const challenge = await requestChallenge()
      progress.value.requestChallenge = `Received: ${challenge.prefix.substring(0, 8)}...`

      progress.value.solveChallenge = 'Solving...'
      const result = await solvePow(
        challenge.prefix,
        challenge.target,
        (attempts, time) => {
          const rate = Math.round(attempts / (time / 1000))
          progress.value.solveChallenge = `Solving... ${attempts.toLocaleString()} attempts (${rate.toLocaleString()} H/s)`
        }
      )
      progress.value.solveChallenge = `Solved: nonce ${result.nonce.substring(0, 8)}...`

      progress.value.publishLyrics = 'Publishing...'
      const token = `${challenge.prefix}:${result.nonce}`
      await publishLyrics(payload, token)
      progress.value.publishLyrics = 'Success!'

      return { success: true }
    } catch (err) {
      console.error('Publish error:', err)
      if (err.status === 0) {
        throw new Error(err.data?.message || 'Network error')
      } else if (err.status) {
        throw new Error(err.data?.message || `Server error (${err.status})`)
      }
      throw err
    } finally {
      isPublishing.value = false
    }
  }

  return {
    isPublishing,
    progress,
    doPublish,
  }
}
