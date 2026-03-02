'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import Link from 'next/link'

export default function RegisterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [fullName, setFullName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('A password deve ter pelo menos 8 caracteres')
      return
    }
    setLoading(true)

    const supabase = createClient()
    const resolvedTeamName = teamName.trim() || `Equipa de ${fullName}`

    // Guardar team_name nos metadados — o callback usa-os para criar a equipa
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? location.origin
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, team_name: resolvedTeamName },
        emailRedirectTo: `${siteUrl}/api/auth/callback`,
      },
    })

    if (error) {
      toast.error(error.message)
      setLoading(false)
      return
    }

    // Se a sessão foi criada imediatamente (confirmação de email desativada)
    if (data.session) {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_name: resolvedTeamName }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Erro ao criar equipa')
        setLoading(false)
        return
      }

      toast.success('Conta criada!')
      router.push('/dashboard')
      router.refresh()
      return
    }

    // Email de confirmação enviado — mostrar mensagem ao utilizador
    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="text-3xl font-bold text-gray-900">🏠 CRM 2.0</div>
          <Card>
            <CardContent className="pt-6 pb-6 space-y-3">
              <div className="text-4xl">📧</div>
              <h2 className="text-lg font-semibold text-gray-900">Verifica o teu email</h2>
              <p className="text-sm text-gray-500">
                Enviámos um link de confirmação para <strong>{email}</strong>.
                Clica no link para ativar a conta e aceder ao CRM.
              </p>
              <p className="text-xs text-gray-400">
                Não vês o email? Verifica a pasta de spam.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="text-3xl font-bold text-gray-900">🏠 CRM 2.0</div>
          <p className="mt-1 text-sm text-gray-500">CRM Imobiliário Inteligente</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Criar conta</CardTitle>
            <CardDescription>Começa a usar o CRM gratuitamente</CardDescription>
          </CardHeader>
          <form onSubmit={handleRegister}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">O teu nome</Label>
                <Input
                  id="fullName"
                  placeholder="João Silva"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="teamName">Nome da agência / equipa</Label>
                <Input
                  id="teamName"
                  placeholder="Imobiliária Silva & Associados"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="o.teu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-3">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'A criar conta...' : 'Criar conta'}
              </Button>
              <p className="text-sm text-gray-500 text-center">
                Já tens conta?{' '}
                <Link href="/login" className="text-blue-600 hover:underline font-medium">
                  Entra aqui
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  )
}
