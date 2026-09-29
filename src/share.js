/* Putting a set in a link, and getting it back out.

   The link carries REFERENCES, not cards. Every copy of the app already has the
   words; a shared set only has to say which ones. That is why a thirty-word
   test list fits in 286 characters including the address — short enough to be
   an ordinary URL and to scan as a QR code across a classroom.

   It lives in the fragment, so the payload never reaches the server or its
   logs.

   Format:  <version>.<name>.<words>

   Version 1 is deflate-raw, version 0 is uncompressed for browsers without
   CompressionStream. Both halves are base64url. The version is first so a later
   format can be recognised rather than mis-read — a link made next year that
   this copy cannot understand should say so, not decode to the wrong words. */

const LATEST = '1'

/* A truncated link is the failure mode to design for: messaging apps wrap long
   URLs, and half a payload that still inflates would save a silently short word
   list, which is the worst outcome here. Deflate fails on truncation, and these
   caps stop a malformed or hostile payload inflating without bound. */
const MAX_URL_BYTES = 8 * 1024
const MAX_WORDS_BYTES = 64 * 1024
const MAX_NAME_BYTES = 256

const enc = new TextEncoder()
const dec = new TextDecoder()

const toBase64Url = (bytes) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const canCompress = () => typeof CompressionStream === 'function'

async function through(stream, bytes, limit) {
  const output = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()
  if (output.byteLength > limit) throw new Error('too big')
  return new Uint8Array(output)
}

/* ---------- out ---------- */

export async function encodeSet({ label, forms }) {
  const words = enc.encode(forms.join(' '))
  const useDeflate = canCompress()
  const body = useDeflate
    ? await through(new CompressionStream('deflate-raw'), words, MAX_WORDS_BYTES)
    : words
  return [useDeflate ? LATEST : '0', toBase64Url(enc.encode(label)), toBase64Url(body)].join('.')
}

export async function shareUrl(set) {
  // Built from the page's own address, so it works on localhost, on a preview
  // and in production without anything to configure.
  const base = `${location.origin}${location.pathname}`
  return `${base}#s=${await encodeSet(set)}`
}

/* ---------- in ---------- */

export class ShareError extends Error {}

export async function decodeSet(value) {
  if (typeof value !== 'string' || !value) throw new ShareError('empty')
  if (value.length > MAX_URL_BYTES) throw new ShareError('too long')

  const parts = value.split('.')
  if (parts.length !== 3) throw new ShareError('incomplete')
  const [version, name, body] = parts
  if (version !== '0' && version !== LATEST) throw new ShareError('newer')

  let labelBytes
  let wordBytes
  try {
    labelBytes = fromBase64Url(name)
    wordBytes = fromBase64Url(body)
  } catch {
    // atob throws on anything that is not base64 — a link mangled in transit.
    throw new ShareError('incomplete')
  }
  if (labelBytes.length > MAX_NAME_BYTES) throw new ShareError('incomplete')

  if (version === LATEST) {
    if (typeof DecompressionStream !== 'function') throw new ShareError('unsupported')
    try {
      wordBytes = await through(new DecompressionStream('deflate-raw'), wordBytes, MAX_WORDS_BYTES)
    } catch {
      /* The one that matters. A link cut short by a messaging app fails here
         rather than inflating into a shorter word list nobody notices. */
      throw new ShareError('incomplete')
    }
  }

  const label = dec.decode(labelBytes).replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  const forms = [...new Set(dec.decode(wordBytes).split(' ').filter(Boolean))]
  if (!label || !forms.length) throw new ShareError('incomplete')
  return { label, forms }
}

/* Whatever the page was opened with, read once and then removed from the
   address bar. `applyUpdate()` reloads the page to install a new service
   worker, and a reload preserves the fragment — without this, a link would be
   offered again after every update. */
export function takeSharedFromUrl() {
  const match = /[#&]s=([^&]+)/.exec(location.hash)
  if (!match) return null
  history.replaceState(null, '', location.pathname + location.search)
  return decodeURIComponent(match[1])
}
