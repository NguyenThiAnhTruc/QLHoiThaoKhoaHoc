import { createContext } from "react";

export type PageKey =
  | "dashboard"
  | "conferences"
  | "topics"
  | "funding"
  | "speaker"
  | "resources"
  | "session-detail"
  | "conference-detail"
  | "conference-form"
  | "papers"
  | "paper-detail"
  | "paper-form"
  | "reviews"
  | "review-detail"
  | "sessions"
  | "session-form"
  | "participants"
  | "certificates"
  | "messages"
  | "users"
  | "profile";

export interface RouteState {
  page: PageKey;
  params: Record<string, string>;
}

export interface RouterContextValue {
  route: RouteState;
  formRoute: RouteState | null;
  closeForm: () => void;
  navigate: (page: PageKey, params?: Record<string, string>) => void;
}

export const RouterContext = createContext<RouterContextValue | undefined>(
  undefined,
);
