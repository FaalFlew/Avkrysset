// src/components/analytics/types.ts — shared prop types of the analytics components.

/** A column of a ChartDataTable. The first column is rendered as the row header. */
export interface DataTableColumn {
  key: string;
  label: string;
  align?: "start" | "end";
}

/** A row of a ChartDataTable: display strings keyed by column key. */
export interface DataTableRow {
  id: string;
  cells: Record<string, string>;
}
