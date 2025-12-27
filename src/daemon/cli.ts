import fs from 'node:fs/promises'
import path from 'node:path'

import { buildDaemonHelp } from '../run/help.js'
import { readDaemonConfig, writeDaemonConfig } from './config.js'
import { DAEMON_HOST, DAEMON_PORT_DEFAULT } from './constants.js'
import { mergeDaemonEnv } from './env-merge.js'
import { buildEnvSnapshotFromEnv } from './env-snapshot.js'
import {
  installLaunchAgent,
  isLaunchAgentLoaded,
  restartLaunchAgent,
  uninstallLaunchAgent,
} from './launchd.js'
import { runDaemonServer } from './server.js'

type DaemonCliContext = {
  normalizedArgv: string[]
  envForRun: Record<string, string | undefined>
  fetchImpl: typeof fetch
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
}

function readArgValue(argv: string[], name: string): string | null {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(`${name}=`.length).trim() || null
  const index = argv.indexOf(name)
  if (index === -1) return null
  const next = argv[index + 1]
  if (!next || next.startsWith('-')) return null
  return next.trim() || null
}

function wantHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h') || argv.includes('help')
}

function hasArg(argv: string[], name: string): boolean {
  return argv.includes(name) || argv.some((a) => a.startsWith(`${name}=`))
}

function assertLaunchdAvailable(command: string) {
  if (process.platform === 'darwin') return
  const label = process.platform === 'win32' ? 'Windows' : process.platform
  throw new Error(
    `${command} uses launchd and is macOS-only (detected ${label}). No Linux/Windows service support yet.`
  )
}

async function waitForHealth({
  fetchImpl,
  port,
  timeoutMs,
}: {
  fetchImpl: typeof fetch
  port: number
  timeoutMs: number
}): Promise<void> {
  const url = `http://${DAEMON_HOST}:${port}/health`
  const startedAt = Date.now()
  // Simple polling; avoids bringing in extra deps.
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetchImpl(url, { method: 'GET' })
      if (res.ok) return
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Daemon not reachable at ${url}`)
}

async function checkAuth({
  fetchImpl,
  token,
  port,
}: {
  fetchImpl: typeof fetch
  token: string
  port: number
}): Promise<boolean> {
  try {
    const res = await fetchImpl(`http://${DAEMON_HOST}:${port}/v1/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

async function resolveCliEntrypointPathForLaunchd(): Promise<string> {
  const argv1 = process.argv[1]
  if (!argv1) throw new Error('Unable to resolve CLI entrypoint path')

  const normalized = path.resolve(argv1)
  const looksLikeDist = /[/\\]dist[/\\].+\.cjs$/.test(normalized)
  if (looksLikeDist) {
    await fs.access(normalized)
    return normalized
  }

  const distCandidate = path.resolve(path.dirname(normalized), '../dist/cli.cjs')
  try {
    await fs.access(distCandidate)
    return distCandidate
  } catch {
    throw new Error(
      `Cannot find built CLI at ${distCandidate}. Run "pnpm build:cli" (or "pnpm build") first, or pass --dev to install a dev LaunchAgent.`
    )
  }
}

function resolveRepoRootForDev(): string {
  const argv1 = process.argv[1]
  if (!argv1) throw new Error('Unable to resolve repo root')
  const normalized = path.resolve(argv1)
  const parts = normalized.split(path.sep)
  const srcIndex = parts.lastIndexOf('src')
  if (srcIndex === -1) throw new Error('Dev mode requires running from repo (src/cli.ts)')
  return parts.slice(0, srcIndex).join(path.sep)
}

async function resolveTsxCliPath(repoRoot: string): Promise<string> {
  const candidate = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  await fs.access(candidate)
  return candidate
}

export async function handleDaemonRequest({
  normalizedArgv,
  envForRun,
  fetchImpl,
  stdout,
  stderr,
}: DaemonCliContext): Promise<boolean> {
  if (normalizedArgv[0]?.toLowerCase() !== 'daemon') return false

  const sub = normalizedArgv[1]?.toLowerCase() ?? null
  if (!sub || wantHelp(normalizedArgv)) {
    stdout.write(`${buildDaemonHelp()}\n`)
    return true
  }

  if (sub === 'install') {
    assertLaunchdAvailable('summarize daemon install')
    const token = readArgValue(normalizedArgv, '--token')
    if (!token) throw new Error('Missing --token')
    const portRaw = readArgValue(normalizedArgv, '--port')
    const port = portRaw ? Number(portRaw) : DAEMON_PORT_DEFAULT
    if (!Number.isFinite(port) || port <= 0 || port >= 65535) throw new Error('Invalid --port')
    const dev = hasArg(normalizedArgv, '--dev')

    const envSnapshot = buildEnvSnapshotFromEnv(envForRun)
    const configPath = await writeDaemonConfig({
      env: envForRun,
      config: { token, port, env: envSnapshot },
    })

    const nodePath = process.execPath
    const { programArguments, workingDirectory } = await (async () => {
      if (!dev) {
        const cliEntrypointPath = await resolveCliEntrypointPathForLaunchd()
        return {
          programArguments: [nodePath, cliEntrypointPath, 'daemon', 'run'],
          workingDirectory: undefined,
        }
      }
      const repoRoot = resolveRepoRootForDev()
      const tsxCliPath = await resolveTsxCliPath(repoRoot)
      const devCliPath = path.join(repoRoot, 'src', 'cli.ts')
      await fs.access(devCliPath)
      return {
        programArguments: [nodePath, tsxCliPath, devCliPath, 'daemon', 'run'],
        workingDirectory: repoRoot,
      }
    })()

    await installLaunchAgent({ env: envForRun, stdout, programArguments, workingDirectory })
    await waitForHealth({ fetchImpl, port, timeoutMs: 5000 })
    const authed = await checkAuth({ fetchImpl, token: token.trim(), port })
    if (!authed) throw new Error('Daemon is up but auth failed (token mismatch?)')

    stdout.write(`Daemon config: ${configPath}\n`)
    stdout.write(`OK: daemon is running and authenticated.\n`)
    return true
  }

  if (sub === 'status') {
    assertLaunchdAvailable('summarize daemon status')
    const cfg = await readDaemonConfig({ env: envForRun })
    if (!cfg) {
      stdout.write('Daemon not installed (missing ~/.summarize/daemon.json)\n')
      stdout.write('Run: summarize daemon install --token <token>\n')
      return true
    }
    const loaded = await isLaunchAgentLoaded()
    const healthy = await (async () => {
      try {
        await waitForHealth({ fetchImpl, port: cfg.port, timeoutMs: 800 })
        return true
      } catch {
        return false
      }
    })()
    const authed = healthy
      ? await checkAuth({ fetchImpl, token: cfg.token, port: cfg.port })
      : false

    stdout.write(`LaunchAgent: ${loaded ? 'loaded' : 'not loaded'}\n`)
    stdout.write(`Daemon: ${healthy ? `up on ${DAEMON_HOST}:${cfg.port}` : 'down'}\n`)
    stdout.write(`Auth: ${authed ? 'ok' : 'failed'}\n`)
    return true
  }

  if (sub === 'restart') {
    assertLaunchdAvailable('summarize daemon restart')
    const cfg = await readDaemonConfig({ env: envForRun })
    if (!cfg) {
      stdout.write('Daemon not installed (missing ~/.summarize/daemon.json)\n')
      stdout.write('Run: summarize daemon install --token <token>\n')
      return true
    }
    const loaded = await isLaunchAgentLoaded()
    if (!loaded) {
      stdout.write('LaunchAgent not loaded. Run: summarize daemon install --token <token>\n')
      return true
    }

    await restartLaunchAgent({ stdout })
    await waitForHealth({ fetchImpl, port: cfg.port, timeoutMs: 5000 })
    const authed = await checkAuth({ fetchImpl, token: cfg.token, port: cfg.port })
    if (!authed) throw new Error('Daemon restarted but auth failed (token mismatch?)')

    stdout.write('OK: daemon restarted and authenticated.\n')
    return true
  }

  if (sub === 'uninstall') {
    assertLaunchdAvailable('summarize daemon uninstall')
    await uninstallLaunchAgent({ env: envForRun, stdout })
    stdout.write('Uninstalled (LaunchAgent unloaded). Config left in ~/.summarize/daemon.json\n')
    return true
  }

  if (sub === 'run') {
    const cfg = await readDaemonConfig({ env: envForRun })
    if (!cfg) {
      stderr.write('Missing ~/.summarize/daemon.json\n')
      stderr.write('Run: summarize daemon install --token <token>\n')
      throw new Error('Daemon not configured')
    }
    const mergedEnv = mergeDaemonEnv({ envForRun, snapshot: cfg.env })
    await runDaemonServer({ env: mergedEnv, fetchImpl, config: cfg })
    return true
  }

  stdout.write(`${buildDaemonHelp()}\n`)
  return true
}
