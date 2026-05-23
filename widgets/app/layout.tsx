export const metadata = {
  title: "Nisria",
  description: "Nisria giving widgets",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#1a1a1a",
          background: "transparent", // so it blends when embedded via iframe
        }}
      >
        {children}
      </body>
    </html>
  );
}
