// Generated DB types live here once we run `npx supabase gen types typescript`.
// For now we use a permissive placeholder so the rest of the codebase can compile
// before the Supabase project is wired up.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = any;
