// Microsoft Clarity (heatmaps + session recordings), scoped to the
// client portal surface ONLY. Mounted from app/portal/[token]/layout.tsx.
// Do NOT lift this into app/layout.tsx or anywhere under the (app)
// group — MasterInbox is the staff tool and must stay un-tracked.
//
// `id` is a public Clarity site ID (visible in any DevTools network
// panel); hardcoded to match Microsoft's quickstart snippet verbatim.

import Script from "next/script";

export function ClarityScript() {
  return (
    <Script id="ms-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, "clarity", "script", "x9krip9fz1");`}
    </Script>
  );
}
