type MessagesShape = {
  brand: { name: string; tagline: string };
  landing: {
    headline: string;
    subhead: string;
    cta: string;
    alpha: string;
    invite_hint: string;
    value_props: {
      conversation: { title: string; body: string };
      notion: { title: string; body: string };
      verbatim: { title: string; body: string };
    };
    mock: {
      today_schedule: string;
      due_soon: string;
      past_week: string;
      past_week_window: string;
      past_week_counts: string;
      past_week_pattern: string;
      csc108_lecture: string;
      office_hours: string;
      mat135_tutorial: string;
      physics_ps4: string;
      essay_outline: string;
      mat135_hw: string;
      in_14h: string;
      in_2d: string;
      in_3d: string;
    };
    footer: {
      privacy: string;
      terms: string;
      contact: string;
      subject_to_change: string;
    };
    sign_in: string;
  };
  nav: {
    home: string;
    chats: string;
    classes: string;
    calendar: string;
    settings: string;
  };
  login: { title: string; subtitle: string; button: string };
  app: { welcome: string; empty_state: string };
  legal: { privacy_title: string; terms_title: string; placeholder: string };
};

export const en: MessagesShape = {
  brand: {
    name: "Steadii",
    tagline: "Steady through the semester.",
  },
  landing: {
    headline: "Steady through the semester.",
    subhead:
      "Your classes, assignments, and mistakes — in one conversation.",
    cta: "Continue with Google",
    alpha: "α version — invite only",
    invite_hint: "Invite-only during α.",
    value_props: {
      conversation: {
        title: "One conversation",
        body: "Ask Steadii anything about your classes. It reads Notion and your calendar, then answers.",
      },
      notion: {
        title: "Notion-native",
        body: "Your mistakes, syllabi, and assignments live in your own Notion. Steadii organizes, never locks in.",
      },
      verbatim: {
        title: "Verbatim by default",
        body: "Original PDFs and full source text are kept with every syllabus — no lossy summaries.",
      },
    },
    mock: {
      today_schedule: "Today's schedule",
      due_soon: "Due soon",
      past_week: "Past week",
      past_week_window: "4/13 — 4/20",
      past_week_counts: "{chats} chats · {mistakes} mistakes · {syllabi} syllabi",
      past_week_pattern: "Stuck on free-fall problems 3 times this week.",
      csc108_lecture: "CSC108 lecture",
      office_hours: "Office hours",
      mat135_tutorial: "MAT135 tutorial",
      physics_ps4: "Physics PS 4",
      essay_outline: "Essay outline",
      mat135_hw: "MAT135 HW",
      in_14h: "in 14h",
      in_2d: "in 2d",
      in_3d: "in 3d",
    },
    footer: {
      privacy: "Privacy",
      terms: "Terms",
      contact: "Contact",
      subject_to_change: "α · subject to change",
    },
    sign_in: "Sign in",
  },
  nav: {
    home: "Home",
    chats: "Chats",
    classes: "Classes",
    calendar: "Calendar",
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
