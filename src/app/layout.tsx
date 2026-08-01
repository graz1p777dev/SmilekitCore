import type { Metadata } from 'next'
import { Manrope, Unbounded } from 'next/font/google'
import { cookies } from 'next/headers'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { getImpersonationState } from '@/actions/auth'
import { createClient } from '@/lib/supabase/server'
import { Toaster } from 'sonner'
import { Employee } from '@/types'
import { DEFAULT_ACCENT, ACCENT_COOKIE_NAME, isAccentId } from '@/lib/accent-theme'

// Текст — Manrope, как на витрине Smilekit (--font-body).
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-sans',
})

// Заголовки и логотип — Unbounded (--font-logo с витрины). Геометрический
// гротеск широкий, поэтому берём только светлые начертания: в плотных
// таблицах жирный Unbounded «забивает» данные.
const unbounded = Unbounded({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-display',
})

const fontVars = `${manrope.variable} ${unbounded.variable}`

export const metadata: Metadata = {
  title: 'Smilekit CRM',
  description: 'Система управления бизнесом',
}

// Root layout — читает сессию и employee один раз на SSR.
// Передаёт данные в AuthProvider как начальное состояние:
// клиент стартует с уже известным пользователем, без race condition onAuthStateChange.
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const jar = await cookies()
  const accentCookie = jar.get(ACCENT_COOKIE_NAME)?.value
  const accent = isAccentId(accentCookie) ? accentCookie : DEFAULT_ACCENT

  const supabase = await createClient()

  // Параллельно получаем сессию и состояние impersonation.
  const [{ data: { session } }, initialImpersonation] = await Promise.all([
    supabase.auth.getSession(),
    getImpersonationState(),
  ])

  let initialEmployee: Employee | null = null
  let initialRealUser: Employee | null = null

  if (session?.user) {
    const { data: emp } = await supabase
      .from('employees')
      .select('*')
      .eq('user_id', session.user.id)
      .is('deleted_at', null)
      .single()

    if (emp) {
      const employee = emp as Employee

      if (employee.role === 'owner' && initialImpersonation) {
        // Режим impersonation: realUser = owner, user = цель impersonation.
        const { data: targetEmp } = await supabase
          .from('employees')
          .select('*')
          .eq('id', initialImpersonation.id)
          .is('deleted_at', null)
          .single()

        initialRealUser = employee
        initialEmployee = (targetEmp as Employee | null) ?? employee
      } else {
        initialEmployee = employee
      }
    }
  }

  return (
    <html lang="ru" className={`h-full ${fontVars}`} data-accent={accent}>
      <body className={`${manrope.className} min-h-full bg-background`}>
        <AuthProvider
          initialEmployee={initialEmployee}
          initialRealUser={initialRealUser}
          initialImpersonation={initialImpersonation}
        >
          {children}
        </AuthProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#ffffff',
              border: '1px solid #ece5e5',
              color: '#1b1517',
              borderRadius: '12px',
              boxShadow: '0 12px 32px -14px rgba(28,20,22,0.24)',
            },
          }}
        />
      </body>
    </html>
  )
}
