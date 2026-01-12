import { sha256 } from 'js-sha256';

function hexStringToUint8Array(hex) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return arr;
}

function compareHex(hash, target) {
  const a = hexStringToUint8Array(hash);
  const b = hexStringToUint8Array(target);
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

// Allow for cancel
let stopped = false;

onmessage = async function (e) {
  if (e.data.cancel) {
    stopped = true;
    postMessage({ cancelled: true });
    return;
  }
  const { prefix, target, start, stride, batchSize } = e.data;
  let nonce = start;
  const targetLower = target.toLowerCase();

  while (!stopped) {
    for (let b = 0; b < batchSize; b++) {
      const input = `${prefix}:${nonce}`;
      const hash = sha256(input);
      if (compareHex(hash, targetLower)) {
        postMessage({ found: true, nonce, hash, attempts: nonce + 1 });
        return;
      }
      nonce += stride;
      if (stopped) break;
    }
    postMessage({ progress: nonce });
    await new Promise((r) => setTimeout(r, 0));
  }
  postMessage({ cancelled: true });
};
