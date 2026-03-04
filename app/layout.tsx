import type { Metadata, Viewport } from "next";
import "./globals.css";
import PageTransition from "./components/PageTransition";

export const metadata: Metadata = {
  metadataBase: new URL("https://believablebelief.com"),
  title: "Believable Belief",
  description: "Writer. Painter. Believer.",
  openGraph: {
    type:        "website",
    siteName:    "Believable Belief",
    title:       "Believable Belief",
    description: "Writer. Painter. Believer.",
    url:         "https://believablebelief.com",
  },
  twitter: {
    card:        "summary",
    title:       "Believable Belief",
    description: "Writer. Painter. Believer.",
  },
};

export const viewport: Viewport = {
  width:       "device-width",
  initialScale: 1,
  viewportFit: "cover", // enables safe-area-inset-* for notch/home-bar
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
