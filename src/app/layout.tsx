import type { Metadata, Viewport } from "next";
import PwaRegistration from "@/components/pwa-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nelcy Corporate Group | Financial Control",
  description: "Control financiero de empresas, movimientos internos y ámbito personal",
  applicationName: "Nelcy Finance",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Nelcy Finance" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, themeColor: "#0b1425",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><PwaRegistration />{children}</body></html>;
}
