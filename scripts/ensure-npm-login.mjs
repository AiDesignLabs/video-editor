import { spawnSync } from 'node:child_process'
import process from 'node:process'

const registry = process.env.NPM_PUBLISH_REGISTRY || 'https://registry.npmjs.org/'

function runNpm(args, stdio = 'pipe') {
  const result = spawnSync('npm', args, {
    encoding: 'utf8',
    stdio,
  })

  if (result.error) {
    throw result.error
  }

  return result
}

function whoami() {
  const result = runNpm(['whoami', '--registry', registry])

  if (result.status !== 0) {
    return null
  }

  return result.stdout.trim() || null
}

function ensureNpmLogin() {
  const currentUser = whoami()

  if (currentUser) {
    console.log(`[publish] npm auth verified for "${registry}" as "${currentUser}".`)
    return
  }

  console.log(`[publish] npm auth missing for "${registry}". Starting "npm login"...`)

  const loginResult = runNpm(['login', '--registry', registry], 'inherit')

  if (loginResult.status !== 0) {
    process.exit(loginResult.status || 1)
  }

  const userAfterLogin = whoami()

  if (!userAfterLogin) {
    console.error(`[publish] npm login finished, but auth verification failed for "${registry}".`)
    process.exit(1)
  }

  console.log(`[publish] npm auth verified for "${registry}" as "${userAfterLogin}".`)
}

try {
  ensureNpmLogin()
}
catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[publish] failed to run npm command: ${message}`)
  process.exit(1)
}
