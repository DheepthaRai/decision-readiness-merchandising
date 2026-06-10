export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <svg className="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      <span className="text-sm font-medium">Loading data…</span>
    </div>
  )
}

export function ErrorState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-500">
      <span className="text-4xl">⚠️</span>
      <p className="text-sm font-medium">Could not load data</p>
      <p className="text-xs text-slate-400 max-w-sm text-center">{message}</p>
      <p className="text-xs text-slate-400">
        Make sure the pipeline has been run and CSVs are in{' '}
        <code className="bg-slate-100 px-1 rounded">frontend/public/data/</code>
      </p>
    </div>
  )
}
