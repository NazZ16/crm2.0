import { z } from 'zod'

export const listingSchema = z.object({
  reference: z.string().max(100).optional().nullable(),
  title: z.string().min(1).max(300),
  business_type: z.enum(['venda', 'arrendamento']).default('venda'),
  property_type: z.enum(['apartamento','moradia','terreno','comercial','garagem','outro',
  'quinta','loja','armazem','escritorio','predio','prédio','armazém']).default('apartamento'),
  typology: z.string().max(20).optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  condo_fee: z.number().nonnegative().optional().nullable(),
  imi_annual: z.number().nonnegative().optional().nullable(),

  district: z.string().max(150).optional().nullable(),
  municipality: z.string().max(150).optional().nullable(),
  parish: z.string().max(150).optional().nullable(),
  zone: z.string().max(150).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  zip_code: z.string().max(20).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),

  area_useful_m2: z.number().nonnegative().optional().nullable(),
  area_gross_m2: z.number().nonnegative().optional().nullable(),
  area_plot_m2: z.number().nonnegative().optional().nullable(),
  bedrooms: z.number().int().min(0).optional().nullable(),
  bathrooms: z.number().int().min(0).optional().nullable(),
  total_rooms: z.number().int().min(0).optional().nullable(),
  parking_spaces: z.number().int().min(0).optional().nullable(),
  has_elevator: z.boolean().optional().nullable(),
  construction_year: z.number().int().min(1800).max(2100).optional().nullable(),
  energy_rating: z.string().max(10).optional().nullable(),

  features: z.array(z.string().max(100)).max(100).default([]),
  description: z.string().max(10000).optional().nullable(),
  cover_image_url: z.string().url().max(2000).optional().nullable(),
  photos: z.array(z.string().url().max(2000)).max(50).default([]),

  source: z.string().max(100).optional(),
  source_url: z.string().url().max(2000).optional().nullable(),
  status: z.enum(['active', 'reserved', 'sold', 'withdrawn']).default('active'),
  is_published: z.boolean().optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),

  agent_name: z.string().max(200).optional().nullable(),
  agent_phone: z.string().max(50).optional().nullable(),
  agent_email: z.string().email().max(200).optional().nullable(),

  days_on_market: z.number().int().min(0).optional().nullable(),
  visit_count: z.number().int().min(0).optional().nullable(),
  proposal_count: z.number().int().min(0).optional().nullable(),
})
