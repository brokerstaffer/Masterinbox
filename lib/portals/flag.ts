// Master switch for the Client Portals feature.
//
// While false, every portal route renders a "Coming soon" placeholder and
// — critically — returns BEFORE any query that touches the portal_token /
// portal_enabled columns. That lets the whole feature ship dark: the code
// is deployed but inert, and migration 0016 doesn't need to run on
// production yet. Flip to true (and run 0016) to go live.
export const CLIENT_PORTALS_ENABLED = false;
