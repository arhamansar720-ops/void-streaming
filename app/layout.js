import { Bebas_Neue, Fraunces, DM_Mono } from "next/font/google";
import "./globals.css";

const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const fraunces = Fraunces({ subsets: ["latin"], style: ["normal", "italic"], weight: ["300", "500"], variable: "--font-serif" });
const dmMono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], style: ["normal", "italic"], variable: "--font-mono" });

export const metadata = {
  title: "VOID — media intelligence",
  description: "You don't browse. You ask.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${bebas.variable} ${fraunces.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
