// Every database value placed into the print document is text, never markup.
export function escapeCertificateText(value: string | null | undefined): string {
  return (value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export interface CertificatePrintInput {
  name: string; organization?: string; title: string; paper?: string;
  type: 'attendance' | 'presentation'; start: string; end: string;
  issued: string; location?: string; number: string; minutes?: number; seal?: string; verificationQr?: string; verificationUrl?: string;
}

export function renderCertificate(input: CertificatePrintInput): string {
  const text = escapeCertificateText;
  const seal = input.seal && /^data:image[/](png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.seal) ? input.seal : '/images/con-dau.png';
  const qr=input.verificationQr && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.verificationQr) ? input.verificationQr : "";
  const verification=input.verificationUrl && /^https?:\/\//.test(input.verificationUrl)?input.verificationUrl:"";
  const date = (value: string) => new Date(value).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Chứng nhận ${text(input.number)}</title><style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; } body { margin: 0; background: #eee; font-family: 'Times New Roman', serif; }
    .cert { width: 297mm; min-height: 210mm; padding: 17mm 20mm; margin: auto; text-align: center; position: relative; background: #fffcf5; color: #790c0c; border-top: 9mm solid #790c0c; border-bottom: 9mm solid #790c0c; box-shadow: inset 0 3px #d6a431, inset 0 -3px #d6a431; overflow-wrap: anywhere; }
    .organizer { letter-spacing: 2px; font-size: 15px; color: #173f60; }
    h1 { font-size: 43px; margin: 10mm 0 5mm; } .kind { font-size: 18px; letter-spacing: 2px; }
    .name { font-size: 34px; color: #bd8516; margin: 5mm 0 2mm; font-weight: bold; }
    .organization { font-size: 23px; color: #173f60; margin: 0 0 5mm; }
    .title { font-size: 25px; font-weight: bold; margin: 3mm 0; } p { font-size: 18px; margin: 3mm 0; }
    .paper { font-size: 18px; color: #173f60; } footer { display: flex; justify-content: space-between; align-items: end; gap: 10mm; margin-top: 8mm; }
    .number { text-align: left; font-size: 13px; color: #173f60; } .issuer { font-size: 17px; line-height: 1.6; }
    .seal { display: block; width: 28mm; height: 28mm; object-fit: contain; margin: 2mm auto 0; }
    @media print {
      body { background: white; }
      .cert { min-height: 209mm; padding: 8mm 15mm; border-top-width: 6mm; border-bottom-width: 6mm; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      h1 { font-size: 36px; margin: 5mm 0 3mm; }
      .name { font-size: 28px; margin: 3mm 0 2mm; }
      .organization { font-size: 20px; margin-bottom: 3mm; }
      p { font-size: 16px; margin: 2mm 0; }
      .title { font-size: 21px; margin: 2mm 0; }
      footer { margin-top: 5mm; } .issuer { font-size: 15px; } .seal { width: 22mm; height: 22mm; }
    }
  </style></head><body><article class="cert"><div class="organizer">BAN TỔ CHỨC HỘI THẢO</div><h1>GIẤY CHỨNG NHẬN</h1>
  <div class="kind">${input.type === 'attendance' ? 'THAM DỰ HỘI THẢO' : 'BÁO CÁO KHOA HỌC'}</div><p>Chứng nhận:</p><div class="name">${text(input.name)}</div>
  ${input.organization ? `<div class="organization">${text(input.organization)}</div>` : ''}
  <p>${input.type === 'attendance' ? 'Đã tham dự hội thảo' : 'Là tác giả của báo cáo được chấp nhận tại hội thảo'}</p><div class="title">${text(input.title)}</div>
  ${input.paper ? `<p class="paper">Đề tài: ${text(input.paper)}</p>` : ''}
  <p>Thời gian: ${date(input.start)} – ${date(input.end)}</p>${input.location ? `<p>Địa điểm: ${text(input.location)}</p>` : ''}
  ${(input.minutes ?? 0) > 0 ? `<p>Thời lượng đã xác nhận: ${Math.floor(input.minutes!)} phút</p>` : ''}
  <footer><div class="number">Số chứng nhận: ${text(input.number)}<br>${qr ? `<br><img src="${text(qr)}" alt="QR tra cứu chứng nhận" style="width:18mm;height:18mm"><br>` : "<br>"}${verification ? `<a href="${text(verification)}">Quét QR để tra cứu hiệu lực</a>` : "Đối chiếu với ban tổ chức"}</div><div class="issuer">Ngày cấp: ${date(input.issued)}<br><strong>BAN TỔ CHỨC HỘI THẢO</strong><img class="seal" src="${text(seal)}" alt="Con dấu" onerror="this.style.display='none'"></div></footer></article></body></html>`;
}
