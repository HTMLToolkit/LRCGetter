export const humanDuration = seconds => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return '00:00'
  }
  return new Date(seconds * 1000).toISOString().slice(14, 19)
}
