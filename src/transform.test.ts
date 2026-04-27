import { describe, it, expect } from 'vitest'
import { shouldFlipAmount, toActualAmount, transformTransaction, transformTransactions } from '../src/transform'
import type { Account } from '../src/config'
import type { TrueLayerAccount, TrueLayerCard, TrueLayerTransaction } from '../src/types'

const baseAccount: Account = {
  trueLayerId: 'tl-acc-1',
  actualId: 'actual-acc-1',
  friendlyName: 'My Account',
}

const baseTransaction: TrueLayerTransaction = {
  transaction_id: 'txn-1',
  timestamp: '2026-04-24T10:00:00Z',
  description: 'Coffee Shop',
  amount: 3.5,
  currency: 'GBP',
  transaction_type: 'DEBIT',
  transaction_category: 'PURCHASE',
  transaction_classification: [],
}

const trueLayerAccount: TrueLayerAccount = {
  account_id: 'tl-acc-1',
  account_type: 'TRANSACTION',
  currency: 'GBP',
  display_name: 'Current Account',
  update_timestamp: '2026-04-24T00:00:00Z',
  account_number: {},
  provider: { provider_id: 'first-direct' },
}

const trueLayerCreditCard: TrueLayerCard = {
  account_id: 'tl-card-1',
  card_network: 'VISA',
  card_type: 'CREDIT',
  currency: 'GBP',
  display_name: 'Credit Card',
  partial_card_number: '1234',
  name_on_card: 'Chris Sheppard',
  update_timestamp: '2026-04-24T00:00:00Z',
  provider: { provider_id: 'ms' },
}

const trueLayerDebitCard: TrueLayerCard = {
  ...trueLayerCreditCard,
  card_type: 'DEBIT',
}

describe('shouldFlipAmount', () => {
  it('returns false for a regular account with no flip config', () => {
    expect(shouldFlipAmount(baseAccount, trueLayerAccount)).toBe(false)
  })

  it('returns false when trueLayerAccount is undefined', () => {
    expect(shouldFlipAmount(baseAccount, undefined)).toBe(false)
  })

  it('returns true for a credit card with no explicit flip config', () => {
    expect(shouldFlipAmount(baseAccount, trueLayerCreditCard)).toBe(true)
  })

  it('returns false for a debit card with no explicit flip config', () => {
    expect(shouldFlipAmount(baseAccount, trueLayerDebitCard)).toBe(false)
  })

  it('explicit flip: true overrides a non-credit card', () => {
    expect(shouldFlipAmount({ ...baseAccount, flip: true }, trueLayerDebitCard)).toBe(true)
  })

  it('explicit flip: false overrides a credit card', () => {
    expect(shouldFlipAmount({ ...baseAccount, flip: false }, trueLayerCreditCard)).toBe(false)
  })

  it('explicit flip: true with no trueLayerAccount', () => {
    expect(shouldFlipAmount({ ...baseAccount, flip: true }, undefined)).toBe(true)
  })

  it('explicit flip: false with no trueLayerAccount', () => {
    expect(shouldFlipAmount({ ...baseAccount, flip: false }, undefined)).toBe(false)
  })
})

describe('toActualAmount', () => {
  it('converts pounds to pence', () => {
    expect(toActualAmount(3.5, false)).toBe(350)
  })

  it('flips amount when shouldFlip is true', () => {
    expect(toActualAmount(3.5, true)).toBe(-350)
  })

  it('handles zero', () => {
    expect(toActualAmount(0, false)).toBe(0)
    expect(toActualAmount(0, true)).toBe(0)
  })

  it('handles whole numbers', () => {
    expect(toActualAmount(100, false)).toBe(10000)
  })

  it('handles large amounts', () => {
    expect(toActualAmount(1234.56, false)).toBe(123456)
  })
})

describe('transformTransaction', () => {
  it('maps fields correctly', () => {
    const result = transformTransaction(baseTransaction, baseAccount, trueLayerAccount, false)
    expect(result.account).toBe('actual-acc-1')
    expect(result.date).toBe('2026-04-24')
    expect(result.amount).toBe(350)
    expect(result.payee_name).toBe('Coffee Shop')
    expect(result.imported_id).toBe('txn-1')
    expect(result.cleared).toBe(true)
  })

  it('strips time from timestamp to get date', () => {
    const result = transformTransaction(
      { ...baseTransaction, timestamp: '2026-01-15T23:59:59Z' },
      baseAccount,
      trueLayerAccount,
      false,
    )
    expect(result.date).toBe('2026-01-15')
  })

  it('sets notes to category when includeCategoryInNotes is true', () => {
    const result = transformTransaction(baseTransaction, baseAccount, trueLayerAccount, true)
    expect(result.notes).toBe('PURCHASE')
  })

  it('omits notes when includeCategoryInNotes is false', () => {
    const result = transformTransaction(baseTransaction, baseAccount, trueLayerAccount, false)
    expect(result.notes).toBeUndefined()
  })

  it('omits notes when category is UNKNOWN even if includeCategoryInNotes is true', () => {
    const result = transformTransaction(
      { ...baseTransaction, transaction_category: 'UNKNOWN' },
      baseAccount,
      trueLayerAccount,
      true,
    )
    expect(result.notes).toBeUndefined()
  })

  it('flips amount for a credit card', () => {
    const result = transformTransaction(baseTransaction, baseAccount, trueLayerCreditCard, false)
    expect(result.amount).toBe(-350)
  })

  it('does not flip amount for a regular account', () => {
    const result = transformTransaction(baseTransaction, baseAccount, trueLayerAccount, false)
    expect(result.amount).toBe(350)
  })

  it('explicit flip: false overrides credit card inference', () => {
    const result = transformTransaction(baseTransaction, { ...baseAccount, flip: false }, trueLayerCreditCard, false)
    expect(result.amount).toBe(350)
  })
})

describe('transformTransactions', () => {
  it('maps an array of transactions', () => {
    const transactions = [
      baseTransaction,
      { ...baseTransaction, transaction_id: 'txn-2', amount: 10.0, description: 'Supermarket' },
    ]
    const result = transformTransactions(transactions, baseAccount, trueLayerAccount, false)
    expect(result).toHaveLength(2)
    expect(result[0].imported_id).toBe('txn-1')
    expect(result[1].imported_id).toBe('txn-2')
    expect(result[1].amount).toBe(1000)
  })

  it('returns an empty array for empty input', () => {
    expect(transformTransactions([], baseAccount, trueLayerAccount, false)).toEqual([])
  })

  it('passes includeCategoryInNotes to each transaction', () => {
    const result = transformTransactions([baseTransaction], baseAccount, trueLayerAccount, true)
    expect(result[0].notes).toBe('PURCHASE')
  })
})
