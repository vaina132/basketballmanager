import { useSyncExternalStore } from 'react'
import { getDisplayCurrency, subscribeDisplayCurrency, type DisplayCurrency } from './money-format'

/** The display currency for React screens (NBA step 6); they show again when it changes. */
export function useDisplayCurrency(): DisplayCurrency {
  return useSyncExternalStore(subscribeDisplayCurrency, getDisplayCurrency, getDisplayCurrency)
}
