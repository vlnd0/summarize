import { runCli } from './run.js'

function handlePipeErrors(stream: NodeJS.WritableStream) {
  stream.on('error', (error: unknown) => {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'EPIPE') {
      process.exit(0)
    }
    throw error
  })
}

handlePipeErrors(process.stdout)
handlePipeErrors(process.stderr)

runCli(process.argv.slice(2), {
  env: process.env,
  fetch: globalThis.fetch.bind(globalThis),
  stdout: process.stdout,
  stderr: process.stderr,
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
