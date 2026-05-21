"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      // The app is light-only — there is no theme toggle anywhere in the
      // UI. forcedTheme pins it to light and makes next-themes ignore any
      // stale `theme` value left in a browser's localStorage (which is
      // what turned the local dev site fully dark).
      forcedTheme="light"
      disableTransitionOnChange
    >
      <QueryClientProvider client={client}>
        <TooltipProvider delay={120}>{children}</TooltipProvider>
        <Toaster richColors closeButton position="bottom-right" />
        {process.env.NODE_ENV === "development" ? (
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        ) : null}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
