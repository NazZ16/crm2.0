'use client'

import dynamic from 'next/dynamic'
import type { AnalyticsChartsData } from './AnalyticsCharts'

const AnalyticsCharts = dynamic(() => import('./AnalyticsCharts'), { ssr: false })

export default function ChartsLoader(props: AnalyticsChartsData) {
  return <AnalyticsCharts {...props} />
}
