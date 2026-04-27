import axios from 'axios'
import { listAccounts, listCards } from '../truelayer/truelayer'
import type { Connection } from '../config/schema'
import type { TrueLayerAccount, TrueLayerCard } from '../truelayer/types'

export async function fetchAccountMap(
  connection: Connection,
  accessToken: string,
): Promise<Map<string, TrueLayerAccount | TrueLayerCard>> {
  try {
    console.log(`[${connection.name}] Fetching ${connection.isCard ? 'card' : 'account'} details...`)
    const trueLayerAccounts = connection.isCard ? await listCards(accessToken) : await listAccounts(accessToken)

    const accountsById = new Map(trueLayerAccounts.map((a) => [a.account_id, a]))

    console.log(
      `[${connection.name}] └ Found ${trueLayerAccounts.length} ${connection.isCard ? 'card' : 'account'}${trueLayerAccounts.length === 1 ? '' : 's'}.`,
    )

    const configuredIds = new Set(connection.accounts.map((a) => a.trueLayerId))
    const unmatched = trueLayerAccounts.filter((a) => !configuredIds.has(a.account_id))
    if (unmatched.length > 0) {
      console.log(`[${connection.name}] Unmatched TrueLayer ${connection.isCard ? 'card' : 'account'} (not in config):`)
      for (const a of unmatched) {
        const detail =
          'account_type' in a ? ` (${(a as TrueLayerAccount).account_type})` : ` (${(a as TrueLayerCard).card_type})`
        console.log(`  └ ${a.display_name}${detail} — trueLayerId: ${a.account_id}`)
      }
    }

    return accountsById
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.data?.error === 'endpoint_not_supported') {
      console.log(`[${connection.name}] Provider does not support accounts listing — skipping unmatched account check.`)
      return new Map()
    }
    throw err
  }
}
