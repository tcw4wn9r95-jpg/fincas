import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AppData } from './lib/types'
import { loadData, saveData } from './lib/storage'

interface DataContextValue {
  data: AppData
  /** Replace the whole dataset (used by import / reset / demo). */
  setData: (next: AppData) => void
  /** Immutably update via a producer and persist. */
  update: (fn: (draft: AppData) => AppData) => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<AppData>(() => loadData())

  // Persist on every change.
  useEffect(() => {
    saveData(data)
  }, [data])

  const value = useMemo<DataContextValue>(
    () => ({
      data,
      setData: (next) => setDataState(next),
      update: (fn) => setDataState((prev) => fn(structuredClone(prev))),
    }),
    [data],
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}
