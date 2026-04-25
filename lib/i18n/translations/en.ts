type MessagesShape = {
  brand: { name: string; tagline: string };
  landing: {
    headline: string;
    subhead: string;
    cta: string;
    alpha: string;
    invite_hint: string;
    value_props: {
      triage: { title: string; body: string };
      glassbox: { title: string; body: string };
      confirm: { title: string; body: string };
      yours: { title: string; body: string };
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
    inbox: string;
    home: string;
    chats: string;
    classes: string;
    calendar: string;
    settings: string;
  };
  login: { title: string; subtitle: string; button: string };
  app: { welcome: string; empty_state: string };
  home: {
    today_schedule: string;
    due_soon: string;
    past_week: string;
    no_events: string;
    nothing_due: string;
    not_enough_history: string;
    counts: string;
    review_action: string;
    generate_practice_action: string;
    welcome_title: string;
    welcome_body: string;
    add_first_class: string;
    welcome_input_placeholder: string;
    greeting_morning: string;
    greeting_afternoon: string;
    greeting_evening: string;
    greeting_night: string;
    summary_ready: string;
    full_calendar: string;
    assignments_remaining: string;
    study_sessions: string;
    focus_summary: string;
    focus_summary_empty: string;
  };
  chat_input: {
    placeholder: string;
    send_hint: string;
    example_prompts: string[];
  };
  chat: {
    actions: {
      add_to_mistakes: string;
      generate_similar: string;
      save_mistake: string;
    };
    dismiss: string;
    remove_attachment: string;
  };
  settings: {
    title: string;
    sign_out: string;
    sections: {
      profile: string;
      connections: string;
      resources: string;
      agent: string;
      usage: string;
      appearance: string;
      language: string;
      timezone: string;
      danger: string;
    };
    appearance_theme_label: string;
    language_description: string;
    language_option_en: string;
    language_option_ja: string;
    timezone_description: string;
    timezone_placeholder: string;
    timezone_save: string;
    timezone_detected: string;
    timezone_saved: string;
    timezone_invalid: string;
  };
  billing: {
    page_title: string;
    page_subtitle: string;
    checkout_completed: string;
    checkout_canceled: string;
    founding_member_label: string;
    founding_member_body: string;
    price_locked_until: string;
    current_plan: string;
    plan_admin: string;
    plan_student: string;
    plan_student_renews: string;
    plan_pro_trial: string;
    plan_pro: string;
    plan_pro_renews: string;
    plan_free: string;
    credits_this_cycle: string;
    credits_unlimited: string;
    admin_quota_unenforced: string;
    credits_remaining: string;
    topup_remaining: string;
    storage: string;
    cancel_subscription: string;
    actions: {
      admin_bypass: string;
      upgrade_pro: string;
      upgrade_student: string;
      opening: string;
      manage_sub: string;
      add_credits: string;
      topup_500: string;
      topup_2000: string;
      topup_expiry: string;
      stepping_away: string;
      extend_retention: string;
      extend_retention_help: string;
    };
  };
  legal: { privacy_title: string; terms_title: string; placeholder: string };
  seed_prompts: {
    review_recent_mistakes: string;
    generate_similar_problems: string;
  };
};

export const en: MessagesShape = {
  brand: {
    name: "Steadii",
    tagline: "Steady through the semester.",
  },
  landing: {
    headline: "Steady through the semester.",
    subhead:
      "Steadii triages your university inbox and prepares replies before you open the app. You see every reason, edit anything, and approve every send.",
    cta: "Continue with Google",
    alpha: "α version — invite only",
    invite_hint: "Invite-only during α.",
    value_props: {
      triage: {
        title: "Drafts ready before you ask",
        body: "Steadii reads every inbound email, classifies risk, and prepares a reply in your voice. You arrive to a queue, not an inbox.",
      },
      glassbox: {
        title: "Glass-box by design",
        body: "Every draft shows what fired the agent, which past emails it cited, and what it considered. Nothing happens secretly.",
      },
      confirm: {
        title: "You confirm. Always.",
        body: "Send needs one-click approval and rides a 20-second undo. Nothing leaves your account without you.",
      },
      yours: {
        title: "Your data stays yours",
        body: "Verbatim mistakes, syllabi, and assignments. Yours to read, search, and export — never locked in.",
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
    inbox: "Inbox",
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
  home: {
    today_schedule: "Today's schedule",
    due_soon: "Due soon",
    past_week: "Past week",
    no_events: "No classes or events today.",
    nothing_due: "Nothing due. You're clear.",
    not_enough_history: "Not enough history yet. Come back next week.",
    counts: "{chats} chats · {mistakes} mistakes · {syllabi} syllabi",
    review_action: "Review",
    generate_practice_action: "Practice",
    welcome_title: "Welcome to Steadii",
    welcome_body:
      "Connect your first class to start seeing today's schedule, due assignments, and recent activity.",
    add_first_class: "+ Add your first class",
    welcome_input_placeholder:
      "or paste a syllabus, image, or ask anything…",
    greeting_morning: "Good morning, {name}.",
    greeting_afternoon: "Good afternoon, {name}.",
    greeting_evening: "Good evening, {name}.",
    greeting_night: "Still up, {name}?",
    summary_ready: "Your academic summary for the week is ready.",
    full_calendar: "Full calendar",
    assignments_remaining: "{count} assignments remaining today",
    study_sessions: "study sessions",
    focus_summary: "You focused for {hours} hours this week. Great momentum!",
    focus_summary_empty: "Not enough sessions yet — a few more and we’ll have a trend.",
  },
  chat_input: {
    placeholder: "Ask Steadii…",
    send_hint: "⌘⏎ to send",
    example_prompts: [
      "What's due this week?",
      "Explain this physics problem",
      "Add a chemistry assignment for Friday",
      "What's my next class?",
      "Summarize my CSC108 syllabus",
      "Generate similar practice problems",
      "Review my recent mistakes",
      "How did I spend last week studying?",
    ],
  },
  chat: {
    actions: {
      add_to_mistakes: "+ Add to mistakes",
      generate_similar: "Generate similar",
      save_mistake: "Save mistake note",
    },
    dismiss: "Dismiss",
    remove_attachment: "Remove",
  },
  settings: {
    title: "Settings",
    sign_out: "Sign out",
    sections: {
      profile: "Profile",
      connections: "Connections",
      resources: "Resources",
      agent: "Agent behavior",
      usage: "Usage & billing",
      appearance: "Appearance",
      language: "Language",
      timezone: "Time zone",
      danger: "Danger zone",
    },
    appearance_theme_label: "Theme",
    language_description:
      "Which language should the app use? Agent responses still follow the language you type in.",
    language_option_en: "English",
    language_option_ja: "日本語",
    timezone_description:
      "The agent uses this to resolve relative dates like “tomorrow.” Defaults to your browser's zone on first use.",
    timezone_placeholder: "e.g. America/Vancouver",
    timezone_save: "Save",
    timezone_detected: "Detected",
    timezone_saved: "Saved.",
    timezone_invalid: "Unknown time zone.",
  },
  billing: {
    page_title: "Billing",
    page_subtitle:
      "Stripe is in test mode for α. Charges won't post; subscription state still round-trips.",
    checkout_completed:
      "Checkout session completed. Your plan will update within a few seconds (via the Stripe webhook).",
    checkout_canceled: "Checkout canceled. No change.",
    founding_member_label: "Founding member.",
    founding_member_body: "Your current price is locked in for life.",
    price_locked_until: "Price locked until {date}.",
    current_plan: "Current plan",
    plan_admin: "Admin (flag) · unlimited",
    plan_student: "Student",
    plan_student_renews: "Student · renews {date}",
    plan_pro_trial: "Pro (14-day trial) · ends {date}",
    plan_pro: "Pro",
    plan_pro_renews: "Pro · renews {date}",
    plan_free: "Free",
    credits_this_cycle: "Credits this cycle",
    credits_unlimited: "(unlimited)",
    admin_quota_unenforced: "Admin bypass — quota not enforced.",
    credits_remaining: "{remaining} credits remaining · resets {date}",
    topup_remaining:
      "+ {remaining} top-up credits (expire 90 days after purchase)",
    storage: "Storage",
    cancel_subscription: "Cancel subscription",
    actions: {
      admin_bypass:
        "You're on an admin bypass — no Stripe subscription needed.",
      upgrade_pro: "Upgrade to Pro · {price}",
      upgrade_student: "Student · {price} (academic email required)",
      opening: "Opening…",
      manage_sub: "Manage subscription",
      add_credits: "Add credits",
      topup_500: "+500 credits · {price}",
      topup_2000: "+2000 credits · {price} (save 25%)",
      topup_expiry: "Top-up credits expire 90 days after purchase.",
      stepping_away: "Stepping away?",
      extend_retention: "Extend data retention · {price} (12 months)",
      extend_retention_help:
        "Default: 120-day grace after cancel. This extends to 12 months.",
    },
  },
  legal: {
    privacy_title: "Privacy Policy",
    terms_title: "Terms of Service",
    placeholder:
      "This document is a placeholder for the α version. It will be replaced before general release.",
  },
  seed_prompts: {
    review_recent_mistakes:
      "From my mistakes notebook over the past week, pick the 3 most worth reviewing and briefly summarize the key point of each.",
    generate_similar_problems:
      "Based on the patterns in my mistakes notebook from the past week, create 3 practice problems in a similar format. Keep the answers hidden.",
  },
};

export type Messages = MessagesShape;
