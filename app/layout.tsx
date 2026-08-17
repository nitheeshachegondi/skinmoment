import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SkinMoment — AI skin check for right now',
  description:
    'A YouCam Skin AI powered snapshot that meets you at the moment of doubt: before a purchase, after a breakout, in front of the mirror.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-blush text-ink font-body min-h-screen">{children}</body>
    </html>
  );
}
