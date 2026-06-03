import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Radar Estatal',
  description: 'Monitoreo de compras y licitaciones del Estado uruguayo',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={inter.className}>
        <nav className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-700">Radar</span>
              <span className="text-xl font-bold text-gray-800">Estatal</span>
            </div>
            <span className="text-sm text-gray-500">Uruguay · compras.gub.uy</span>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  )
}
