import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://draft-timer-jp.numbergirlsyndromed.chatgpt.site'),
  title: 'Draft Timer',
  description: 'カードドラフトの進行を音声で案内する、ブラウザ対応タイマー。',
  applicationName: 'Draft Timer',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Draft Timer',
  },
  openGraph: {
    type: 'website',
    title: 'Draft Timer',
    description: 'ドラフト進行を、もっとスムーズに。',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'Draft Timer — ドラフト進行を、もっとスムーズに。' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Draft Timer',
    description: 'ドラフト進行を、もっとスムーズに。',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#173a52',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
