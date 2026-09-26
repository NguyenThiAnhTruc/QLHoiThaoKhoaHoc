// Every database value placed into the print document is text, never markup.
export function escapeCertificateText(value: string | null | undefined): string {
  return (value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
