import type { Metadata, Viewport } from 'next';
import './globals.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const defaultSiteUrl = `https://tcg-utility.github.io${basePath || '/DraftTimer-Web'}`;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? defaultSiteUrl;

export const metadata: Metadata = {
  metadataBase: new URL(new URL(siteUrl).origin),
  title: 'Draft Timer',
  description: 'カードドラフトの進行を音声で案内する、ブラウザ対応タイマー。',
  applicationName: 'Draft Timer',
  manifest: `${basePath}/manifest.webmanifest`,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Draft Timer',
  },
  openGraph: {
    type: 'website',
    title: 'Draft Timer',
    description: 'ドラフト進行を、もっとスムーズに。',
    images: [{ url: `${basePath}/og.png`, width: 1731, height: 909, alt: 'Draft Timer — ドラフト進行を、もっとスムーズに。' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Draft Timer',
    description: 'ドラフト進行を、もっとスムーズに。',
    images: [`${basePath}/og.png`],
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
