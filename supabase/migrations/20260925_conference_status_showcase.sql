-- Dữ liệu cho trang Hội thảo và Bài báo.
-- Chạy sau các migration ngày 2026-09-25.
-- Có thể chạy lại: hội thảo được cập nhật theo ngày hiện tại, bài báo không bị tạo trùng.

BEGIN;

DO $$
DECLARE
  organizer_id uuid;
  author_id uuid;
BEGIN
  SELECT id
  INTO organizer_id
  FROM public.profiles
  ORDER BY
    CASE role WHEN 'organizer' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    created_at
  LIMIT 1;

  IF organizer_id IS NULL THEN
    RAISE EXCEPTION 'Cần ít nhất một hồ sơ để tạo dữ liệu hội thảo';
  END IF;

  SELECT id
  INTO author_id
  FROM public.profiles
  ORDER BY
    CASE role WHEN 'author' THEN 0 WHEN 'reviewer' THEN 1 ELSE 2 END,
    created_at
  LIMIT 1;

  IF author_id IS NULL THEN
    author_id := organizer_id;
  END IF;

  INSERT INTO public.conferences (
    id, title, description, start_date, end_date, location, status,
    organizer_id, cover_image_url, max_participants,
    submission_deadline, review_deadline, registration_deadline,
    camera_ready_deadline, blind_review, topics, event_format,
    is_featured, is_schedule_public, contact_name, contact_email, contact_phone
  )
  VALUES
    (
      'c0000000-0000-0000-0000-000000000001',
      'Diễn đàn Công nghệ Giáo dục Tương lai',
      'Hội thảo đang ở giai đoạn chuẩn bị nội dung và chưa được công bố chính thức.',
      CURRENT_DATE + 120, CURRENT_DATE + 121,
      'Trường Đại học Sư phạm TP. Hồ Chí Minh', 'draft', organizer_id,
      'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1200&q=80',
      180, CURRENT_DATE + 75, CURRENT_DATE + 90, CURRENT_DATE + 110,
      CURRENT_DATE + 100, false,
      ARRAY['Công nghệ giáo dục', 'Học tập số', 'Đổi mới sáng tạo'],
      'offline', false, false, 'Ban tổ chức EdFuture',
      'edfuture@example.com', '0901000001'
    ),
    (
      'c0000000-0000-0000-0000-000000000002',
      'Hội thảo Trí tuệ nhân tạo và Dữ liệu 2026',
      'Diễn đàn trao đổi các nghiên cứu mới về AI, khoa học dữ liệu và ứng dụng thực tiễn.',
      CURRENT_DATE + 60, CURRENT_DATE + 62,
      'Đại học Quốc gia TP. Hồ Chí Minh', 'open', organizer_id,
      'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80',
      350, CURRENT_DATE + 20, CURRENT_DATE + 35, CURRENT_DATE + 50,
      CURRENT_DATE + 45, true,
      ARRAY['Trí tuệ nhân tạo', 'Khoa học dữ liệu', 'Học máy'],
      'hybrid', true, true, 'Ban tổ chức AIDC',
      'aidc@example.com', '0901000002'
    ),
    (
      'c0000000-0000-0000-0000-000000000003',
      'Hội nghị An toàn Thông tin và Điện toán Đám mây',
      'Hội nghị đã đóng cổng đăng ký và đang hoàn thiện chương trình trước ngày khai mạc.',
      CURRENT_DATE + 25, CURRENT_DATE + 26,
      'Đà Nẵng', 'closed', organizer_id,
      'https://images.unsplash.com/photo-1563986768609-322da13575f3?auto=format&fit=crop&w=1200&q=80',
      220, CURRENT_DATE - 25, CURRENT_DATE - 10, CURRENT_DATE - 2,
      CURRENT_DATE + 5, true,
      ARRAY['An toàn thông tin', 'Điện toán đám mây', 'Mật mã học'],
      'hybrid', false, true, 'Ban tổ chức CSEC',
      'csec@example.com', '0901000003'
    ),
    (
      'c0000000-0000-0000-0000-000000000004',
      'Hội thảo Chuyển đổi số và Thành phố Thông minh',
      'Hội thảo đang diễn ra với các phiên báo cáo về chính quyền số, IoT và đô thị bền vững.',
      CURRENT_DATE - 1, CURRENT_DATE + 1,
      'Trung tâm Hội nghị Quốc gia, Hà Nội', 'ongoing', organizer_id,
      'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80',
      500, CURRENT_DATE - 60, CURRENT_DATE - 35, CURRENT_DATE - 7,
      CURRENT_DATE - 20, false,
      ARRAY['Chuyển đổi số', 'Thành phố thông minh', 'IoT'],
      'offline', true, true, 'Ban tổ chức SmartCity',
      'smartcity@example.com', '0901000004'
    ),
    (
      'c0000000-0000-0000-0000-000000000005',
      'Hội nghị Khoa học Máy tính và Công nghệ Phần mềm',
      'Hội nghị đã hoàn thành, lưu trữ chương trình và các bài báo khoa học tiêu biểu.',
      CURRENT_DATE - 90, CURRENT_DATE - 88,
      'Đại học Bách khoa Hà Nội', 'completed', organizer_id,
      'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
      300, CURRENT_DATE - 150, CURRENT_DATE - 125, CURRENT_DATE - 100,
      CURRENT_DATE - 110, false,
      ARRAY['Kỹ thuật phần mềm', 'Hệ thống phân tán', 'Kiểm thử phần mềm'],
      'offline', false, true, 'Ban tổ chức CSE',
      'cse@example.com', '0901000005'
    ),
    (
      'c0000000-0000-0000-0000-000000000006',
      'Hội thảo Quốc tế Robot và Tự động hóa',
      'Hội thảo đã hủy; bản ghi được giữ lại để minh họa trạng thái và lịch sử sự kiện.',
      CURRENT_DATE + 40, CURRENT_DATE + 42,
      'Cần Thơ', 'cancelled', organizer_id,
      'https://images.unsplash.com/photo-1488229297570-58520851e868?auto=format&fit=crop&w=1200&q=80',
      240, CURRENT_DATE - 5, CURRENT_DATE + 10, CURRENT_DATE + 25,
      CURRENT_DATE + 18, true,
      ARRAY['Robot', 'Tự động hóa', 'Thị giác máy tính'],
      'online', false, false, 'Ban tổ chức RAS',
      'ras@example.com', '0901000006'
    )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    location = EXCLUDED.location,
    status = EXCLUDED.status,
    organizer_id = EXCLUDED.organizer_id,
    cover_image_url = EXCLUDED.cover_image_url,
    max_participants = EXCLUDED.max_participants,
    submission_deadline = EXCLUDED.submission_deadline,
    review_deadline = EXCLUDED.review_deadline,
    registration_deadline = EXCLUDED.registration_deadline,
    camera_ready_deadline = EXCLUDED.camera_ready_deadline,
    blind_review = EXCLUDED.blind_review,
    topics = EXCLUDED.topics,
    event_format = EXCLUDED.event_format,
    is_featured = EXCLUDED.is_featured,
    is_schedule_public = EXCLUDED.is_schedule_public,
    contact_name = EXCLUDED.contact_name,
    contact_email = EXCLUDED.contact_email,
    contact_phone = EXCLUDED.contact_phone,
    updated_at = now();

  INSERT INTO public.papers (
    id, conference_id, title, abstract, keywords, file_url,
    status, submitted_by, current_version
  )
  VALUES
    (
      'd0000000-0000-0000-0000-000000000001',
      'c0000000-0000-0000-0000-000000000001',
      'Khung năng lực số cho sinh viên trong môi trường học tập kết hợp',
      'Nghiên cứu đề xuất khung năng lực số và phương pháp đánh giá phù hợp với mô hình học tập kết hợp tại đại học.',
      'năng lực số, blended learning, giáo dục đại học',
      'https://arxiv.org/pdf/2303.08774', 'submitted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000002',
      'c0000000-0000-0000-0000-000000000002',
      'Mô hình học sâu phát hiện bất thường trong dữ liệu chuỗi thời gian',
      'Bài báo khảo sát và đánh giá mô hình học sâu dùng để phát hiện bất thường trong dữ liệu cảm biến nhiều biến.',
      'deep learning, anomaly detection, time series',
      'https://arxiv.org/pdf/2009.07436', 'under_review', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000003',
      'c0000000-0000-0000-0000-000000000002',
      'Trợ lý học tập tiếng Việt dựa trên mô hình ngôn ngữ lớn',
      'Nghiên cứu trình bày kiến trúc trợ lý học tập, cơ chế truy xuất tri thức và phương pháp đánh giá câu trả lời tiếng Việt.',
      'LLM, RAG, trợ lý học tập, tiếng Việt',
      'https://arxiv.org/pdf/2005.11401', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000004',
      'c0000000-0000-0000-0000-000000000003',
      'Phát hiện xâm nhập mạng bằng học liên kết bảo vệ dữ liệu',
      'Phương pháp huấn luyện học liên kết cho phép nhiều đơn vị phối hợp phát hiện tấn công mà không chia sẻ dữ liệu thô.',
      'federated learning, intrusion detection, privacy',
      'https://arxiv.org/pdf/1602.05629', 'revision_required', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000005',
      'c0000000-0000-0000-0000-000000000004',
      'Nền tảng IoT giám sát chất lượng không khí đô thị theo thời gian thực',
      'Hệ thống kết hợp mạng cảm biến, xử lý luồng và bảng điều khiển để theo dõi chất lượng không khí tại đô thị.',
      'IoT, smart city, air quality, stream processing',
      'https://arxiv.org/pdf/1706.03762', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000006',
      'c0000000-0000-0000-0000-000000000004',
      'Tối ưu điều phối giao thông bằng học tăng cường đa tác tử',
      'Bài báo áp dụng học tăng cường đa tác tử để điều khiển tín hiệu giao thông thích nghi theo mật độ phương tiện.',
      'multi-agent, reinforcement learning, traffic control',
      'https://arxiv.org/pdf/1911.10635', 'under_review', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000007',
      'c0000000-0000-0000-0000-000000000005',
      'Kiểm thử dựa trên thuộc tính cho dịch vụ phân tán',
      'Nghiên cứu đánh giá hiệu quả của kiểm thử dựa trên thuộc tính trong việc phát hiện lỗi nhất quán ở dịch vụ phân tán.',
      'property-based testing, distributed systems, software testing',
      'https://arxiv.org/pdf/1901.01930', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000008',
      'c0000000-0000-0000-0000-000000000005',
      'Dự đoán lỗi phần mềm từ lịch sử thay đổi mã nguồn',
      'Mô hình kết hợp đặc trưng quy trình và biểu diễn mã nguồn để dự đoán mô-đun có nguy cơ phát sinh lỗi.',
      'defect prediction, source code, software analytics',
      'https://arxiv.org/pdf/1807.00537', 'rejected', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000009',
      'c0000000-0000-0000-0000-000000000006',
      'Điều khiển cánh tay robot bằng thị giác và học bắt chước',
      'Bài báo nghiên cứu mô hình học bắt chước từ dữ liệu hình ảnh để thực hiện các tác vụ gắp và đặt vật thể.',
      'robotics, imitation learning, computer vision',
      'https://arxiv.org/pdf/1810.04805', 'submitted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000010',
      'c0000000-0000-0000-0000-000000000001',
      'Thiết kế hệ sinh thái học tập thích ứng trong giáo dục đại học',
      'Nghiên cứu đề xuất kiến trúc học tập thích ứng dựa trên hồ sơ người học, phân tích dữ liệu và phản hồi theo thời gian thực.',
      'adaptive learning, learning analytics, giáo dục đại học',
      'https://arxiv.org/pdf/2302.11382', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000011',
      'c0000000-0000-0000-0000-000000000003',
      'Phát hiện mã độc bằng biểu diễn đồ thị lời gọi hàm',
      'Bài báo xây dựng đồ thị lời gọi hàm và sử dụng mạng nơ-ron đồ thị để nhận diện các mẫu hành vi độc hại.',
      'malware detection, graph neural network, cyber security',
      'https://arxiv.org/pdf/2003.04094', 'accepted', author_id, 1
    ),
    (
      'd0000000-0000-0000-0000-000000000012',
      'c0000000-0000-0000-0000-000000000006',
      'Lập kế hoạch chuyển động an toàn cho robot cộng tác',
      'Nghiên cứu trình bày phương pháp lập kế hoạch chuyển động có xét đến bất định khi robot làm việc cùng con người.',
      'collaborative robot, motion planning, human-robot interaction',
      'https://arxiv.org/pdf/2203.12644', 'accepted', author_id, 1
    )
  ON CONFLICT (id) DO NOTHING;
END $$;

COMMIT;
