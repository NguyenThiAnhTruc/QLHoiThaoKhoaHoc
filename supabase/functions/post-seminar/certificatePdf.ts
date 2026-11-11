import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

export interface CertificateInput {
  name: string; organization: string; title: string; location: string;
  number: string; start: string; end: string; issued: string; minutes: number;
}

function certificateOrganization(value: string | null | undefined): string {
  const organization = (value ?? "").trim();
  return /(?:^|\s)demo(?:\s|$)/i.test(organization) ? "" : organization;
}

export async function createCertificatePdf(input: CertificateInput, fontBytes: Uint8Array, sealBytes?: Uint8Array) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(fontBytes, { subset: true });
  const page = document.addPage([842,595]);
  page.drawRectangle({x:0,y:0,width:842,height:595,color:rgb(1,1,1)});
  page.drawRectangle({x:0,y:570,width:842,height:25,color:rgb(0.47,0.04,0.04)});
  page.drawRectangle({x:0,y:0,width:842,height:25,color:rgb(0.47,0.04,0.04)});
  page.drawRectangle({x:24,y:24,width:794,height:547,borderWidth:3,borderColor:rgb(0.83,0.64,0.19)});
  const lines:{text:string;size:number;gap:number}[]=[];
  function line(value:string,size=16,gap=28) {
    const clean=Array.from(value ?? "",char=>char.charCodeAt(0)<32 ? " ":char).join("").trim();
    const words=clean.split(/\s+/);const rows:string[]=[];let row="";
    for(const word of words){
      if(row && font.widthOfTextAtSize(`${row} ${word}`,size)>730){rows.push(row);row=word;}else row=row?`${row} ${word}`:word;
    }
    rows.push(row);
    for(const text of rows){
      const adjusted=Math.min(size,730/Math.max(1,font.widthOfTextAtSize(text,1)));
      lines.push({text,size:adjusted,gap});
    }
  }
  function date(value:string){return new Date(value).toLocaleDateString("vi-VN",{timeZone:"Asia/Ho_Chi_Minh"});}
  line("BAN TỔ CHỨC HỘI THẢO",14,28);
  line("GIẤY CHỨNG NHẬN",34,42);
  line("BÁO CÁO KHOA HỌC",20,42);
  line("Chứng nhận:",14,30);
  line(input.name,25,36);
  const organization = certificateOrganization(input.organization);
  if(organization)line(`Đơn vị công tác: ${organization}`,14,28);
  line("Đã trình bày báo cáo tại hội thảo",14,28);
  line(input.title,19,28);
  line(`Thời gian: ${date(input.start)} – ${date(input.end)}`,13,24);
  if(input.location)line(`Địa điểm: ${input.location}`,13,24);
  if(input.minutes>0)line(`Thời lượng đã xác nhận: ${input.minutes} phút (${(input.minutes/60).toLocaleString("vi-VN",{maximumFractionDigits:2})} giờ)`,13,24);
  line(`Ngày cấp: ${date(input.issued)}`,12,24);
  const scale=Math.min(1,(sealBytes ? 440 : 500)/lines.reduce((sum,line)=>sum+line.gap,0));
  let y=520;
  for(const line of lines){const size=line.size*scale;page.drawText(line.text,{x:(842-font.widthOfTextAtSize(line.text,size))/2,y,size,font,color:line.text===input.name ? rgb(0.74,0.52,0.09) : rgb(0.47,0.04,0.04)});y-=line.gap*scale;}
  if (sealBytes) {
    const seal = await document.embedPng(sealBytes);
    page.drawImage(seal, { x: 640, y: 40, width: 80, height: 80 });
  }
  page.drawText(`Số: ${input.number}`, {x: 300, y: 32, size: 10, font, color: rgb(0.09,0.25,0.38)});
  page.drawText("Người nhận", {x: 190, y: 115, size: 12, font, color: rgb(0.09,0.25,0.38)});
  page.drawText("Đại diện ban tổ chức", {x: 625, y: 115, size: 12, font, color: rgb(0.09,0.25,0.38)});
  page.drawText("[Họ tên, chức vụ, chữ ký xác nhận]", {x: 575, y: 98, size: 10, font, color: rgb(0.09,0.25,0.38)});
  // No fabricated signature or attendance duration. A real signing certificate is required separately.
  document.setTitle(`Chứng nhận ${input.number}`);document.setSubject(input.title);document.setAuthor("Ban tổ chức hội thảo");
  return document.save();
}
