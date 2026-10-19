import { Buffer } from 'node:buffer'

const FAILURE = 'VITE_SUPABASE_ANON_KEY must be a public sb_publishable_ key or a legacy anon JWT. Refusing to build: never expose service_role, sb_secret_, or unrecognized keys in the frontend.'

function decodeSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error(FAILURE)
  const bytes = Buffer.from(segment, 'base64url')
  if (bytes.toString('base64url') !== segment) throw new Error(FAILURE)
  return bytes
}

/** A key-classification guard, not signature verification or authorization. */
export function assertPublicSupabaseKey(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192 || value.trim() !== value) {
      throw new Error(FAILURE)
    }
    if (/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(value)) return

    const parts = value.split('.')
    if (parts.length !== 3) throw new Error(FAILURE)
    const header = JSON.parse(decodeSegment(parts[0]).toString('utf8'))
    const payload = JSON.parse(decodeSegment(parts[1]).toString('utf8'))
    const signature = decodeSegment(parts[2])
    if (!header || Array.isArray(header) || header.alg !== 'HS256' || header.typ !== 'JWT' ||
        !payload || Array.isArray(payload) || payload.role !== 'anon' || signature.length !== 32) {
      throw new Error(FAILURE)
    }
  } catch {
    // Never include the supplied key, decoded claims, or a parser exception.
    throw new Error(FAILURE)
  }
}

export function publicSupabaseKeyGuard() {
  return {
    name: 'public-supabase-key-guard',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      // Vite has loaded mode-specific dotenv files and process-env overrides.
      // Abort before transforming source or writing any build output.
      assertPublicSupabaseKey(config.env.VITE_SUPABASE_ANON_KEY)
    },
  }
}
