type MessagesShape = {
  brand: { name: string; tagline: string };
  landing: {
    headline: string;
    subhead: string;
    cta: string;
    cta_request_access: string;
    cta_already_approved: string;
    alpha: string;
    invite_hint: string;
    value_props: {
      triage: { title: string; body: string };
      glassbox: { title: string; body: string };
      confirm: { title: string; body: string };
      yours: { title: string; body: string };
    };
    what_you_do: {
      title: string;
      subhead: string;
      cards: {
        calendar: { input: string; action: string };
        syllabus: { input: string; action: string };
        absence: { input: string; action: string };
      };
    };
    steadii_in_motion: {
      title: string;
      body: string;
      real_screen: string;
      step_calendar: string;
      step_calendar_meta: string;
      step_notification: string;
      step_notification_meta: string;
      step_proposal: string;
      step_proposal_meta: string;
      action_email: string;
      action_reschedule: string;
      action_dismiss: string;
    };
    how_it_works: {
      title: string;
      steps: {
        connect: { title: string; body: string };
        watch: { title: string; body: string };
        trust: { title: string; body: string };
      };
    };
    glass_box: {
      title: string;
      paragraph_reasoning: string;
      paragraph_yours: string;
      paragraph_confirm: string;
    };
    founding: {
      headline: string;
      body: string;
      cta: string;
    };
    locale_toggle: {
      en: string;
      ja: string;
      aria_label: string;
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
    tasks: string;
    settings: string;
  };
  classes: {
    tabs: {
      syllabus: string;
      assignments: string;
      mistakes: string;
      chats: string;
    };
    no_assignments_title: string;
    no_assignments_desc: string;
  };
  mistakes: {
    add_from_photo: string;
    photo_upload_modal_title: string;
    photo_upload_modal_subtitle: string;
    photo_choose_file: string;
    photo_supported_formats: string;
    photo_extracting: string;
    photo_preview_label: string;
    photo_title_placeholder: string;
    photo_save_button: string;
    photo_cancel: string;
    photo_extract_failed: string;
    photo_save_failed: string;
  };
  login: { title: string; subtitle: string; button: string };
  request_access: {
    title: string;
    subtitle: string;
    email_label: string;
    name_label: string;
    university_label: string;
    reason_label: string;
    reason_placeholder: string;
    submit: string;
    error_invalid_email: string;
    error_rate_limited: string;
    back_to_landing: string;
  };
  access_pending: {
    title_ja: string;
    title_en: string;
    body_ja: string;
    body_en: string;
    already_submitted_hint: string;
    back_to_landing: string;
  };
  access_denied: {
    title_ja: string;
    title_en: string;
    body_ja: string;
    body_en: string;
    contact_label_ja: string;
    contact_label_en: string;
    contact_email: string;
    request_access_cta: string;
  };
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
  legal: {
    privacy_title: string;
    terms_title: string;
    placeholder: string;
    alpha_caveat: string;
    last_updated: string;
    last_updated_date: string;
    privacy: {
      what_we_collect: { heading: string; body: string };
      how_we_use_it: { heading: string; body: string };
      model_training: { heading: string; body: string };
      third_parties: { heading: string; body: string };
      data_location: { heading: string; body: string };
      retention_deletion: { heading: string; body: string };
      your_rights: { heading: string; body: string };
      alpha_caveat: { heading: string; body: string };
      appi_purpose: { heading: string; body: string };
      appi_third_party: { heading: string; body: string };
      appi_cross_border: { heading: string; body: string };
      appi_contact: { heading: string; body: string };
      appi_request_procedure: { heading: string; body: string };
    };
    terms: {
      alpha_status: { heading: string; body: string };
      acceptable_use: { heading: string; body: string };
      your_content: { heading: string; body: string };
      external_services: { heading: string; body: string };
      plan_limits: { heading: string; body: string };
      founding_member: { heading: string; body: string };
      termination: { heading: string; body: string };
      liability: { heading: string; body: string };
      contact: { heading: string; body: string };
    };
  };
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
    cta_request_access: "Request α access",
    cta_already_approved: "Already approved? Sign in",
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
        body: "Verbatim mistakes, syllabi, and tasks. Yours to read, search, and export — never locked in.",
      },
    },
    what_you_do: {
      title: "Just chat. Steadii does the rest.",
      subhead:
        "No buttons to find, no menus to navigate. The chat input is the entire app.",
      cards: {
        calendar: {
          input: "Meeting with Prof. Tanaka, Friday 2pm",
          action: "Calendar event added.",
        },
        syllabus: {
          input: "What's covered on the Math II midterm?",
          action:
            "Reads your syllabus → \"Chapter 3-5, midterm 5/16, focus on §3.4 limits.\"",
        },
        absence: {
          input: "I might not make it to campus tomorrow",
          action:
            "Drafts emails to tomorrow's professors and offers a calendar absence-mark.",
        },
      },
    },
    steadii_in_motion: {
      title: "And it watches your back.",
      body:
        "Steadii reads your syllabus, calendar, and recent mistakes — then surfaces what you'd otherwise miss.",
      real_screen: "Real screen. No mocks.",
      step_calendar: "Tokyo trip · 5/15 — 5/17",
      step_calendar_meta: "Calendar · 3-day event added",
      step_notification: "Important — schedule conflict",
      step_notification_meta:
        "5/16 Math II midterm overlaps with your Tokyo trip.",
      step_proposal: "Conflict found",
      step_proposal_meta:
        "Cited: syllabus §midterms · calendar · 2 prior reschedule emails",
      action_email: "Email professor",
      action_reschedule: "Reschedule trip",
      action_dismiss: "Dismiss",
    },
    how_it_works: {
      title: "How it works",
      steps: {
        connect: {
          title: "Connect",
          body: "Sign in with Google. Steadii reads your inbox + calendar. Setup ≈ 90 seconds.",
        },
        watch: {
          title: "Watch",
          body: "Steadii triages your emails, watches for conflicts, drafts replies. You see everything; nothing sends without you.",
        },
        trust: {
          title: "Trust",
          body: "Use the dismiss button when Steadii is wrong. It learns. The more you use it, the more it gets you.",
        },
      },
    },
    glass_box: {
      title: "Glass box, all the way down.",
      paragraph_reasoning:
        "Every reason behind every decision is visible. Click the reasoning panel under any draft and you see what the agent read, what it weighed, and which past emails it cited.",
      paragraph_yours:
        "Your data stays yours. Verbatim mistakes, syllabi, and assignments. Yours to read, search, and export — never locked in.",
      paragraph_confirm:
        "Nothing sends without you. Every outgoing message rides a 20-second undo and your explicit approval. The staged-autonomy mode that auto-sends low-stakes drafts is opt-in and per-user.",
    },
    founding: {
      headline: "α is invite-only — 10 students this round.",
      body:
        "Founding members get permanent price-lock at signup rate, plus early access to every feature ahead of NA public launch (Sept 2026).",
      cta: "Request α access",
    },
    locale_toggle: {
      en: "EN",
      ja: "JA",
      aria_label: "Language",
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
    tasks: "Tasks",
    settings: "Settings",
  },
  classes: {
    tabs: {
      syllabus: "Syllabus",
      // "Tasks" is the user-facing label; the URL key, schema table, and
      // route handler all stay `assignments` to avoid a migration.
      assignments: "Tasks",
      mistakes: "Mistakes",
      chats: "Chats",
    },
    no_assignments_title: "No tasks yet.",
    no_assignments_desc:
      "Ask Steadii to add one from chat, e.g. '物理の課題を追加して'.",
  },
  mistakes: {
    add_from_photo: "📷 Add from photo",
    photo_upload_modal_title: "Extract handwritten note",
    photo_upload_modal_subtitle:
      "Steadii reads the page verbatim — no summarizing, no interpreting.",
    photo_choose_file: "Choose file",
    photo_supported_formats: "PDF, PNG, JPEG, GIF, WebP",
    photo_extracting: "Extracting…",
    photo_preview_label: "Preview (editable)",
    photo_title_placeholder: "Title (e.g. 'Integration by parts — practice 3')",
    photo_save_button: "Save mistake note",
    photo_cancel: "Cancel",
    photo_extract_failed: "Couldn't read the file. Try again or use a clearer image.",
    photo_save_failed: "Couldn't save. Please try again.",
  },
  login: {
    title: "Welcome back",
    subtitle: "Sign in with your university Google account.",
    button: "Continue with Google",
  },
  request_access: {
    title: "Request α access",
    subtitle:
      "Steadii is invite-only during α. Tell us a little about yourself and we'll email you when you're approved (usually within 24h).",
    email_label: "Email",
    name_label: "Name (optional)",
    university_label: "University (optional)",
    reason_label: "What would you use Steadii for? (optional)",
    reason_placeholder:
      "e.g. I'm drowning in CS courseload emails, want help triaging.",
    submit: "Request access",
    error_invalid_email: "Please enter a valid email address.",
    error_rate_limited:
      "Too many requests from this network. Please try again in an hour.",
    back_to_landing: "← Back to home",
  },
  access_pending: {
    title_ja: "ありがとうございます。",
    title_en: "Thanks — request received.",
    body_ja:
      "承認されたら ご記入の email にお知らせします。通常 24 時間以内に確認します。",
    body_en:
      "We'll notify you by email when approved (usually within 24h).",
    already_submitted_hint:
      "It looks like you already requested access — we'll email you as soon as you're approved.",
    back_to_landing: "← Back to home",
  },
  access_denied: {
    title_ja: "α は招待制です。",
    title_en: "α is invite-only.",
    body_ja:
      "ご利用希望の方は下のメールアドレスまでご連絡ください。",
    body_en: "Contact the address below for access.",
    contact_label_ja: "お問い合わせ:",
    contact_label_en: "Contact:",
    contact_email: "hello@mysteadii.xyz",
    request_access_cta: "Request α access →",
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
      "Connect your first class to start seeing today's schedule, due tasks, and recent activity.",
    add_first_class: "+ Add your first class",
    welcome_input_placeholder:
      "or paste a syllabus, image, or ask anything…",
    greeting_morning: "Good morning, {name}.",
    greeting_afternoon: "Good afternoon, {name}.",
    greeting_evening: "Good evening, {name}.",
    greeting_night: "Still up, {name}?",
    summary_ready: "Your academic summary for the week is ready.",
    full_calendar: "Full calendar",
    assignments_remaining: "{count} tasks remaining today",
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
      "Add a chemistry task for Friday",
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
    alpha_caveat: "α — subject to change",
    last_updated: "Last updated",
    last_updated_date: "2026-04-25",
    privacy: {
      what_we_collect: {
        heading: "What we collect",
        body:
          "Steadii stores your Google profile (name, email, avatar), OAuth tokens for Google (Calendar + Gmail) and — only if you connect it — Notion, all AES-256-GCM encrypted at the application layer. We also store your classes, mistake notes, syllabi, and assignments in our Postgres database (Neon), your chat history, and the files you upload. We do not collect device fingerprints or tracking cookies.",
      },
      how_we_use_it: {
        heading: "How we use it",
        body:
          "Your data is used to (1) operate the product — answer chat messages, triage Gmail, read Google Calendar and Classroom feeds, store and retrieve your academic notes, (2) enforce plan limits (credits, storage), and (3) log errors for debugging. OpenAI requests include only the minimum context needed to answer the question.",
      },
      model_training: {
        heading: "Model training",
        body:
          "OpenAI's API does not train on your data by default, and Steadii does not enable training. No other model providers are used.",
      },
      third_parties: {
        heading: "Third parties",
        body:
          "Vercel (hosting, edge cache, blob storage), Neon (Postgres — primary store for your academic data), OpenAI (inference), Google (auth, Calendar, Classroom, Gmail), Notion (optional one-way import surface), Stripe (billing, test mode during α), Sentry (error tracking, with PII scrubbing on).",
      },
      data_location: {
        heading: "Data location",
        body:
          "Vercel and Neon both operate primarily in US regions during α. If you need EU- or JP-resident data storage, email the administrator before signing up.",
      },
      retention_deletion: {
        heading: "Retention and deletion",
        body:
          "You can delete your account at any time by emailing the administrator. On deletion, we remove rows from users, accounts, notion_connections, chats, messages, message_attachments, blob_assets (including the underlying Vercel Blob objects), registered_resources, audit_log, and usage_events within 30 days.",
      },
      your_rights: {
        heading: "Your rights",
        body:
          "You can request a copy of your data, corrections, or deletion at any time. Contact the administrator via the email you used to sign up.",
      },
      alpha_caveat: {
        heading: "α caveat",
        body:
          "This is the α version, running in invite-only mode with Stripe in test mode. Legal language here is a working draft and will be replaced before a β or public launch. We will notify you of material changes via the email you signed up with.",
      },
      appi_purpose: {
        heading: "Purpose of processing personal information",
        body:
          "We process personal information to operate the service, enforce plan limits, debug via error logs, and communicate with you about your account. We do not sell personal information and do not process it for advertising.",
      },
      appi_third_party: {
        heading: "Third-party processors and entrustment",
        body:
          "We entrust the following processors to operate the service: OpenAI (inference), Google (authentication, Calendar, Classroom, Gmail), Stripe (payments), Vercel (hosting, blob storage), Neon (Postgres database), and Sentry (error tracking). Each processor handles personal information only as instructed by Steadii and only to the extent necessary to provide its function.",
      },
      appi_cross_border: {
        heading: "Cross-border transfer of personal information",
        body:
          "OpenAI, Vercel, Neon, Stripe, and Sentry process personal information on servers operated primarily in the United States. Google services may process information across multiple regions. We have entered into appropriate contractual safeguards with each processor and confirmed each one operates a personal-information-protection program substantively equivalent to the standards required under Japan's Act on the Protection of Personal Information (APPI).",
      },
      appi_contact: {
        heading: "Personal-information-handler contact",
        body:
          "Personal-information handler: Steadii (sole proprietor, contact via the email you used to sign up). For inquiries from Japanese-resident users specifically, write to hello@mysteadii.xyz with the subject line \"APPI request\".",
      },
      appi_request_procedure: {
        heading: "How to request disclosure, correction, or suspension of use",
        body:
          "You may request disclosure of your retained personal information, correction of inaccuracies, suspension of use, or deletion. Send an email to hello@mysteadii.xyz from the address registered on your account, stating which records you wish to access or change. We respond within 14 days. There is no fee.",
      },
    },
    terms: {
      alpha_status: {
        heading: "Alpha status",
        body:
          "Steadii is in invite-only α. The product is provided as-is, may be changed or withdrawn at any time, and is not warranted fit for any particular purpose. Billing runs in Stripe test mode during α — no real charges post.",
      },
      acceptable_use: {
        heading: "Acceptable use",
        body:
          "Don't use Steadii to commit academic fraud. The agent is a study aid — it reasons, explains, and organizes. Submitting machine output as your own work on a graded assignment is your responsibility and may violate your institution's policies.",
      },
      your_content: {
        heading: "Your content",
        body:
          "You retain ownership of everything you put into Steadii — your classes, mistake notes, syllabi, attachments, chat messages, and any optional Notion pages you connect. You grant us a limited license to process this content solely to operate the service for you.",
      },
      external_services: {
        heading: "External services",
        body:
          "Steadii connects to Google services (Calendar, Classroom, Gmail), OpenAI, Vercel Blob, and Stripe. Notion is an optional integration. By using Steadii you also accept those services' terms. If any of them become unavailable, parts of Steadii will degrade gracefully.",
      },
      plan_limits: {
        heading: "Plan limits",
        body:
          "Free plan: 300 credits/month, 5 MB per file, 200 MB total storage. Pro and Student: 1,000 credits/month, 50 MB per file, 2 GB total storage. A credit is approximately $0.005 worth of model usage. Limits are subject to change with notice.",
      },
      founding_member: {
        heading: "Founding member price lock",
        body:
          "The first 100 paid Pro/Student users and all α invitees are designated Founding Members. Founding Members keep their signup price for as long as they maintain an active subscription, even if list prices change later. User 101 onward receives a 12-month price lock from their first paid period.",
      },
      termination: {
        heading: "Termination",
        body:
          "You can stop using Steadii at any time. We can revoke access if you violate these terms. On termination, your data is deleted per the Privacy Policy.",
      },
      liability: {
        heading: "Liability",
        body:
          "To the maximum extent permitted by law, Steadii is not liable for indirect, consequential, or incidental damages arising from use of the service, including missed deadlines or incorrect answers.",
      },
      contact: {
        heading: "Contact",
        body:
          "Questions or deletion requests: email hello@mysteadii.xyz, or reply to your onboarding email.",
      },
    },
  },
  seed_prompts: {
    review_recent_mistakes:
      "From my mistakes notebook over the past week, pick the 3 most worth reviewing and briefly summarize the key point of each.",
    generate_similar_problems:
      "Based on the patterns in my mistakes notebook from the past week, create 3 practice problems in a similar format. Keep the answers hidden.",
  },
};

export type Messages = MessagesShape;
