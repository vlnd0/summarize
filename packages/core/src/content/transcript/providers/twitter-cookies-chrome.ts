import { execSync } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CookieExtractionResult, TwitterCookies } from './twitter-cookies-utils.js'
import { createEmptyCookies, serializeCookieJar } from './twitter-cookies-utils.js'

function getChromeProfilesRoot(): string {
  const home = process.env.HOME || ''
  return join(home, 'Library', 'Application Support', 'Google', 'Chrome')
}

function resolveChromeCookiesPath(profile?: string): { path: string; profile: string } | null {
  const root = getChromeProfilesRoot()
  if (profile) {
    const candidate = join(root, profile, 'Cookies')
    return existsSync(candidate) ? { path: candidate, profile } : null
  }

  const defaultPath = join(root, 'Default', 'Cookies')
  if (existsSync(defaultPath)) {
    return { path: defaultPath, profile: 'Default' }
  }

  try {
    const entries = readdirSync(root, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== 'Default')
    const profileCandidates = candidates
      .filter((name) => name.startsWith('Profile '))
      .sort((a, b) => {
        const aMatch = a.match(/^Profile (\d+)$/)
        const bMatch = b.match(/^Profile (\d+)$/)
        if (aMatch && bMatch) {
          return Number(aMatch[1]) - Number(bMatch[1])
        }
        return a.localeCompare(b)
      })
    const fallbackCandidates = [
      ...profileCandidates,
      ...candidates.filter((n) => !n.startsWith('Profile ')),
    ]

    for (const name of fallbackCandidates) {
      const candidate = join(root, name, 'Cookies')
      if (existsSync(candidate)) {
        return { path: candidate, profile: name }
      }
    }
  } catch {
    return null
  }

  return null
}

function decryptCookieValue(encryptedHex: string): string | null {
  try {
    const encryptedValue = Buffer.from(encryptedHex, 'hex')
    if (encryptedValue.length < 4) {
      return null
    }

    const version = encryptedValue.subarray(0, 3).toString('utf8')
    if (version !== 'v10' && version !== 'v11') {
      return encryptedValue.toString('utf8')
    }

    const keyOutput = execSync(
      'security find-generic-password -s "Chrome Safe Storage" -w 2>/dev/null || echo ""',
      {
        encoding: 'utf8',
      }
    ).trim()

    if (!keyOutput) {
      return null
    }

    const salt = 'saltysalt'
    const iterations = 1003
    const keyLength = 16
    const derivedKey = pbkdf2Sync(keyOutput, salt, iterations, keyLength, 'sha1')

    const iv = Buffer.alloc(16, 0x20)
    const encryptedData = encryptedValue.subarray(3)

    const decipher = createDecipheriv('aes-128-cbc', derivedKey, iv)
    decipher.setAutoPadding(true)

    let decrypted = decipher.update(encryptedData)
    decrypted = Buffer.concat([decrypted, decipher.final()])

    const decryptedStr = decrypted.toString('utf8')
    const hexMatch = decryptedStr.match(/[a-f0-9]{32,}/i)
    if (hexMatch) {
      return hexMatch[0]
    }
    return decryptedStr.replace(/[^\x20-\x7E]/g, '')
  } catch {
    return null
  }
}

export async function extractCookiesFromChrome(profile?: string): Promise<CookieExtractionResult> {
  const warnings: string[] = []
  const cookies: TwitterCookies = createEmptyCookies()

  const selection = resolveChromeCookiesPath(profile)
  if (!selection) {
    const root = getChromeProfilesRoot()
    const detail = profile
      ? `Chrome cookies database not found at: ${join(root, profile, 'Cookies')}`
      : `Chrome cookies database not found under: ${root}`
    warnings.push(detail)
    return { cookies, warnings }
  }
  const cookiesPath = selection.path

  let tempDir: string | null = null

  try {
    tempDir = mkdtempSync(join(tmpdir(), 'twitter-cookies-'))
    const tempDbPath = join(tempDir, 'Cookies')
    copyFileSync(cookiesPath, tempDbPath)

    const walPath = `${cookiesPath}-wal`
    const shmPath = `${cookiesPath}-shm`
    if (existsSync(walPath)) {
      copyFileSync(walPath, `${tempDbPath}-wal`)
    }
    if (existsSync(shmPath)) {
      copyFileSync(shmPath, `${tempDbPath}-shm`)
    }

    const jar: Record<string, string> = {}
    const query =
      "SELECT name, hex(encrypted_value) as encrypted_hex FROM cookies WHERE host_key IN ('.x.com', '.twitter.com', 'x.com', 'twitter.com');"

    const result = execSync(`sqlite3 -separator '|' "${tempDbPath}" "${query}"`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }).trim()

    if (result) {
      for (const line of result.split('\n')) {
        const [name, encryptedHex] = line.split('|')
        if (!name || !encryptedHex) continue

        const decryptedValue = decryptCookieValue(encryptedHex)
        if (!decryptedValue) continue

        jar[name] = decryptedValue
        if (name === 'auth_token' && !cookies.authToken) {
          cookies.authToken = decryptedValue
        } else if (name === 'ct0' && !cookies.ct0) {
          cookies.ct0 = decryptedValue
        }
      }
    }

    if (Object.keys(jar).length > 0) {
      cookies.cookieHeader = serializeCookieJar(jar)
    }

    if (cookies.authToken || cookies.ct0) {
      cookies.source =
        selection.profile === 'Default'
          ? 'Chrome default profile'
          : `Chrome profile "${selection.profile}"`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`Failed to read Chrome cookies: ${message}`)
  } finally {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  }

  if (!cookies.authToken && !cookies.ct0) {
    warnings.push(
      'No Twitter cookies found in Chrome. Make sure you are logged into x.com in Chrome.'
    )
  }

  return { cookies, warnings }
}
