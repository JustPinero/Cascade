export function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-space-700 w-48" />
      <div className="h-3 bg-space-700 w-64" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="p-4 border border-space-600 bg-space-800">
            <div className="h-4 bg-space-700 w-2/3 mb-3" />
            <div className="h-3 bg-space-700 w-1/3 mb-3" />
            <div className="flex justify-between">
              <div className="h-3 bg-space-700 w-1/4" />
              <div className="h-3 bg-space-700 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
