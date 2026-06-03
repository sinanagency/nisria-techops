import "./globals.css";
import { Inter, Space_Grotesk } from "next/font/google";
import AppFrame from "../components/AppFrame";
import ClockProbe from "../components/ClockProbe";
import { getCurrentUser } from "../lib/auth";

// Inter loaded via next/font (self-hosted, no render-blocking CSS @import). The
// CSS var feeds globals.css's --font-display / --font-body fallback chains, so
// the exact same visual font loads, just without the blocking network request.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

// Redesign v2: Space Grotesk for display numbers / headings (the .disp2 class in
// globals.css). Self-hosted via next/font, additive, never replaces Inter.
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-grotesk",
});

export const metadata = {
  title: "Nisria Command Center",
  description: "Nisria's master operations platform",
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser();
  const navUser = user
    ? { name: user.name, org: user.org, initials: user.initials, role: user.role }
    : null;
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
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
        {/* Feeds lib/now the viewer's real timezone (persists nis.tz cookie). */}
        <ClockProbe />
        <AppFrame user={navUser}>{children}</AppFrame>
      </body>
    </html>
  );
}
