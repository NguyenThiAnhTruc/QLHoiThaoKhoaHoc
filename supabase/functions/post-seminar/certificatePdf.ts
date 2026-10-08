import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

export interface CertificateInput {
  name: string; organization: string; title: string; location: string;
  number: string; start: string; end: string; issued: string; minutes: number;
}

export async function createCertificatePdf(input: CertificateInput, fontBytes: Uint8Array) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(fontBytes, { subset: true });
  const page = document.addPage([842,595]);
  page.drawRectangle({x:24,y:24,width:794,height:547,borderWidth:3,borderColor:rgb(0.06,0.46,0.43)});
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
  line("GIẤY CHỨNG NHẬN",28,42);
  line("THAM DỰ HỘI THẢO",19,42);
  line("Chứng nhận rằng",14,30);
  line(input.name,25,36);
  if(input.organization)line(`Đơn vị: ${input.organization}`,14,28);
  line("Đã tham dự hội thảo",14,28);
  line(input.title,19,28);
  line(`Thời gian: ${date(input.start)} – ${date(input.end)}`,13,24);
  if(input.location)line(`Địa điểm: ${input.location}`,13,24);
  if(input.minutes>0)line(`Thời lượng đã xác nhận: ${input.minutes} phút (${(input.minutes/60).toLocaleString("vi-VN",{maximumFractionDigits:2})} giờ)`,13,24);
  line(`Ngày cấp: ${date(input.issued)}`,12,24);
  line(`Số chứng nhận: ${input.number}`,11,22);
  const scale=Math.min(1,460/lines.reduce((sum,line)=>sum+line.gap,0));
  let y=520;
  for(const line of lines){const size=line.size*scale;page.drawText(line.text,{x:(842-font.widthOfTextAtSize(line.text,size))/2,y,size,font,color:rgb(0.12,0.2,0.28)});y-=line.gap*scale;}
  // No fabricated signature or attendance duration. A real signing certificate is required separately.
  document.setTitle(`Chứng nhận ${input.number}`);document.setSubject(input.title);document.setAuthor("Ban tổ chức hội thảo");
  return document.save();
}
