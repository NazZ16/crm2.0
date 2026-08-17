import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de Privacidade — CRM Imobiliário 2.0',
}

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-16 text-gray-800 leading-relaxed">
      <h1 className="text-2xl font-bold mb-2">Política de Privacidade</h1>
      <p className="text-sm text-gray-500 mb-8">Última atualização: agosto de 2026</p>

      <p className="mb-6">
        Este CRM (&ldquo;o Sistema&rdquo;) é uma ferramenta de uso profissional interno de Élsio Mota,
        consultor imobiliário RE/MAX, para gerir leads, contactos e interações com clientes.
        Não é um produto vendido ou disponibilizado a terceiros.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Que dados são recolhidos</h2>
      <p className="mb-4">
        Nome, número de telefone, email e conteúdo de conversas (chamadas, mensagens de WhatsApp,
        email) de pessoas que contactam ou são contactadas no âmbito da atividade imobiliária,
        recolhidos diretamente através dessas interações.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Para que são usados</h2>
      <p className="mb-4">
        Exclusivamente para gestão da carteira de clientes e leads imobiliárias — registo de
        contactos, histórico de conversas e apoio à qualificação de leads. Não são usados para
        publicidade nem vendidos a terceiros.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Com quem são partilhados</h2>
      <p className="mb-4">
        Os dados são armazenados na infraestrutura da Supabase (base de dados) e, quando aplicável,
        processados por serviços de IA (Anthropic Claude, OpenAI Whisper) para transcrição e análise
        de conversas — apenas como subprocessadores técnicos, nunca para fins de publicidade ou
        partilhados com outras empresas. Mensagens de WhatsApp são recebidas via WhatsApp Business
        Platform (Meta) exclusivamente para atualizar este CRM.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Direitos do titular dos dados</h2>
      <p className="mb-4">
        Qualquer pessoa cujos dados constem neste sistema pode pedir acesso, retificação ou remoção
        dos seus dados a qualquer momento, através do contacto abaixo.
      </p>

      <h2 className="text-lg font-semibold mt-8 mb-2">Contacto</h2>
      <p>
        <a href="mailto:elsiomota@live.com.pt" className="text-blue-600 hover:underline">
          elsiomota@live.com.pt
        </a>
      </p>
    </main>
  )
}
