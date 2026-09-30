import type { Metadata } from "next";
import { Geist_Mono, Roboto } from "next/font/google";
import "./globals.css";
import { AppShell } from "./app-shell";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mapeig cartera de serveis.",
  description:
    "Prototip per validar el mapeig de finançament de la Cartera de Serveis Socials.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ca"
      className={`${roboto.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AppShell>{process.env.LOCAL_REMOTE_PREVIEW==="true"&&<p role="status" className="mx-4 mt-4 rounded border p-3 text-sm">Dades de producció · Aplicació local. Processament automàtic desactivat.{process.env.LOCAL_REMOTE_LEGACY_SCHEMA==="true"?" Desglossament de concerts i selecció anual pendents d’activació.":""}</p>}{children}</AppShell>
      </body>
    </html>
  );
}
