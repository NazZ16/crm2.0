import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 512,
          height: 512,
          background: '#1a56db',
          borderRadius: 96,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: 'white',
            fontSize: 180,
            fontWeight: 800,
            fontFamily: 'sans-serif',
            letterSpacing: '-4px',
          }}
        >
          CRM
        </span>
      </div>
    ),
    { ...size }
  )
}
