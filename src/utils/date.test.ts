import { describe, it, expect } from 'vitest'
import { computeFromDate } from './date'

describe('computeFromDate', () => {
  it('subtracts 14 days from the given date', () => {
    expect(computeFromDate('2026-04-24')).toBe('2026-04-10')
  })

  it('handles month boundaries', () => {
    expect(computeFromDate('2026-04-10')).toBe('2026-03-27')
  })

  it('handles year boundaries', () => {
    expect(computeFromDate('2026-01-10')).toBe('2025-12-27')
  })

  it('handles leap years', () => {
    expect(computeFromDate('2024-03-07')).toBe('2024-02-22')
  })
})
