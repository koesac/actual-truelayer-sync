import type { Account, Connection } from '../config'

export function resolveIsCard(configAccount: Account, connection: Connection): boolean {
  return configAccount.isCard ?? connection.isCard ?? false
}
