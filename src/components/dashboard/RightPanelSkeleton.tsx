export default function RightPanelSkeleton() {
  return (
    <div className="px-6 pb-6 flex flex-col gap-5">
      {/* Today Cards */}
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map(i => (
          <div
            key={i}
            className="rounded-xl animate-pulse"
            style={{ height: 72, backgroundColor: 'var(--surface-3)' }}
          />
        ))}
      </div>
      {/* Live Feed */}
      <div className="flex flex-col gap-2">
        <div className="animate-pulse rounded" style={{ height: 12, width: '40%', backgroundColor: 'var(--line)' }} />
        <div className="animate-pulse rounded-xl" style={{ height: 220, backgroundColor: 'var(--surface-3)' }} />
      </div>
      {/* Team Now */}
      <div className="flex flex-col gap-2">
        <div className="animate-pulse rounded" style={{ height: 12, width: '35%', backgroundColor: 'var(--line)' }} />
        <div className="animate-pulse rounded-xl" style={{ height: 130, backgroundColor: 'var(--surface-3)' }} />
      </div>
      {/* Schedule */}
      <div className="flex flex-col gap-2">
        <div className="animate-pulse rounded" style={{ height: 12, width: '45%', backgroundColor: 'var(--line)' }} />
        <div className="animate-pulse rounded-xl" style={{ height: 150, backgroundColor: 'var(--surface-3)' }} />
      </div>
    </div>
  )
}
