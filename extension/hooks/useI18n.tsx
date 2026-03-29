import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Lang = 'vi' | 'en';

const translations = {
  // ===== Shared =====
  connected: { vi: 'Đã kết nối', en: 'Connected' },
  disconnected: { vi: 'Mất kết nối', en: 'Disconnected' },
  loading: { vi: 'Đang tải...', en: 'Loading...' },
  save: { vi: 'Lưu', en: 'Save' },
  saved: { vi: 'Đã lưu!', en: 'Saved!' },
  saving: { vi: 'Đang lưu...', en: 'Saving...' },
  cancel: { vi: 'Hủy', en: 'Cancel' },
  edit: { vi: 'Sửa', en: 'Edit' },
  delete: { vi: 'Xóa', en: 'Delete' },
  search: { vi: 'Tìm kiếm', en: 'Search' },
  previous: { vi: 'Trước', en: 'Previous' },
  next: { vi: 'Tiếp', en: 'Next' },
  back: { vi: 'Quay lại', en: 'Back' },
  done: { vi: 'Xong', en: 'Done' },
  ok: { vi: 'Đúng', en: 'OK' },
  wrong: { vi: 'Sai', en: 'Wrong' },

  // ===== Popup =====
  pause: { vi: 'Tạm dừng', en: 'Pause' },
  paused: { vi: 'Đã tạm dừng', en: 'Paused' },
  resume: { vi: 'Tiếp tục', en: 'Resume' },
  ai_model: { vi: 'AI Model', en: 'AI Model' },
  ai_connected: { vi: 'Đã kết nối', en: 'Connected' },
  ai_not_connected: { vi: 'Chưa cài đặt', en: 'Not installed' },
  ai_setup_hint: { vi: 'Cài Ollama để có gợi ý AI', en: 'Install Ollama for AI suggestions' },
  ai_auto_reply: { vi: 'Tự động trả lời', en: 'AI Auto-Reply' },
  qa_pairs: { vi: 'Cặp Q&A', en: 'Q&A Pairs' },
  auto_today: { vi: 'Tự động hôm nay', en: 'Auto Today' },
  manual_today: { vi: 'Thủ công hôm nay', en: 'Manual Today' },
  quick_controls: { vi: 'Điều khiển nhanh', en: 'Quick Controls' },
  auto_reply: { vi: 'Tự động trả lời', en: 'Auto-reply' },
  recent_auto_replies: { vi: 'Trả lời gần đây', en: 'Recent Auto-Replies' },
  no_recent_activity: { vi: 'Chưa có hoạt động', en: 'No recent activity' },
  no_stats: { vi: 'Không có thống kê', en: 'No stats available' },
  backend_disconnected: { vi: 'Chưa kết nối backend', en: 'Backend disconnected' },
  backend_not_running: {
    vi: 'Chưa kết nối với Backend. Vui lòng chạy ShopReply Backend trước rồi tải lại trang.',
    en: 'Backend is not running. Please start ShopReply Backend first, then reload this page.',
  },
  loading_stats: { vi: 'Đang tải thống kê...', en: 'Loading stats...' },
  settings: { vi: 'Cài đặt', en: 'Settings' },
  dashboard: { vi: 'Bảng điều khiển', en: 'Dashboard' },
  match: { vi: 'khớp', en: 'match' },

  // ===== Options Tabs =====
  tab_qa: { vi: 'Bộ câu hỏi', en: 'Q&A Database' },
  tab_log: { vi: 'Nhật ký', en: 'Auto-Reply Log' },
  tab_settings: { vi: 'Cài đặt', en: 'Settings' },
  tab_import: { vi: 'Import & Huấn luyện', en: 'Import & Train' },
  tab_about: { vi: 'Giới thiệu', en: 'About' },

  // ===== Q&A Database Tab =====
  qa_database: { vi: 'Bộ câu hỏi - trả lời', en: 'Q&A Database' },
  add_qa: { vi: '+ Thêm Q&A', en: '+ Add Q&A' },
  add_qa_pair: { vi: 'Thêm cặp Q&A', en: 'Add Q&A Pair' },
  edit_qa_pair: { vi: 'Sửa cặp Q&A', en: 'Edit Q&A Pair' },
  question: { vi: 'Câu hỏi', en: 'Question' },
  answer: { vi: 'Câu trả lời', en: 'Answer' },
  source: { vi: 'Nguồn', en: 'Source' },
  sent: { vi: 'Đã gửi', en: 'Sent' },
  actions: { vi: 'Thao tác', en: 'Actions' },
  search_placeholder: { vi: 'Tìm kiếm câu hỏi hoặc câu trả lời...', en: 'Search questions or answers...' },
  no_results: { vi: 'Không tìm thấy kết quả', en: 'No results found' },
  no_qa_yet: { vi: 'Chưa có cặp Q&A nào', en: 'No Q&A pairs yet' },
  qa_pairs_count: { vi: 'cặp', en: 'pairs' },
  delete_confirm: { vi: 'Xóa cặp Q&A này?', en: 'Delete this Q&A pair?' },
  both_required: { vi: 'Cần điền cả câu hỏi và câu trả lời', en: 'Both question and answer are required' },
  save_failed: { vi: 'Lưu thất bại', en: 'Save failed' },
  update: { vi: 'Cập nhật', en: 'Update' },
  add: { vi: 'Thêm', en: 'Add' },
  page_of: { vi: 'Trang', en: 'Page' },
  of: { vi: 'của', en: 'of' },
  total: { vi: 'tổng', en: 'total' },

  // ===== Auto-Reply Log Tab =====
  auto_reply_log: { vi: 'Nhật ký tự động trả lời', en: 'Auto-Reply Log' },
  today: { vi: 'Hôm nay', en: 'Today' },
  this_week: { vi: 'Tuần này', en: 'This Week' },
  all: { vi: 'Tất cả', en: 'All' },
  reviewed: { vi: 'Đã xem', en: 'Reviewed' },
  unreviewed: { vi: 'Chưa xem', en: 'Unreviewed' },
  time: { vi: 'Thời gian', en: 'Time' },
  customer_question: { vi: 'Câu hỏi khách', en: 'Customer Question' },
  auto_answer: { vi: 'Trả lời tự động', en: 'Auto Answer' },
  similarity: { vi: 'Độ khớp', en: 'Similarity' },
  status: { vi: 'Trạng thái', en: 'Status' },
  no_log_entries: { vi: 'Chưa có nhật ký', en: 'No log entries' },

  // ===== Settings Tab =====
  reply_thresholds: { vi: 'Ngưỡng trả lời', en: 'Reply Thresholds' },
  auto_reply_threshold: { vi: 'Ngưỡng tự động trả lời', en: 'Auto-reply threshold' },
  suggest_threshold: { vi: 'Ngưỡng gợi ý', en: 'Suggest threshold' },
  more_auto: { vi: 'tự động nhiều hơn', en: 'more auto' },
  stricter: { vi: 'chặt hơn', en: 'stricter' },
  more_suggestions: { vi: 'gợi ý nhiều hơn', en: 'more suggestions' },
  fewer: { vi: 'ít hơn', en: 'fewer' },
  reply_tone: { vi: 'Giọng văn', en: 'Reply Tone' },
  friendly: { vi: 'Thân thiện (khuyến nghị)', en: 'Friendly (recommended)' },
  professional: { vi: 'Chuyên nghiệp / Trang trọng', en: 'Professional / Formal' },
  casual: { vi: 'Thoải mái', en: 'Casual' },
  platforms: { vi: 'Nền tảng', en: 'Platforms' },
  backend_url: { vi: 'URL Backend', en: 'Backend URL' },
  default_url: { vi: 'Mặc định: http://localhost:3000', en: 'Default: http://localhost:3000' },
  notifications: { vi: 'Thông báo', en: 'Notifications' },
  browser_notifications: { vi: 'Thông báo trình duyệt', en: 'Browser notifications' },
  notify_desc: { vi: 'Nhận thông báo khi có câu hỏi mới cần xử lý', en: 'Get notified when a new question needs attention' },
  enable_auto_reply: { vi: 'Bật tự động trả lời', en: 'Enable auto-reply' },
  auto_reply_desc: { vi: 'Tự động gửi trả lời khi độ chính xác vượt ngưỡng', en: 'Automatically send replies when confidence is above threshold' },

  // ===== Import & Train Tab =====
  import_train: { vi: 'Import & Huấn luyện', en: 'Import & Train' },
  import_from_file: { vi: 'Import Q&A từ file', en: 'Import Q&A from File' },
  import_file_desc: { vi: 'Tải file CSV hoặc JSON chứa cặp câu hỏi-trả lời, hoặc paste trực tiếp.', en: 'Upload a CSV or JSON file with question-answer pairs, or paste them directly.' },
  import_qa: { vi: 'Import Q&A', en: 'Import Q&A' },
  quick_paste: { vi: 'Paste nhanh', en: 'Quick Paste' },
  quick_paste_desc: { vi: 'Paste cặp Q&A trực tiếp. Dùng cửa sổ import để có thêm tùy chọn.', en: 'Paste Q&A pairs directly. Use the import modal for more options.' },
  open_import: { vi: 'Mở cửa sổ Import', en: 'Open Import Dialog' },
  scan_chat: { vi: 'Quét lịch sử chat', en: 'Scan Chat History' },
  scan_chat_desc: { vi: 'Trích xuất cặp Q&A từ các cuộc hội thoại trên Facebook hoặc Zalo.', en: 'Extract Q&A pairs from existing chat conversations on Facebook or Zalo.' },
  scan_how_to: { vi: 'Cách quét lịch sử chat:', en: 'How to scan chat history:' },
  scan_step1: { vi: 'Mở Facebook Messenger hoặc Zalo ở tab mới', en: 'Open Facebook Messenger or Zalo in a new tab' },
  scan_step2: { vi: 'Mở cuộc hội thoại với khách hàng', en: 'Navigate to a customer conversation' },
  scan_step3: { vi: 'Cuộn lên để tải tin nhắn cũ', en: 'Scroll up to load older messages' },
  scan_step4: { vi: 'Quay lại đây và nhấn "Quét cuộc hội thoại"', en: 'Come back here and click "Scan Conversation"' },
  scan_step5: { vi: 'Xem lại và chọn các cặp Q&A muốn import', en: 'Review and select Q&A pairs to import' },
  scan_start: { vi: 'Quét cuộc hội thoại', en: 'Scan Conversation' },
  scan_scanning: { vi: 'Đang quét...', en: 'Scanning...' },
  scan_no_tab: { vi: 'Không tìm thấy tab Facebook Messenger hoặc Zalo. Hãy mở cuộc hội thoại trước.', en: 'No Facebook Messenger or Zalo tab found. Open a chat conversation first.' },
  scan_no_messages: { vi: 'Không tìm thấy tin nhắn. Hãy mở cuộc hội thoại và cuộn để load tin nhắn cũ.', en: 'No messages found. Open a conversation and scroll to load older messages.' },
  scan_connect_error: { vi: 'Không thể kết nối tab chat. Hãy refresh trang Facebook/Zalo và thử lại.', en: 'Cannot connect to chat tab. Refresh Facebook/Zalo page and try again.' },
  scan_found: { vi: 'Tìm thấy', en: 'Found' },
  scan_pairs_from: { vi: 'cặp Q&A từ', en: 'Q&A pairs from' },
  scan_messages: { vi: 'tin nhắn', en: 'messages' },
  scan_no_pairs: { vi: 'Không trích xuất được cặp Q&A nào. Hãy thử cuộn thêm tin nhắn và quét lại.', en: 'No Q&A pairs extracted. Try scrolling to load more messages and scan again.' },
  scan_import_selected: { vi: 'Import đã chọn', en: 'Import Selected' },
  scan_import_success: { vi: 'Import thành công!', en: 'Import successful!' },
  scan_confidence: { vi: 'độ tin cậy', en: 'confidence' },
  supported_formats: { vi: 'Định dạng hỗ trợ', en: 'Supported Formats' },
  pipe_separated: { vi: 'Phân tách bằng dấu |:', en: 'Pipe-separated text:' },

  // ===== Import Modal =====
  import_qa_pairs: { vi: 'Import cặp Q&A', en: 'Import Q&A Pairs' },
  import_complete: { vi: 'Import hoàn tất', en: 'Import Complete' },
  total_in_file: { vi: 'Tổng trong file:', en: 'Total in file:' },
  added: { vi: 'Đã thêm:', en: 'Added:' },
  skipped_dup: { vi: 'Bỏ qua (trùng):', en: 'Skipped (duplicate):' },
  skipped_invalid: { vi: 'Bỏ qua (lỗi):', en: 'Skipped (invalid):' },
  found_pairs: { vi: 'Tìm thấy', en: 'Found' },
  review_before: { vi: 'cặp Q&A. Xem lại trước khi import:', en: 'Q&A pair(s). Review before importing:' },
  importing: { vi: 'Đang import...', en: 'Importing...' },
  import_n_pairs: { vi: 'Import', en: 'Import' },
  file_upload: { vi: 'Tải file', en: 'File Upload' },
  paste_text: { vi: 'Paste văn bản', en: 'Paste Text' },
  drop_file: { vi: 'Kéo thả file vào đây hoặc click để chọn', en: 'Drop file here or click to browse' },
  supports_csv_json: { vi: 'Hỗ trợ file CSV, JSON', en: 'Supports CSV, JSON files' },
  paste_placeholder: { vi: 'Paste cặp Q&A, mỗi dòng một cặp:\n\nGiá áo hoodie? | Áo hoodie giá 350k ạ\nShip bao lâu? | Ship nội thành 1-2 ngày ạ', en: 'Paste Q&A pairs, one per line:\n\nGia ao hoodie? | Ao hoodie gia 350k a\nShip bao lau? | Ship noi thanh 1-2 ngay a' },
  paste_format: { vi: 'Định dạng: câu hỏi | câu trả lời (phân tách bằng dấu |)', en: 'Format: question | answer (separated by pipe character)' },
  parse_preview: { vi: 'Phân tích & Xem trước', en: 'Parse & Preview' },
  paste_first: { vi: 'Hãy paste nội dung trước', en: 'Please paste some text first' },
  no_pairs_found: { vi: 'Không tìm thấy cặp Q&A hợp lệ', en: 'No valid Q&A pairs found' },
  no_pairs_in_file: { vi: 'Không tìm thấy cặp Q&A hợp lệ trong file', en: 'No valid Q&A pairs found in file' },
  parse_failed: { vi: 'Phân tích thất bại', en: 'Failed to parse' },
  parse_file_failed: { vi: 'Không thể đọc file. Kiểm tra định dạng và thử lại.', en: 'Failed to parse file. Check the format and try again.' },

  // ===== About Tab =====
  about_shopreply: { vi: 'Giới thiệu ShopReply', en: 'About ShopReply' },
  user_guide: { vi: 'Hướng dẫn sử dụng', en: 'User Guide' },
  ai_auto_reply_fb_zalo: { vi: 'Tự động trả lời AI cho Facebook & Zalo', en: 'AI Auto-Reply for Facebook & Zalo' },
  version: { vi: 'Phiên bản:', en: 'Version:' },
  architecture: { vi: 'Kiến trúc:', en: 'Architecture:' },
  local_first: { vi: 'Ưu tiên local', en: 'Local-first' },
  data_privacy: { vi: 'Dữ liệu không bao giờ rời thiết bị của bạn. Mọi xử lý đều diễn ra trên máy với cơ sở dữ liệu Q&A và Ollama LLM tùy chọn.', en: 'Your data never leaves your device. All processing happens locally using your own Q&A database and optional Ollama LLM.' },
  donate_coffee: { vi: 'Mua tác giả ly cà phê', en: 'Buy me a coffee' },
  donate_desc: { vi: 'Nếu ShopReply giúp ích cho bạn, hãy ủng hộ tác giả nhé!', en: 'If ShopReply helps you, consider supporting the author!' },
  donate_qr: { vi: 'Chuyển khoản ngân hàng', en: 'Bank Transfer (QR)' },
  donate_qr_desc: { vi: 'Quét mã QR bằng ứng dụng ngân hàng Việt Nam', en: 'Scan QR with any Vietnamese banking app' },
  donate_card: { vi: 'Thẻ quốc tế', en: 'International Card' },
  donate_card_desc: { vi: 'Visa, Mastercard, PayPal', en: 'Visa, Mastercard, PayPal' },
  need_help: { vi: 'Cần hỗ trợ?', en: 'Need Help?' },
  report_desc: { vi: 'Phát hiện lỗi hoặc có đề xuất? Gửi email cho chúng tôi.', en: 'Found a bug or have a suggestion? Send us an email.' },
  report_issue: { vi: 'Báo lỗi', en: 'Report an Issue' },
  license_key: { vi: 'Mã kích hoạt', en: 'License Key' },
  license_desc: { vi: 'Nhập mã kích hoạt để mở khóa tính năng Pro.', en: 'Enter your license key to unlock Pro features.' },
  activate: { vi: 'Kích hoạt', en: 'Activate' },
  deactivate: { vi: 'Hủy kích hoạt', en: 'Deactivate' },
  free_tier: { vi: 'Bản miễn phí: 1 nền tảng, 30 cặp Q&A. Nâng cấp để không giới hạn.', en: 'Free tier: 1 platform, 30 Q&A pairs. Upgrade for unlimited features.' },

  // ===== Pricing / Tiers =====
  current_plan: { vi: 'Gói hiện tại', en: 'Current Plan' },
  upgrade: { vi: 'Nâng cấp', en: 'Upgrade' },
  pricing_plans: { vi: 'So sánh các gói', en: 'Compare Plans' },
  free_plan: { vi: 'Miễn phí', en: 'Free' },
  basic_plan: { vi: 'Basic', en: 'Basic' },
  pro_plan: { vi: 'Pro', en: 'Pro' },
  free_price: { vi: '0₫', en: '$0' },
  basic_price_monthly: { vi: '299K/tháng', en: '$12/month' },
  basic_price_yearly: { vi: '2.499K/năm', en: '$99/year' },
  pro_price_monthly: { vi: '499K/tháng', en: '$20/month' },
  pro_price_yearly: { vi: '4.499K/năm', en: '$179/year' },
  save_yearly: { vi: 'Tiết kiệm 31%', en: 'Save 31%' },
  save_yearly_pro: { vi: 'Tiết kiệm 25%', en: 'Save 25%' },
  feature_platforms: { vi: 'Nền tảng', en: 'Platforms' },
  feature_qa_limit: { vi: 'Số cặp Q&A', en: 'Q&A Pairs' },
  feature_auto_reply: { vi: 'Tự động trả lời', en: 'Auto-Reply' },
  feature_import: { vi: 'Import file CSV/JSON', en: 'Import CSV/JSON' },
  feature_ai_suggest: { vi: 'AI gợi ý câu trả lời', en: 'AI Answer Suggestions' },
  feature_scan_history: { vi: 'Quét lịch sử chat', en: 'Scan Chat History' },
  feature_custom_tone: { vi: 'Tùy chỉnh giọng văn', en: 'Custom Tone' },
  feature_priority_support: { vi: 'Hỗ trợ ưu tiên', en: 'Priority Support' },
  one_platform: { vi: '1 (FB hoặc Zalo)', en: '1 (FB or Zalo)' },
  one_platform_basic: { vi: '1 (FB hoặc Zalo)', en: '1 (FB or Zalo)' },
  both_platforms: { vi: 'FB + Zalo', en: 'FB + Zalo' },
  qa_30: { vi: '30 cặp', en: '30 pairs' },
  qa_500: { vi: '500 cặp', en: '500 pairs' },
  qa_30_indexed: { vi: '30 cặp đầu', en: 'First 30 pairs' },
  qa_500_indexed: { vi: '500 cặp đầu', en: 'First 500 pairs' },
  qa_unlimited: { vi: 'Không giới hạn', en: 'Unlimited' },
  suggest_only: { vi: 'Gói miễn phí — chỉ gợi ý, không tự gửi', en: 'Free plan — suggestions only, no auto-send' },
  suggest_only_short: { vi: 'Chỉ gợi ý', en: 'Suggest only' },
  no_auto_reply_banner: { vi: 'Chỉ gợi ý — cần xác nhận thủ công. Nâng cấp Pro để tự động.', en: 'Suggestions only — manual confirm required. Upgrade to Pro for auto-reply.' },
  full_auto: { vi: 'Tự động', en: 'Auto' },
  most_popular: { vi: 'Phổ biến nhất', en: 'Most Popular' },
  buy_license: { vi: 'Mua mã kích hoạt', en: 'Buy License Key' },
  active_until: { vi: 'Hiệu lực đến:', en: 'Active until:' },
  license_activated: { vi: 'Đã kích hoạt thành công!', en: 'License activated successfully!' },
  invalid_key_format: { vi: 'Sai định dạng mã. Vui lòng nhập đúng: SHOP-XXXX-XXXX-XXXX', en: 'Invalid format. Please enter: SHOP-XXXX-XXXX-XXXX' },
  invalid_key: { vi: 'Mã không hợp lệ. Vui lòng kiểm tra lại.', en: 'Invalid key. Please check and try again.' },
  invalid_tier: { vi: 'Mã không hợp lệ.', en: 'Invalid key.' },

  // ===== Feature Gating =====
  pro_feature: { vi: 'Tính năng Pro', en: 'Pro Feature' },
  basic_feature: { vi: 'Tính năng Basic', en: 'Basic Feature' },
  upgrade_to_unlock: { vi: 'Nâng cấp để mở khóa', en: 'Upgrade to unlock' },
  qa_limit_reached: { vi: 'Đã đạt giới hạn Q&A. Nâng cấp để thêm.', en: 'Q&A limit reached. Upgrade to add more.' },
  auto_reply_pro: { vi: 'Tự động trả lời cần gói Pro', en: 'Auto-reply requires Pro plan' },
  multi_platform_pro: { vi: 'Đa nền tảng cần gói Pro', en: 'Multi-platform requires Pro plan' },
  custom_tone_label: { vi: 'Giọng văn tùy chỉnh', en: 'Custom Tone' },
  custom_tone_placeholder: { vi: 'Mô tả giọng văn bạn muốn. Ví dụ: "Thân thiện, xưng em/mình, dùng emoji..."', en: 'Describe your desired tone. E.g., "Friendly, casual, use emojis..."' },
  custom_tone_desc: { vi: 'AI sẽ sử dụng giọng văn này khi gợi ý câu trả lời', en: 'AI will use this tone when suggesting replies' },

  // ===== Payment =====
  choose_payment_method: { vi: 'Chọn phương thức thanh toán', en: 'Choose payment method' },
  pay_qr_banking: { vi: 'Chuyển khoản ngân hàng (QR)', en: 'Bank Transfer (QR Code)' },
  pay_qr_desc: { vi: 'Quét QR chuyển khoản — nhận license key tự động qua email', en: 'Scan QR to transfer — receive license key automatically via email' },
  pay_fee: { vi: 'phí', en: 'fee' },
  pay_international: { vi: 'Visa / Mastercard / PayPal', en: 'Visa / Mastercard / PayPal' },
  pay_international_desc: { vi: 'Thanh toán quốc tế qua LemonSqueezy', en: 'International payment via LemonSqueezy' },
  pay_license_note: { vi: 'Sau khi thanh toán, bạn sẽ nhận license key qua email. Paste vào ô bên dưới để kích hoạt.', en: 'After payment, you will receive a license key via email. Paste it below to activate.' },

  // ===== Onboarding =====
  welcome_title: { vi: 'Chào mừng đến ShopReply!', en: 'Welcome to ShopReply!' },
  welcome_desc: { vi: 'Tự động trả lời khách hàng trên Facebook & Zalo. Làm theo 3 bước dưới đây để bắt đầu.', en: 'Auto-reply to customers on Facebook & Zalo. Follow 3 steps below to get started.' },
  step1_title: { vi: '1. Chạy Backend', en: '1. Run Backend' },
  step1_desc: { vi: 'Download và chạy ShopReply Backend trên máy tính.', en: 'Download and run ShopReply Backend on your computer.' },
  step1_button: { vi: 'Hướng dẫn cài đặt', en: 'Setup Guide' },
  step1_done: { vi: 'Đã kết nối!', en: 'Connected!' },
  step2_title: { vi: '2. Thêm bộ câu hỏi', en: '2. Add Q&A Database' },
  step2_desc: { vi: 'Import file CSV/Excel hoặc paste trực tiếp bộ câu hỏi-trả lời của shop.', en: 'Import CSV/Excel file or paste your shop Q&A pairs directly.' },
  step2_button: { vi: 'Import Q&A', en: 'Import Q&A' },
  step2_done: { vi: 'cặp Q&A', en: 'Q&A pairs' },
  step3_title: { vi: '3. Mở Facebook/Zalo', en: '3. Open Facebook/Zalo' },
  step3_desc: { vi: 'Mở trang tin nhắn. Bot sẽ tự động trả lời khách hàng!', en: 'Open messages page. Bot will auto-reply to customers!' },
  step3_fb: { vi: 'Mở Facebook Messages', en: 'Open Facebook Messages' },
  step3_zalo: { vi: 'Mở Zalo Web', en: 'Open Zalo Web' },
  all_set: { vi: 'Tất cả đã sẵn sàng! Bot đang hoạt động.', en: 'All set! Bot is running.' },

  // ===== Content Panel =====
  customer: { vi: 'Khách hàng:', en: 'Customer:' },
  db_match: { vi: 'Kết quả DB', en: 'Database Match' },
  ai_suggestion: { vi: 'Gợi ý AI', en: 'AI Suggestion' },
  send_db: { vi: 'Gửi câu DB', en: 'Send DB Answer' },
  send_ai: { vi: 'Gửi câu AI', en: 'Send AI Answer' },
  type_custom: { vi: 'Nhập câu trả lời tùy chỉnh...', en: 'Type a custom reply...' },
  send: { vi: 'Gửi', en: 'Send' },
  skip: { vi: 'Bỏ qua', en: 'Skip' },
  sent_toast: { vi: 'Đã gửi ✓', en: 'Sent ✓' },

  // ===== Review Prompt =====
  review_title: { vi: 'Bạn thấy ShopReply hữu ích?', en: 'Enjoying ShopReply?' },
  review_desc: { vi: 'Đánh giá 5 sao giúp mình rất nhiều!', en: 'A 5-star review helps a lot!' },
  review_button: { vi: 'Đánh giá ngay', en: 'Rate 5 Stars' },
  review_later: { vi: 'Để sau', en: 'Later' },
  review_never: { vi: 'Không hỏi nữa', en: "Don't ask again" },
} as const;

type TranslationKey = keyof typeof translations;

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'vi',
  setLang: () => {},
  t: (key) => translations[key]?.vi ?? key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return (localStorage.getItem('shopreply_lang') as Lang) || 'vi';
    } catch {
      return 'vi';
    }
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    try { localStorage.setItem('shopreply_lang', newLang); } catch {}
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return translations[key]?.[lang] ?? key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LangSwitcher() {
  const { lang, setLang } = useI18n();

  return (
    <div className="inline-flex border border-gray-300 rounded-lg overflow-hidden">
      <button
        onClick={() => setLang('vi')}
        className={`flex items-center gap-1 px-2 py-1 text-[11px] font-semibold transition-colors ${
          lang === 'vi' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'
        }`}
      >
        <svg className="w-4 h-3 rounded-sm flex-shrink-0" viewBox="0 0 900 600"><rect width="900" height="600" fill="#da251d"/><polygon points="450,120 520,330 340,210 560,210 380,330" fill="#ff0"/></svg>
        VI
      </button>
      <button
        onClick={() => setLang('en')}
        className={`flex items-center gap-1 px-2 py-1 text-[11px] font-semibold border-l border-gray-300 transition-colors ${
          lang === 'en' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'
        }`}
      >
        <svg className="w-4 h-3 rounded-sm flex-shrink-0" viewBox="0 0 900 600"><rect width="900" height="600" fill="#00247d"/><path d="M0,0L900,600M900,0L0,600" stroke="#fff" strokeWidth="80"/><path d="M0,0L900,600M900,0L0,600" stroke="#cf142b" strokeWidth="50"/><path d="M450,0V600M0,300H900" stroke="#fff" strokeWidth="120"/><path d="M450,0V600M0,300H900" stroke="#cf142b" strokeWidth="70"/></svg>
        EN
      </button>
    </div>
  );
}
