import "./globals.css";
import { Inter } from "next/font/google";
import AppFrame from "../components/AppFrame";

// Inter loaded via next/font (self-hosted, no render-blocking CSS @import). The
// CSS var feeds globals.css's --font-display / --font-body fallback chains, so
// the exact same visual font loads, just without the blocking network request.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata = {
  title: "Nisria Command Center",
  description: "Nisria's master operations platform",
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Set the money-hide class BEFORE first paint so the privacy blur never
            flashes the real numbers on navigation (fixes the MoneyToggle FOUC). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('nis.hideMoney')==='1'){document.documentElement.classList.add('hide-money')}}catch(e){}`,
          }}
        />
      </head>
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
