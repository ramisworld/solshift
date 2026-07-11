import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestHost = forwardedHost ?? requestHeaders.get("host") ?? "solshift.game";
  const host = /^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(requestHost)
    ? requestHost
    : "solshift.game";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";
  const origin = `${protocol}://${host}`;
  const socialImage = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: "SOL//SHIFT — Survive the laws of physics",
      template: "%s — SOL//SHIFT",
    },
    description:
      "Pull matter into orbit, release a Nova, bank Flux, and survive six mutating laws in 60 seconds.",
    applicationName: "SOL//SHIFT",
    category: "game",
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
    openGraph: {
      title: "SOL//SHIFT",
      description: "Pull matter into orbit, release a Nova, bank Flux, and survive six mutating laws in 60 seconds.",
      type: "website",
      url: origin,
      images: [{ url: socialImage, width: 1_200, height: 630, alt: "SOL//SHIFT — Six laws. Sixty seconds." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "SOL//SHIFT",
      description: "Pull matter into orbit, release a Nova, bank Flux, and survive six mutating laws in 60 seconds.",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#05070b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
