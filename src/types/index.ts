export type UserRole = "admin" | "organizer" | "reviewer" | "author" | "participant";

export type ConferenceStatus =
  | "draft"
  | "open"
  | "closed"
  | "ongoing"
  | "completed"
  | "cancelled";

export type PaperStatus =
  | "submitted"
  | "under_review"
  | "accepted"
  | "rejected"
  | "revision_required";

export type ReviewStatus = "assigned" | "in_progress" | "completed" | "declined";

export type ReviewRecommendation = "accept" | "reject" | "revise";

export type CertificateType = "attendance" | "presentation";

export type EventFormat = "online" | "offline" | "hybrid";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string;
  organization: string;
  avatar_url: string;
  bio: string;
  notification_preferences: Record<string, boolean>;
  language: "vi" | "en";
  timezone: string;
  email?: string;
  created_at: string;
  updated_at: string;
}

export interface Conference {
  id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  location: string;
  status: ConferenceStatus;
  organizer_id: string;
  cover_image_url: string;
  max_participants: number;
  submission_deadline: string | null;
  review_deadline: string | null;
  registration_deadline: string | null;
  camera_ready_deadline: string | null;
  blind_review: boolean;
  review_enabled?: boolean;
  require_accepted_paper?: boolean;
  auto_certificates?: boolean;
  auto_surveys?: boolean;
  field: string | null;
  topics: string[];
  event_format: EventFormat;
  is_featured: boolean;
  is_schedule_public: boolean;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  created_at: string;
  updated_at: string;
  organizer?: Profile;
}

export interface ConferenceTopic {
  id: string;
  conference_id: string;
  name: string;
  description: string;
  created_by: string | null;
  created_at: string;
}

export interface Participant {
  id: string;
  conference_id: string;
  user_id: string;
  registered_at: string;
  attended: boolean;
  checked_in_at: string | null;
  checked_in_by: string | null;
  checked_in_by_name?: string;
  attendance_code: string;
  user?: Profile;
  conference?: Conference;
}

export interface ConferenceStaff {
  id: string;
  conference_id: string;
  user_id: string;
  role: "owner" | "staff";
  created_at: string;
  user?: Profile;
}

export interface Paper {
  author_participation_status?: "participating" | "not_participating";
  problem_statement?: string;
  objectives?: string;
  author_group?: string;
  corresponding_author_id?: string | null;
  id: string;
  conference_id: string;
  title: string;
  abstract: string;
  keywords: string;
  file_url: string;
  status: PaperStatus;
  submitted_by: string | Profile | null;
  current_version: number;
  created_at: string;
  updated_at: string;
  conference?: Conference;
  submitted_by_profile?: Profile;
  authors?: PaperAuthor[];
  reviews?: Review[];
}

export interface PaperAuthor {
  id: string;
  paper_id: string;
  user_id: string;
  author_order: number;
  participation_status: "participating" | "not_participating";
  user?: Profile;
}

export interface Review {
  response_at?: string | null;
  decline_reason?: string;
  id: string;
  paper_id: string;
  reviewer_id: string;
  status: ReviewStatus;
  score: number | null;
  originality_score: number | null;
  relevance_score: number | null;
  methodology_score: number | null;
  presentation_score: number | null;
  comments: string;
  recommendation: ReviewRecommendation | null;
  assigned_at: string;
  completed_at: string | null;
  reviewer?: Profile;
  paper?: Paper;
}

export interface Session {
  tags?: string[];
  difficulty?: "general" | "beginner" | "advanced";
  resource_deadline?: string | null;
  parent_session_id?: string | null;
  id: string;
  conference_id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  room: string;
  committee_id: string | null;
  speaker_id: string | null;
  paper_id: string | null;
  created_at: string;
  speaker?: Profile;
  paper?: Paper;
  conference?: Conference;
  committee?: ConferenceCommittee;
}

export interface ConferenceCommittee {
  id: string;
  conference_id: string;
  name: string;
  room: string;
  description: string;
  created_at: string;
}

export type FeePaymentStatus = "pending" | "accepted" | "rejected";

export interface ConferenceFund {
  id: string;
  conference_id: string;
  name: string;
  amount: number;
  description: string;
  created_by: string;
  created_at: string;
  conference?: Conference;
}

export interface FeePayment {
  id: string;
  fund_id: string;
  conference_id: string;
  payer_id: string;
  amount: number;
  purpose: string;
  proof_url: string;
  status: FeePaymentStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string;
  created_at: string;
  fund?: ConferenceFund;
  conference?: Conference;
}

export interface Certificate {
  attendance_minutes?: number;
  pdf_path?: string | null;
  id: string;
  certificate_number: string;
  conference_id: string;
  user_id: string;
  certificate_type: CertificateType;
  issued_at: string;
  signature_hash?: string | null;
  paper_id?: string | null;
  paper?: Paper;
  user?: Profile;
  conference?: Conference;
}

export interface PaperVersion {
  id: string;
  paper_id: string;
  version_number: number;
  file_url: string;
  notes: string;
  uploaded_by: string;
  created_at: string;
  uploader?: Profile;
}

export interface ConferenceSpeaker {
  id: string;
  conference_id: string;
  full_name: string;
  title: string;
  organization: string;
  bio: string;
  avatar_url: string;
  is_keynote: boolean;
  display_order: number;
  created_at: string;
}

export interface ConferenceAnnouncement {
  id: string;
  conference_id: string;
  title: string;
  message: string;
  is_public: boolean;
  published_at: string;
  created_at: string;
  conference?: Pick<Conference, "id" | "title">;
}
