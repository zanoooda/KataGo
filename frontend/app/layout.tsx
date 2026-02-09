import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'KataGo Live Review',
  description: 'Realtime KataGo analysis with move history and variation tree',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
