import { columnName } from "./office/sheet-cells";

const ROWS = Array.from({ length: 200 }, (_, row) => row);
const COLUMNS = Array.from({ length: 52 }, (_, column) => column);

export function PaperSheet(props: {
  rows: readonly (readonly string[])[];
  onCellEdit: (row: number, column: number, value: string) => void;
}) {
  const rowCount = Math.max(props.rows.length + 20, 40);
  const columnCount = Math.max(...props.rows.map((row) => row.length), 0) + 6;
  const rows = ROWS.slice(0, Math.min(rowCount, ROWS.length));
  const columns = COLUMNS.slice(0, Math.min(Math.max(columnCount, 12), COLUMNS.length));
  const width = (column: number) =>
    `max(7rem, ${Math.min(40, Math.max(0, ...props.rows.map((row) => row[column]?.length ?? 0)) + 3)}ch)`;
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-paper font-office text-sm text-paper-ink [color-scheme:light]">
      <table className="border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 h-6 w-12 min-w-12 border-r border-b border-sheet-edge bg-sheet-header" />
            {columns.map((column) => (
              <th
                key={column}
                style={{ minWidth: width(column) }}
                className="sticky top-0 z-10 h-6 border-r border-b border-sheet-line bg-sheet-header text-center text-xs font-normal text-sheet-label"
              >
                {columnName(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th className="sticky left-0 z-10 h-6 border-r border-b border-sheet-line bg-sheet-header px-2 text-right text-xs font-normal tabular-nums text-sheet-label">
                {row + 1}
              </th>
              {columns.map((column) => (
                <td key={column} className="h-6 border-r border-b border-sheet-grid p-0">
                  <input
                    aria-label={`${columnName(column)}${row + 1}`}
                    value={props.rows[row]?.[column] ?? ""}
                    onChange={(event) => props.onCellEdit(row, column, event.target.value)}
                    className="block h-6 w-full bg-transparent px-1.5 outline-none focus:relative focus:z-1 focus:ring-2 focus:ring-inset focus:ring-sheet-accent"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
