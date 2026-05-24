import "./globals.css";
import AppFrame from "../components/AppFrame";

export const metadata = {
  title: "Nisria Command Center",
  description: "Nisria's master operations platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
