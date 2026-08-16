export default function NotificationsLoading() {
  return (
    <div className="max-w-3xl mx-auto py-6 px-4" aria-live="polite">
      <div className="flex items-center gap-2" style={{ color: 'var(--ink-3)', fontSize: 13 }}>
        <span
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#d9ccef] border-t-[var(--brand)]"
          aria-hidden
        />
        Загружаем уведомления…
      </div>
    </div>
  )
}
