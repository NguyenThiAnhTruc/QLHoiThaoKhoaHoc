function xml(value: string | number) {
  return Array.from(String(value)).filter(character => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || code >= 0x10000;
  }).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Excel's XML workbook format. Explicit cell types keep user text from being
// interpreted as formulas, including titles starting with '='.
export function excelXml(headers: string[], rows: (string | number)[][]) {
  const row = (values: (string | number)[], header = false) => `<Row>${values.map(value => `<Cell${header ? ' ss:StyleID="Header"' : ''}><Data ss:Type="${typeof value === 'number' ? 'Number' : 'String'}">${xml(value)}</Data></Cell>`).join('')}</Row>`;
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E2F2EE" ss:Pattern="Solid"/></Style></Styles><Worksheet ss:Name="Danh sách"><Table>${headers.map(() => '<Column ss:Width="160"/>').join('')}${row(headers, true)}${rows.map(values => row(values)).join('')}</Table></Worksheet></Workbook>`;
}

export function exportExcel(filename: string, headers: string[], rows: (string | number)[][]) {
  const url = URL.createObjectURL(new Blob([excelXml(headers, rows)], { type: 'application/xml;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${filename}.xml`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
