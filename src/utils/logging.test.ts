import { describe, it, expect } from 'vitest'
import { buildImportSummary } from './logging'

describe('buildImportSummary', () => {
  it('returns added message for added only', () => {
    expect(buildImportSummary(3, 0)).toBe('Added 3 transactions')
  })

  it('returns singular for 1 added', () => {
    expect(buildImportSummary(1, 0)).toBe('Added 1 transaction')
  })

  it('returns updated message for updated only', () => {
    expect(buildImportSummary(0, 2)).toBe('Updated 2 transactions')
  })

  it('returns singular for 1 updated', () => {
    expect(buildImportSummary(0, 1)).toBe('Updated 1 transaction')
  })

  it('returns combined message for added and updated', () => {
    expect(buildImportSummary(3, 2)).toBe('Added 3 and updated 2 transactions')
  })

  it('uses singular for updated in combined message', () => {
    expect(buildImportSummary(3, 1)).toBe('Added 3 and updated 1 transaction')
  })

  it('returns no new transactions message when both are zero', () => {
    expect(buildImportSummary(0, 0)).toBe('No new transactions to import')
  })
})
