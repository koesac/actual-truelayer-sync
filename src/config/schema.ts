import { z } from 'zod'
import cron from 'node-cron'

export const AccountSchema = z
  .object({
    trueLayerId: z.string().min(1),
    actualId: z.string().min(1),
    // `name` is the legacy field written by older versions of the setup UI.
    // Accept either; `friendlyName` takes precedence. Both are optional at the
    // raw-input level so we can validate the merged result in `.transform()`.
    friendlyName: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    isCard: z.boolean().optional(),
    flip: z.boolean().optional(),
  })
  .transform((val) => {
    const resolved = val.friendlyName ?? val.name
    if (!resolved) {
      return { ...val, friendlyName: '' }
    }
    const { name: _dropped, ...rest } = val
    return { ...rest, friendlyName: resolved }
  })
  .refine((val) => val.friendlyName.length > 0, {
    message: 'friendlyName (or legacy name) must be a non-empty string',
    path: ['friendlyName'],
  })

export const ConnectionSchema = z.object({
  name: z.string().min(1),
  isCard: z.boolean().optional(),
  accounts: z.array(AccountSchema),
})

export const FileConfigSchema = z
  .object({
    version: z.number().int(),
    includeCategoryInNotes: z.boolean().default(false),
    lookbackDays: z.number().int().positive().default(14),
    connections: z.array(ConnectionSchema).min(1),
  })
  .refine((data) => new Set(data.connections.map((c) => c.name)).size === data.connections.length, {
    message: 'Connection names must be unique',
    path: ['connections'],
  })

/**
 * Credentials stored in data/credentials.json (volume-mounted, gitignored).
 * All fields optional — only present fields override env vars.
 */
export const CredentialsSchema = z.object({
  TRUELAYER_CLIENT_ID: z.string().optional(),
  TRUELAYER_CLIENT_SECRET: z.string().optional(),
  TRUELAYER_ENV: z.enum(['live', 'sandbox']).optional(),
  ACTUAL_SERVER_URL: z.string().optional(),
  ACTUAL_SERVER_PASSWORD: z.string().optional(),
  ACTUAL_SYNC_ID: z.string().optional(),
  CRON_SCHEDULE: z.string().optional(),
})

/**
 * EnvSchema: all credential fields are optional with empty-string defaults so
 * the process can start without them in the environment (credentials.json is
 * loaded separately and merged in config.ts before validation).
 */
export const EnvSchema = z.object({
  TRUELAYER_CLIENT_ID: z.string().default(''),
  TRUELAYER_CLIENT_SECRET: z.string().default(''),
  TRUELAYER_ENV: z.enum(['live', 'sandbox']).default('live'),
  ACTUAL_SERVER_URL: z.string().default(''),
  ACTUAL_SERVER_PASSWORD: z.string().default(''),
  ACTUAL_SYNC_ID: z.string().default(''),
  CRON_SCHEDULE: z
    .string()
    .optional()
    .refine((val) => val === undefined || cron.validate(val), { message: 'Invalid cron expression' }),
  DEBUG: z.string().optional(),
  TZ: z.string().optional(),
  LOG_FORMAT: z.enum(['text', 'json']).default('json'),
})

/**
 * The fully-resolved, validated env shape after merging credentials.json over
 * environment variables.  All credential strings must be non-empty at this
 * point — enforced by ValidatedEnvSchema used inside loadConfig().
 */
export const ValidatedEnvSchema = z.object({
  TRUELAYER_CLIENT_ID: z.string().min(1, 'TRUELAYER_CLIENT_ID is required'),
  TRUELAYER_CLIENT_SECRET: z.string().min(1, 'TRUELAYER_CLIENT_SECRET is required'),
  TRUELAYER_ENV: z.enum(['live', 'sandbox']).default('live'),
  ACTUAL_SERVER_URL: z.url('ACTUAL_SERVER_URL must be a valid URL'),
  ACTUAL_SERVER_PASSWORD: z.string().min(1, 'ACTUAL_SERVER_PASSWORD is required'),
  ACTUAL_SYNC_ID: z.uuid('ACTUAL_SYNC_ID must be a valid UUID'),
  CRON_SCHEDULE: z
    .string()
    .optional()
    .refine((val) => val === undefined || cron.validate(val), { message: 'Invalid cron expression' }),
  DEBUG: z.string().optional(),
  TZ: z.string().optional(),
  LOG_FORMAT: z.enum(['text', 'json']).default('json'),
})

export const AccountStateSchema = z.object({
  lastSyncDate: z.string().date().optional(),
})

export const ConnectionStateSchema = z.object({
  refreshToken: z.string().min(1),
  accounts: z.record(z.string(), AccountStateSchema).default({}),
})

export const StateSchema = z.object({
  connections: z.record(z.string(), ConnectionStateSchema).default({}),
})

export type Account = z.infer<typeof AccountSchema>
export type Connection = z.infer<typeof ConnectionSchema>
export type FileConfig = z.infer<typeof FileConfigSchema>
export type Credentials = z.infer<typeof CredentialsSchema>
export type AccountState = z.infer<typeof AccountStateSchema>
export type ConnectionState = z.infer<typeof ConnectionStateSchema>
export type Env = z.infer<typeof ValidatedEnvSchema>
export type State = z.infer<typeof StateSchema>

export type Config = FileConfig & {
  env: Env
  state: State
}
