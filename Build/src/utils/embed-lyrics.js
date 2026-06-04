const encoder = new TextEncoder()
const decoder = new TextDecoder()

// --- ID3v2 helpers ---

function encodeSyncSafe(value) {
  return new Uint8Array([
    (value >> 21) & 0x7f,
    (value >> 14) & 0x7f,
    (value >> 7) & 0x7f,
    value & 0x7f,
  ])
}

function decodeSyncSafe(data, offset) {
  return (data[offset] << 21) | (data[offset + 1] << 14) | (data[offset + 2] << 7) | data[offset + 3]
}

function buildUsltFrame(lyrics, descriptor = '') {
  const encoding = 0x03
  const lang = encoder.encode('eng')
  const desc = encoder.encode(descriptor)
  const text = encoder.encode(lyrics)

  const frameData = new Uint8Array(1 + lang.length + desc.length + 1 + text.length + 1)
  let off = 0
  frameData[off++] = encoding
  frameData.set(lang, off); off += lang.length
  frameData.set(desc, off); off += desc.length
  frameData[off++] = 0
  frameData.set(text, off); off += text.length
  frameData[off++] = 0

  return frameData
}

function toUtf16LeWithNull(str) {
  const chars = new Uint16Array(str.length + 1)
  for (let i = 0; i < str.length; i++) {
    chars[i] = str.charCodeAt(i)
  }
  chars[str.length] = 0
  return new Uint8Array(chars.buffer)
}

function buildSyltFrame(syncedLines, descriptor = '') {
  const encoding = 0x01
  const lang = encoder.encode('eng')
  const bom = new Uint8Array([0xff, 0xfe])
  const descUtf16 = toUtf16LeWithNull(descriptor)

  const entries = []
  for (const line of syncedLines) {
    const textUtf16 = toUtf16LeWithNull(line.text)
    const ts = new Uint8Array(4)
    const t = line.start_ms || 0
    ts[0] = (t >> 24) & 0xff
    ts[1] = (t >> 16) & 0xff
    ts[2] = (t >> 8) & 0xff
    ts[3] = t & 0xff
    entries.push({ text: textUtf16, ts })
  }

  const totalSize = 1 + lang.length + 1 + 1 + bom.length + descUtf16.length +
    entries.reduce((s, e) => s + bom.length + e.text.length + 4, 0)

  const frameData = new Uint8Array(totalSize)
  let off = 0
  frameData[off++] = encoding
  frameData.set(lang, off); off += lang.length
  frameData[off++] = 0x02
  frameData[off++] = 0x01
  frameData.set(bom, off); off += bom.length
  frameData.set(descUtf16, off); off += descUtf16.length

  for (const entry of entries) {
    frameData.set(bom, off); off += bom.length
    frameData.set(entry.text, off); off += entry.text.length
    frameData.set(entry.ts, off); off += 4
  }

  return frameData
}

function buildId3v2Tag(plainLyrics, syncedLines) {
  const frameList = []

  if (plainLyrics) {
    frameList.push({ id: 'USLT', data: buildUsltFrame(plainLyrics, '') })
  }
  if (syncedLines?.length > 0) {
    frameList.push({ id: 'SYLT', data: buildSyltFrame(syncedLines, '') })
  }

  const frames = new Uint8Array(frameList.reduce((sum, f) => sum + 10 + f.data.length, 0))
  let off = 0
  for (const f of frameList) {
    const id = encoder.encode(f.id)
    frames.set(id, off); off += 4
    frames[off++] = (f.data.length >> 24) & 0xff
    frames[off++] = (f.data.length >> 16) & 0xff
    frames[off++] = (f.data.length >> 8) & 0xff
    frames[off++] = f.data.length & 0xff
    frames[off++] = 0x00
    frames[off++] = 0x00
    frames.set(f.data, off); off += f.data.length
  }

  const tagSize = frames.length
  const header = new Uint8Array(10)
  header.set(encoder.encode('ID3'), 0)
  header[3] = 0x03
  header[4] = 0x00
  header[5] = 0x00
  header.set(encodeSyncSafe(tagSize), 6)

  const result = new Uint8Array(header.length + frames.length)
  result.set(header, 0)
  result.set(frames, header.length)
  return result
}

function findId3v2Tag(data) {
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
    const size = decodeSyncSafe(data, 6)
    return { offset: 0, size: 10 + size }
  }
  return null
}

function replaceOrAddLyricFrames(existingTag, plainLyrics, syncedLines) {
  const tagData = existingTag.slice(10)
  const newFrames = []
  let pos = 0
  while (pos < tagData.length) {
    if (pos + 10 > tagData.length) break
    const frameId = decoder.decode(tagData.slice(pos, pos + 4))
    const frameSize = (tagData[pos + 4] << 24) | (tagData[pos + 5] << 16) | (tagData[pos + 6] << 8) | tagData[pos + 7]
    if (pos + 10 + frameSize > tagData.length) break
    if (frameId !== 'USLT' && frameId !== 'SYLT') {
      newFrames.push(tagData.slice(pos, pos + 10 + frameSize))
    }
    pos += 10 + frameSize
  }

  if (plainLyrics) {
    newFrames.push(buildFrameBlock('USLT', buildUsltFrame(plainLyrics, '')))
  }
  if (syncedLines?.length > 0) {
    newFrames.push(buildFrameBlock('SYLT', buildSyltFrame(syncedLines, '')))
  }

  const newFramesConcat = new Uint8Array(newFrames.reduce((sum, f) => sum + f.length, 0))
  let off = 0
  for (const f of newFrames) {
    newFramesConcat.set(f, off)
    off += f.length
  }

  const header = new Uint8Array(10)
  header.set(encoder.encode('ID3'), 0)
  header[3] = 0x03
  header[4] = 0x00
  header[5] = 0x00
  header.set(encodeSyncSafe(newFramesConcat.length), 6)

  const result = new Uint8Array(header.length + newFramesConcat.length)
  result.set(header, 0)
  result.set(newFramesConcat, header.length)
  return result
}

function buildFrameBlock(id, data) {
  const block = new Uint8Array(10 + data.length)
  const idBytes = encoder.encode(id.padEnd(4, '\0').slice(0, 4))
  block.set(idBytes, 0)
  block[4] = (data.length >> 24) & 0xff
  block[5] = (data.length >> 16) & 0xff
  block[6] = (data.length >> 8) & 0xff
  block[7] = data.length & 0xff
  block[8] = 0x00
  block[9] = 0x00
  block.set(data, 10)
  return block
}

// --- FLAC helpers ---

const FLAC_SIG = encoder.encode('fLaC')

function embedInFlac(data, plainLyrics) {
  const stream = new Uint8Array(data)
  const sig = stream.slice(0, 4)
  if (decoder.decode(sig) !== 'fLaC') return null

  let pos = 4
  let lastBlock = false
  let vorbisPos = null
  let vorbisSize = 0
  let metadataEnd = 4

  while (!lastBlock && pos < stream.length) {
    const blockHeader = stream[pos]
    lastBlock = !!(blockHeader & 0x80)
    const blockType = blockHeader & 0x7f
    const blockSize = (stream[pos + 1] << 16) | (stream[pos + 2] << 8) | stream[pos + 3]

    if (blockType === 4) {
      vorbisPos = pos
      vorbisSize = 4 + blockSize
    }

    pos += 4 + blockSize
    metadataEnd = pos
  }

  const existingLyricsField = plainLyrics ? encoder.encode(`LYRICS=${plainLyrics}`) : null

  if (vorbisPos !== null) {
    const before = stream.slice(0, vorbisPos)
    const vorbisData = stream.slice(vorbisPos + 4, vorbisPos + 4 + vorbisSize)
    const after = stream.slice(metadataEnd + 4)
    const beforeMeta = stream.slice(vorbisPos, vorbisPos + 4 + vorbisSize)

    let vendorLen = new DataView(vorbisData.buffer, vorbisData.byteOffset, 4).getUint32(0, true)
    let fieldOffset = 4 + vendorLen
    let vendorStr = decoder.decode(vorbisData.slice(4, fieldOffset))
    let numFields = new DataView(vorbisData.buffer, vorbisData.byteOffset + fieldOffset, 4).getUint32(0, true)
    fieldOffset += 4

    const fields = []
    for (let i = 0; i < numFields; i++) {
      const flen = new DataView(vorbisData.buffer, vorbisData.byteOffset + fieldOffset, 4).getUint32(0, true)
      fieldOffset += 4
      const fval = decoder.decode(vorbisData.slice(fieldOffset, fieldOffset + flen))
      fieldOffset += flen
      if (!fval.startsWith('LYRICS=')) {
        fields.push(fval)
      }
    }

    if (existingLyricsField) {
      fields.push(decoder.decode(existingLyricsField))
    }

    const newVendorLen = new Uint8Array(4)
    new DataView(newVendorLen.buffer).setUint32(0, vendorStr.length, true)
    const newNumFields = new Uint8Array(4)
    new DataView(newNumFields.buffer).setUint32(0, fields.length, true)

    const fieldBytesArr = fields.map(f => {
      const fbytes = encoder.encode(f)
      const lenBytes = new Uint8Array(4)
      new DataView(lenBytes.buffer).setUint32(0, fbytes.length, true)
      const arr = new Uint8Array(4 + fbytes.length)
      arr.set(lenBytes, 0)
      arr.set(fbytes, 4)
      return arr
    })
    const fieldBytes = new Uint8Array(fieldBytesArr.reduce((s, f) => s + f.length, 0))
    let foff = 0
    for (const f of fieldBytesArr) { fieldBytes.set(f, foff); foff += f.length }

    const newVendor = encoder.encode(vendorStr)
    const newBlockData = new Uint8Array(4 + newVendor.length + 4 + fieldBytes.length)
    newBlockData.set(newVendorLen, 0)
    newBlockData.set(newVendor, 4)
    newBlockData.set(newNumFields, 4 + newVendor.length)
    newBlockData.set(fieldBytes, 4 + newVendor.length + 4)

    const newBlockSize = newBlockData.length
    const blockHeaderArr = new Uint8Array(4)
    blockHeaderArr[0] = 0x04
    blockHeaderArr[1] = (newBlockSize >> 16) & 0xff
    blockHeaderArr[2] = (newBlockSize >> 8) & 0xff
    blockHeaderArr[3] = newBlockSize & 0xff

    const result = new Uint8Array(before.length + blockHeaderArr.length + newBlockData.length + after.length)
    result.set(before, 0)
    result.set(blockHeaderArr, before.length)
    result.set(newBlockData, before.length + blockHeaderArr.length)
    result.set(after, before.length + blockHeaderArr.length + newBlockData.length)
    return result.buffer
  } else {
    if (!existingLyricsField) return data

    const vcBlock = buildFlacVorbisComment(existingLyricsField)
    const before = stream.slice(0, metadataEnd)
    const after = stream.slice(metadataEnd)

    const result = new Uint8Array(before.length + vcBlock.length + after.length)
    result.set(before, 0)
    result.set(vcBlock, before.length)
    result.set(after, before.length + vcBlock.length)
    return result.buffer
  }
}

function buildFlacVorbisComment(lyricsField) {
  const vendorStr = 'LRCGetter'
  const vendorLen = new Uint8Array(4)
  new DataView(vendorLen.buffer).setUint32(0, vendorStr.length, true)
  const vendorBytes = encoder.encode(vendorStr)
  const numFields = new Uint8Array(4)
  new DataView(numFields.buffer).setUint32(0, 1, true)

  const flen = new Uint8Array(4)
  new DataView(flen.buffer).setUint32(0, lyricsField.length, true)

  const blockData = new Uint8Array(4 + vendorBytes.length + 4 + 4 + lyricsField.length)
  let off = 0
  blockData.set(vendorLen, off); off += 4
  blockData.set(vendorBytes, off); off += vendorBytes.length
  blockData.set(numFields, off); off += 4
  blockData.set(flen, off); off += 4
  blockData.set(lyricsField, off)

  const blockSize = blockData.length
  const header = new Uint8Array(4)
  header[0] = 0x04 | 0x80
  header[1] = (blockSize >> 16) & 0xff
  header[2] = (blockSize >> 8) & 0xff
  header[3] = blockSize & 0xff

  const result = new Uint8Array(4 + blockData.length)
  result.set(header, 0)
  result.set(blockData, 4)
  return result
}

// --- Main dispatcher ---

function detectFormat(data) {
  if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) return 'mp3'
  if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) return 'mp3'
  const sig = decoder.decode(data.slice(0, 4))
  if (sig === 'fLaC') return 'flac'
  if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) return 'ogg'
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) return 'm4a'
  return null
}

function syncedLinesToLrc(syncedLines) {
  return syncedLines
    .map(line => {
      const ts = line.start_ms != null
        ? `[${String(Math.floor(line.start_ms / 60000)).padStart(2, '0')}:${String(Math.floor((line.start_ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((line.start_ms % 1000) / 10)).padStart(2, '0')}]`
        : ''
      return `${ts}${line.text}`
    })
    .join('\n')
}

async function embedLyricsInFile(fileHandle, plainLyrics, syncedLines) {
  const file = await fileHandle.getFile()
  const buffer = await file.arrayBuffer()
  const data = new Uint8Array(buffer)
  const format = detectFormat(data)
  if (!format) return { success: false, message: `Unsupported audio format` }

  let modified

  if (format === 'mp3') {
    const existingTag = findId3v2Tag(data)
    if (existingTag) {
      modified = replaceOrAddLyricFrames(data.slice(existingTag.offset, existingTag.offset + existingTag.size), plainLyrics, syncedLines)
    } else {
      modified = buildId3v2Tag(plainLyrics, syncedLines)
    }
    const combined = new Uint8Array(modified.length + data.length)
    combined.set(modified, 0)
    combined.set(data, modified.length)
    modified = combined
  } else if (format === 'flac') {
    const result = embedInFlac(data, plainLyrics)
    if (!result) return { success: false, message: 'Failed to embed lyrics in FLAC' }
    modified = new Uint8Array(result)
  } else {
    return { success: false, message: `Embedding lyrics into ${format.toUpperCase()} files is not yet supported` }
  }

  const writable = await fileHandle.createWritable()
  await writable.write(modified)
  await writable.close()

  return { success: true, message: `Embedded lyrics into ${file.name}` }
}

export { embedLyricsInFile, detectFormat }
