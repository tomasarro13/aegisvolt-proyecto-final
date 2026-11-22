import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AegisVolt — Gestión de carga para flotas eléctricas',
  description: 'Reserva de bahías, cobro distribuido (SAGA) y telemetría en tiempo real por ambiente.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
