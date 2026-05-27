import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BrokerStaffer Master Inbox",
  description: "Unified sales inbox for cold outreach email replies.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // suppressHydrationWarning on <html>: next-themes mutates the html
  // class + color-scheme before React hydrates — required by next-themes
  // so that mutation doesn't trip a hydration mismatch.
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Inline link reset — guarantees the rule is present in the
            initial HTML even if a CSS chunk loads late or fails. We
            were seeing intermittent "everything blue and underlined"
            reports where the @layer base rule wasn't winning the
            cascade in production. Belt-and-braces over the rule in
            globals.css. */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              "a,a:link,a:visited{color:inherit;text-decoration:inherit;}",
          }}
        />
      </head>
      <body className="bg-background text-foreground min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
