type MessagesShape = {
  brand: { name: string; tagline: string };
  landing: {
    headline: string;
    subhead: string;
    cta: string;
    alpha: string;
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
