export default function ListingsLoading() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 md:space-y-5 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-6 w-28 bg-gray-200 rounded" />
          <div className="h-3 w-40 bg-gray-100 rounded" />
        </div>
        <div className="h-8 w-32 bg-gray-200 rounded" />
      </div>

      <div className="h-9 w-full sm:max-w-md bg-gray-100 rounded" />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-100 overflow-hidden">
            <div className="w-full h-36 bg-gray-200" />
            <div className="p-4 space-y-3">
              <div className="h-4 w-3/4 bg-gray-200 rounded" />
              <div className="h-5 w-1/3 bg-gray-200 rounded" />
              <div className="h-3 w-1/2 bg-gray-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
