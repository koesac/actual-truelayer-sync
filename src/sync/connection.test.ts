import { describe, it, expect, vi, beforeEach } from 'vitest'
import { syncConnection } from './connection'
import type { Connection, Config } from '../config/schema'

vi.mock('../truelayer')
vi.mock('./accounts')
vi.mock('./account')
vi.mock('axios')

import * as truelayer from '../truelayer/truelayer'
import * as accounts from './accounts'
import * as account from './account'
import axios from 'axios'

const baseConnection: Connection = {
  name: 'My Bank',
  refreshToken: 'old-refresh-token',
  accounts: [{ trueLayerId: 'acc-1', actualId: 'a-1', friendlyName: 'Current Account' }],
}

const baseConfig: Config = {
  includeCategoryInNotes: false,
  connections: [baseConnection],
  env: {
    TRUELAYER_CLIENT_ID: 'client-id',
    TRUELAYER_CLIENT_SECRET: 'client-secret',
    ACTUAL_SERVER_URL: 'http://localhost:5006',
    ACTUAL_SERVER_PASSWORD: 'password',
    ACTUAL_SYNC_ID: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  },
}

describe('syncConnection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('refreshes the token and updates connection.refreshToken', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())

    const connection = { ...baseConnection }
    await syncConnection(connection, baseConfig)

    expect(connection.refreshToken).toBe('new-refresh')
  })

  it('calls fetchAccountMap with the connection and access token', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'old-refresh-token',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())

    await syncConnection({ ...baseConnection }, baseConfig)

    expect(accounts.fetchAccountMap).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Bank' }), 'new-access')
  })

  it('calls syncAccount for each account in the connection', async () => {
    vi.mocked(truelayer.refreshToken).mockResolvedValueOnce({
      access_token: 'new-access',
      refresh_token: 'old-refresh-token',
    })
    vi.mocked(accounts.fetchAccountMap).mockResolvedValueOnce(new Map())

    await syncConnection({ ...baseConnection }, baseConfig)

    expect(account.syncAccount).toHaveBeenCalledTimes(1)
    expect(account.syncAccount).toHaveBeenCalledWith(
      expect.objectContaining({ trueLayerId: 'acc-1' }),
      expect.any(Object),
      'new-access',
      expect.any(Map),
      false,
    )
  })

  it('logs an error and does not throw when refreshToken fails with axios error', async () => {
    const axiosError = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { data: { error: 'invalid_client' } },
    })
    vi.mocked(truelayer.refreshToken).mockRejectedValueOnce(axiosError)
    vi.mocked(axios.isAxiosError).mockReturnValueOnce(true)

    await expect(syncConnection({ ...baseConnection }, baseConfig)).resolves.toBeUndefined()
    expect(accounts.fetchAccountMap).not.toHaveBeenCalled()
  })

  it('logs an error and does not throw when refreshToken fails with a generic error', async () => {
    vi.mocked(truelayer.refreshToken).mockRejectedValueOnce(new Error('Network failure'))
    vi.mocked(axios.isAxiosError).mockReturnValueOnce(false)

    await expect(syncConnection({ ...baseConnection }, baseConfig)).resolves.toBeUndefined()
  })
})
