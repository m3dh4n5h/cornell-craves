/**
 * Shared CSV cell encoding for every export the club can download.
 *
 * Lives on its own because more than one page writes a sheet full of
 * buyer-controlled text, and each one growing its own escape function is how a
 * gap opens up in the one that matters.
 */
export function csvEscape(value: string): string {
  // Defuse spreadsheet formula injection before quoting. Excel/Sheets execute a
  // cell whose text begins with = + - @ or a tab/CR, and buyer-controlled fields
  // (name, email, NetID, payment handle, item names, dietary notes) land in
  // these sheets. A buyer named `=HYPERLINK("http://evil","click")` would
  // otherwise run on open, so prefix a single quote to any value that starts
  // with a formula trigger.
  const defused = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(defused) ? `"${defused.replaceAll('"', '""')}"` : defused;
}
