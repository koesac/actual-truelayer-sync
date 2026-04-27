export function buildImportSummary(added: number, updated: number): string {
  if (added > 0 && updated > 0) {
    return `Added ${added} and updated ${updated} transaction${updated === 1 ? '' : 's'}`
  }
  if (added > 0) {
    return `Added ${added} transaction${added === 1 ? '' : 's'}`
  }
  if (updated > 0) {
    return `Updated ${updated} transaction${updated === 1 ? '' : 's'}`
  }
  return 'No new transactions to import'
}
