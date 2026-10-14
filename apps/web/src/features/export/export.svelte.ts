// The export dialog's open state: any screen (studio, party, File → Export…) opens it; the app shell renders it.
class ExportDialogState {
  open = $state(false);
}
export const exporting = new ExportDialogState();
export function exportDialog(): void {
  exporting.open = true;
}
