// Pure types — no server imports.

export interface ListRow {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
  shared: boolean;
}
