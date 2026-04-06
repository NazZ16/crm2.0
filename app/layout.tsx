import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { PwaRegister } from '@/components/PwaRegister'

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
})

export const viewport: Viewport = {
  themeColor: '#1a56db',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  title: 'CRM Imobiliário 2.0',
  description: 'CRM inteligente para consultores imobiliários',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CRM 2.0',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${geist.variable} antialiased`} suppressHydrationWarning>
        <PwaRegister />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
