export const CONFERENCE_FIELDS = {
  "Công nghệ thông tin": ["Trí tuệ nhân tạo", "Khoa học dữ liệu", "An toàn thông tin", "IoT", "Kỹ thuật phần mềm", "Mạng máy tính", "Điện toán đám mây"],
  "Kỹ thuật": ["Cơ khí", "Điện - Điện tử", "Tự động hóa", "Robot", "Kỹ thuật xây dựng", "Kỹ thuật vật liệu"],
  "Khoa học tự nhiên": ["Toán học", "Vật lý", "Hóa học", "Sinh học", "Khoa học Trái đất"],
  "Y tế": ["Y học lâm sàng", "Y tế công cộng", "Dược học", "Điều dưỡng", "Công nghệ y sinh", "Dinh dưỡng"],
  "Nông nghiệp": ["Trồng trọt", "Chăn nuôi", "Thủy sản", "Lâm nghiệp", "Nông nghiệp thông minh", "Công nghệ sau thu hoạch"],
  "Môi trường": ["Biến đổi khí hậu", "Quản lý tài nguyên", "Xử lý chất thải", "Bảo tồn đa dạng sinh học", "Năng lượng tái tạo", "Phát triển bền vững"],
  "Kinh tế": ["Kinh tế vĩ mô", "Kinh tế vi mô", "Kinh tế phát triển", "Kinh tế quốc tế", "Tài chính - Ngân hàng", "Kinh tế số"],
  "Kinh doanh": ["Quản trị doanh nghiệp", "Marketing", "Thương mại điện tử", "Khởi nghiệp", "Quản trị nhân lực", "Logistics và chuỗi cung ứng"],
  "Giáo dục": ["Phương pháp giảng dạy", "Quản lý giáo dục", "Công nghệ giáo dục", "Giáo dục đại học", "Giáo dục phổ thông", "Giáo dục đặc biệt"],
  "Luật": ["Luật dân sự", "Luật hình sự", "Luật kinh tế", "Luật quốc tế", "Luật hành chính", "Sở hữu trí tuệ"],
  "Khoa học xã hội": ["Xã hội học", "Tâm lý học", "Lịch sử", "Văn hóa học", "Ngôn ngữ học", "Truyền thông"],
  "Du lịch": ["Quản trị du lịch", "Du lịch bền vững", "Du lịch văn hóa", "Du lịch thông minh", "Quản trị khách sạn", "Quản trị lữ hành"],
} as const;

export type ConferenceField = keyof typeof CONFERENCE_FIELDS;

export function isConferenceField(value: string): value is ConferenceField {
  return Object.prototype.hasOwnProperty.call(CONFERENCE_FIELDS, value);
}

export function getConferenceTopics(field: string): readonly string[] {
  return isConferenceField(field) ? CONFERENCE_FIELDS[field] : [];
}
