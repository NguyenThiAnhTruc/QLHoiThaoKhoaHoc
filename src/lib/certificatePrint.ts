// Every database value placed into the print document is text, never markup.
export function escapeCertificateText(value: string | null | undefined): string {
  return (value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export interface CertificatePrintInput {
  name: string; organization?: string; title: string; paper?: string;
  type: 'attendance' | 'presentation'; start: string; end: string;
  issued: string; location?: string; number: string; seal?: string; verificationQr?: string; verificationUrl?: string;
}

export function certificateOrganization(value: string | null | undefined): string {
  const organization = (value ?? '').trim();
  return /(?:^|\s)demo(?:\s|$)/i.test(organization) ? '' : organization;
}

export function renderCertificate(input: CertificatePrintInput): string {
  const text = escapeCertificateText;
  const organization = certificateOrganization(input.organization);
  const seal = input.seal && /^data:image[/](png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.seal) ? input.seal : '/images/con-dau.png';
  const qr=input.verificationQr && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.verificationQr) ? input.verificationQr : "";
  const verification=input.verificationUrl && /^https?:\/\//.test(input.verificationUrl)?input.verificationUrl:"";
  const date = (value: string) => new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const certificateKind = input.type === 'attendance' ? 'XÁC NHẬN THAM DỰ HỘI THẢO' : 'XÁC NHẬN BÁO CÁO KHOA HỌC';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Chứng nhận ${text(input.number)}</title><style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; } html, body { width: 297mm; height: 210mm; margin: 0; padding: 0; overflow: hidden; background: #f4f7f2; font-family: Georgia, 'Times New Roman', serif; }
    .cert { width: 297mm; height: 210mm; padding: 14mm 17mm; position: relative; overflow: hidden; page-break-after: avoid; break-inside: avoid; background: #fff; color: #173f32; border: 1.5mm solid #173f32; }
    .cert:before { content: ''; position: absolute; inset: 5mm; border: .45mm solid #c9a13a; pointer-events: none; }
    .cert:after { content: ''; position: absolute; width: 105mm; height: 105mm; right: -55mm; top: -53mm; border-radius: 50%; background: #e7f0e5; box-shadow: -10mm 10mm 0 -7mm #fff, -10mm 10mm 0 -6.5mm #c9a13a; }
    .layout { position: relative; z-index: 1; display: grid; grid-template-columns: 55mm 1fr; height: 100%; }
    .side { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8mm 6mm; color: #fff; text-align: center; background: #173f32; border-radius: 3mm 0 0 3mm; }
    .side:before { content: ''; position: absolute; left: 10mm; top: 10mm; bottom: 10mm; width: 0; border-left: .35mm solid #c9a13a; }
    .monogram { display: grid; place-items: center; width: 28mm; height: 28mm; margin-bottom: 9mm; border: 1mm solid #d8b64e; border-radius: 50%; color: #d8b64e; font-size: 30px; font-weight: bold; }
    .side-title { font-size: 13px; font-weight: bold; line-height: 1.5; letter-spacing: 1px; text-transform: uppercase; }
    .side-rule { width: 22mm; margin: 6mm 0; border-top: .5mm solid #d8b64e; }
    .side-copy { color: #dce8dd; font-size: 11px; line-height: 1.5; }
    .main { display: flex; flex-direction: column; align-items: center; padding: 3mm 12mm 0; text-align: center; }
    .eyebrow { color: #ae8125; font-size: 12px; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; }
    h1 { margin: 3mm 0 1mm; color: #173f32; font-size: 43px; letter-spacing: 3px; } .rule { width: 42mm; margin: 0 auto 3mm; border-top: 1mm solid #c9a13a; }
    .kind { color: #477b5d; font-size: 15px; font-weight: bold; letter-spacing: 1.5px; }
    .intro { margin: 10mm 0 1mm; color: #63756a; font-size: 15px; } .name { margin: 1mm 0; color: #ae8125; font-size: 31px; font-weight: bold; }
    .organization { margin: 0 0 3mm; color: #477b5d; font-size: 17px; font-style: italic; }
    .statement { max-width: 190mm; margin: 2mm 0; color: #365447; font-size: 16px; } .title { max-width: 190mm; margin: 2mm 0 3mm; color: #173f32; font-size: 20px; font-weight: bold; line-height: 1.25; }
    .details { display: flex; justify-content: center; gap: 15mm; margin-top: 3mm; color: #63756a; font-size: 13px; } .details span { display: block; margin-top: 1mm; color: #173f32; font-weight: bold; }
    .certificate-footer { position: absolute; z-index: 2; left: 83mm; right: 17mm; bottom: 12mm; display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: end; gap: 6mm; text-align: center; }
    .footer-label { display: block; margin-bottom: 2mm; color: #63756a; font-size: 11px; } .number { color: #173f32; font-size: 11px; } .qr { width: 16mm; height: 16mm; object-fit: contain; } .verify { display: block; color: #477b5d; font-size: 10px; }
    .issuer { color: #173f32; font-size: 12px; line-height: 1.4; } .issuer-title { display: block; color: #63756a; font-size: 10px; } .signature-line { display: block; width: 38mm; margin: 7mm auto 1mm; border-bottom: .3mm solid #173f32; } .seal { width: 18mm; height: 18mm; object-fit: contain; margin-top: 1mm; }
    @media print { html, body { width: 297mm; height: 210mm; max-height: 210mm; overflow: hidden !important; background: #fff; } .cert { width: 297mm; height: 210mm; padding: 14mm 17mm; print-color-adjust: exact; -webkit-print-color-adjust: exact; } h1 { font-size: 38px; } .name { font-size: 28px; } .title { font-size: 18px; } img { max-width: 100%; page-break-inside: avoid; } }
  </style></head><body><article class="cert"><div class="layout"><aside class="side"><div class="monogram">C</div><div class="side-title">Ban tổ chức<br>hội thảo khoa học</div><div class="side-rule"></div><div class="side-copy">Chứng nhận chính thức<br>của hệ thống ConfManager</div></aside><main class="main">
  <div class="eyebrow">Trân trọng ghi nhận</div><h1>CHỨNG NHẬN</h1><div class="rule"></div><div class="kind">${certificateKind}</div>
  <div class="intro">Trân trọng xác nhận và ghi nhận đóng góp của</div><div class="name">${text(input.name)}</div>
  ${organization ? `<div class="organization">${text(organization)}</div>` : ''}
  <div class="statement">${input.type === 'attendance' ? 'đã tham dự và hoàn thành chương trình của' : 'đã có bài báo được chấp nhận và trình bày tại'}</div><div class="title">${text(input.title)}</div>
  ${input.paper ? `<div class="statement">Bài báo: <strong>${text(input.paper)}</strong></div>` : ''}
  <div class="details"><div>Thời gian<span>${date(input.start)} – ${date(input.end)}</span></div>${input.location ? `<div>Địa điểm<span>${text(input.location)}</span></div>` : ''}</div>
  </main></div><div class="certificate-footer"><div><span class="footer-label">Mã chứng nhận</span><div class="number">${text(input.number)}</div>${qr ? `<img class="qr" src="${text(qr)}" alt="QR tra cứu chứng nhận">` : ''}${verification ? `<a class="verify" href="${text(verification)}">Tra cứu hiệu lực</a>` : '<span class="verify">Đối chiếu với ban tổ chức</span>'}</div><div class="issuer"><span class="footer-label">Đại diện ban tổ chức</span><span class="issuer-title">Chữ ký và xác nhận</span><span class="signature-line"></span><img class="seal" src="${text(seal)}" alt="Con dấu" onerror="this.style.display='none'"><div>Ngày cấp: ${date(input.issued)}</div></div><div><span class="footer-label">Giá trị xác nhận</span><strong>Học thuật · Chính thức</strong><p class="number">Bản ghi được lưu trên hệ thống</p></div></div></article></body></html>`;
}
