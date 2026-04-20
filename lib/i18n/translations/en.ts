type MessagesShape = {
  brand: { name: string; tagline: string };
  landing: { headline: string; subhead: string; cta: string; alpha: string };
  nav: {
    chat: string;
    calendar: string;
    mistakes: string;
    syllabus: string;
    assignments: string;
    resources: string;
    settings: string;
  };
  login: { title: string; subtitle: string; button: string };
  app: { welcome: string; empty_state: string };
  legal: { privacy_title: string; terms_title: string; placeholder: string };
};

export const en: MessagesShape = {
  brand: {
    name: "Steadii",
    tagline: "Your academic life, gently organized.",
  },
  landing: {
    headline: "Steadii keeps university a little quieter.",
    subhead:
      "A calm workspace that ties Notion, Google Calendar, and your study notes together through conversation.",
    cta: "Sign in with Google",
    alpha: "α version — invite only",
  },
  nav: {
    chat: "Chat",
    calendar: "Calendar",
    mistakes: "Mistake Notes",
    syllabus: "Syllabus",
    assignments: "Assignments",
    resources: "Resources",
    settings: "Settings",
  },
  login: {
    title: "Welcome back",
    subtitle: "Sign in with your university Google account.",
    button: "Continue with Google",
  },
  app: {
    welcome: "Welcome, {name}.",
    empty_state: "Nothing here yet.",
  },
  legal: {
    privacy_title: "Privacy Policy",
    terms_title: "Terms of Service",
    placeholder:
      "This document is a placeholder for the α version. It will be replaced before general release.",
  },
};

export type Messages = MessagesShape;
