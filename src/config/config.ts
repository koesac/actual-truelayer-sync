import fs from 'fs/promises'
import path from 'path'
import { log, logError } from '../utils/logger'
import {
  Config,
  CredentialsSchema,
  ValidatedEnvSchema,
  FileConfig,
  FileConfigSchema,
  State,
  StateSchema,
} from './schema'
import { readJSON, writeJSON } from '../utils/file'

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const STATE_PATH = path.join(DATA_DIR, 'state.json')
const CREDENTIALS_PATH = path.join(DATA_DIR, 'credentials.json')
const CURRENT_CONFIG_VERSION = 2

/**
 * Load credentials.json from the data volume, if present.
 * Returns an empty object if the file doesn't exist or can't be parsed.
 */
async function loadCredentials(): Promise<Record<string, string>> {
  try {
    await fs.access(CREDENTIALS_PATH)
  } catch {
    return {}
  }
  try {
    const raw = await readJSON<unknown>(CREDENTIALS_PATH)
    const result = CredentialsSchema.safeParse(raw)
    if (!result.success) {
      logError(['Config'], 'credentials.json is invalid — falling back to env vars only')
      return {}
    }
    // Strip undefined values so they don't shadow real env vars when spread
    return Object.fromEntries(
      Object.entries(result.data).filter(([, v]) => v !== undefined && v !== ''),
    ) as Record<string, string>
  } catch (e) {
    logError(['Config'], `Could not read credentials.json: ${e}`)
    return {}
  }
}

export async function loadConfig(): Promise<Config> {
  // 1. Load credentials file (volume-stored, gitignored)
  const fileCreds = await loadCredentials()

  // 2. Merge: credentials file takes precedence over environment variables
  const merged = { ...process.env, ...fileCreds }

  // 3. Validate the merged result — all required fields must be present now
  const envResult = ValidatedEnvSchema.safeParse(merged)
  if (!envResult.success) {
    const issues = envResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(
      `Missing or invalid credentials:\n${issues}\n\n` +
        `Set them in the setup UI (Credentials page) or in your .env file.`,
    )
  }

  // 4. Load and validate config file
  const rawConfig = await readJSON<FileConfig>(CONFIG_PATH)
  const fileResult = FileConfigSchema.safeParse(rawConfig)
  if (!fileResult.success) {
    const issues = fileResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid config file:\n${issues}\n\nSee config.example.json for the expected format.`)
  }

  // 5. Verify version
  if (fileResult.data.version !== CURRENT_CONFIG_VERSION) {
    throw new Error(
      `Config version mismatch: found v${fileResult.data.version}, expected v${CURRENT_CONFIG_VERSION}.\n` +
        `See MIGRATION.md for upgrade instructions.`,
    )
  }

  // 6. Load and validate state file
  const rawState = await readJSON<State>(STATE_PATH)
  const stateResult = StateSchema.safeParse(rawState)
  if (!stateResult.success) {
    const issues = stateResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid state file:\n${issues}\n\nSee state.example.json for the expected format.`)
  }

  // 7. Warn about connections with no state entry
  for (const connection of fileResult.data.connections) {
    if (!stateResult.data.connections[connection.name]) {
      logError(['Config'], `No state entry for connection "${connection.name}" — it will be skipped during sync.`)
    }
  }

  return { ...fileResult.data, env: envResult.data, state: stateResult.data }
}

export async function writeState(config: Config): Promise<void> {
  await writeJSON(STATE_PATH, config.state)
  log(['Config'], 'State saved.')
}
