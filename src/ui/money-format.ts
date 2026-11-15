const wholeEuros = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const euroCents = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 })

/**
 * Euro cents for display. Researched club budgets (format 62) reach tens of millions, so one million euros and more
 * read as millions with up to two decimals ("€4.2M", "€24.31M"); smaller sums keep whole euros, or cents when `precise`.
 */
export function formatEuros(amount: number, precise = false): string {
  const euros = amount / 100
  if (Math.abs(euros) >= 1_000_000) {
    const millions = Math.round(Math.abs(euros) / 10_000) / 100
    return `${euros < 0 ? '-' : ''}€${millions.toLocaleString('en-IE', { maximumFractionDigits: 2 })}M`
  }
  return (precise ? euroCents : wholeEuros).format(euros)
}

/** Exact euro cents for detailed accounting rows, whatever the size. */
export const formatExactEuros = (amount: number): string => euroCents.format(amount / 100)
