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
      voice_or_type: string;
      you_type_label: string;
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
    hero_animation: {
      chat_header: string;
      message_placeholder: string;
      extracting: string;
      imported_summary: string;
      classes_heading: string;
      term_label: string;
      calendar_heading: string;
      week_range: string;
      days: string[];
      classes: {
        new: string;
        eng200: string;
        bio110: string;
        psy100: string;
        hst101: string;
      };
      events: {
        math_lec: string;
        math_tut: string;
        math_quiz: string;
        hw1_due: string;
      };
    };
    voice_demo: {
      phrase_1: string;
      phrase_2: string;
      phrase_3: string;
      raw_phrase_1: string;
      raw_phrase_2: string;
      raw_phrase_3: string;
      cleaned_phrase: string;
      noise_hint: string;
      listening: string;
      processing: string;
      hold_to_talk: string;
    };
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
    no_term: string;
    no_term_set: string;
    chats_for_class_aria: string;
    no_chats_tagged_title: string;
    no_chats_tagged_desc: string;
    start_a_chat: string;
    untitled_chat: string;
    actions: {
      edit: string;
      delete: string;
      cancel: string;
      save: string;
      saving: string;
      menu_label: string;
    };
    edit_class: {
      button: string;
      title: string;
      name_label: string;
      code_label: string;
      term_label: string;
      professor_label: string;
      color_label: string;
      saved_toast: string;
      save_failed: string;
    };
    delete_class: {
      button: string;
      confirm_title: string;
      confirm_body: string;
      confirm_body_no_cascade: string;
      success_toast: string;
      delete_failed: string;
    };
    syllabus: {
      edit_title: string;
      edit_term: string;
      edit_modal_title: string;
      empty_title: string;
      empty_description: string;
      upload_pdf: string;
      paste_url: string;
      open_original: string;
      source: string;
      delete_confirm_title: string;
      delete_confirm_body: string;
      saved_toast: string;
      deleted_toast: string;
      save_failed: string;
      delete_failed: string;
    };
    assignments: {
      edit_title: string;
      edit_due: string;
      edit_status: string;
      edit_priority: string;
      edit_notes: string;
      status_not_started: string;
      status_in_progress: string;
      status_done: string;
      priority_low: string;
      priority_medium: string;
      priority_high: string;
      priority_none: string;
      no_due: string;
      due_short: string;
      priority_inline: string;
      delete_confirm_title: string;
      delete_confirm_body: string;
      saved_toast: string;
      deleted_toast: string;
      save_failed: string;
      delete_failed: string;
    };
    mistakes_grid: {
      empty_title: string;
      empty_description: string;
      open_chat: string;
      delete_confirm_title: string;
      delete_confirm_body: string;
      deleted_toast: string;
      delete_failed: string;
    };
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
    delete_button: string;
    delete_confirm_title: string;
    delete_confirm_body: string;
    deleted_toast: string;
    delete_failed: string;
  };
  login: { title: string; subtitle: string; button: string };
  onboarding: {
    step1: {
      title: string;
      one_line: string;
      why_title: string;
      why_calendar_gmail: string;
      why_notion: string;
      button: string;
    };
    step2: {
      title: string;
      one_line: string;
      why_title: string;
      why_body: string;
      skip: string;
      connect_link: string;
      add_url_link: string;
      sources: {
        microsoft: { label: string; one_line: string };
        ical: { label: string; one_line: string };
        notion: { label: string; one_line: string };
      };
    };
  };
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
    pending_label: string;
    youre_clear: string;
    item_singular: string;
    item_plural: string;
    open_inbox: string;
  };
  inbox: {
    title: string;
    subhead: string;
    empty_no_gmail_title: string;
    empty_no_gmail_description: string;
    empty_no_gmail_action: string;
    empty_clear_title: string;
    empty_clear_description: string;
    pending_review_sr: string;
    tier_high: string;
    tier_medium: string;
    tier_low: string;
    tier_classifying: string;
    tier_ignore: string;
    new_sender_pill: string;
    question_pill: string;
    question_pill_title: string;
    important_pill: string;
    important_pill_title: string;
    no_subject: string;
    noticed: string;
    proposal_pill: string;
    action_pill: string;
    status_pending: string;
    status_resolved: string;
    status_dismissed: string;
  };
  calendar: {
    title: string;
    today: string;
    prev_aria: string;
    next_aria: string;
    new_event: string;
    reconnect_for_tasks: string;
    reconnect_button: string;
    error_create_event: string;
    error_update_event: string;
    error_delete_event: string;
    error_create_task: string;
    error_update_task: string;
    error_delete_task: string;
    view_month: string;
    view_week: string;
    view_day: string;
    event_panel: {
      edit_event: string;
      new_event: string;
      edit_task: string;
      new_task: string;
      close: string;
      field_title: string;
      field_all_day: string;
      field_start: string;
      field_end: string;
      field_recurrence: string;
      field_location: string;
      field_description: string;
      field_reminder: string;
      field_due: string;
      field_notes: string;
      field_completed: string;
      placeholder_title: string;
      placeholder_location: string;
      placeholder_description: string;
      placeholder_notes: string;
      series_instance_note: string;
      minutes_before: string;
      cancel: string;
      confirm: string;
      delete: string;
      save: string;
      create: string;
      all_day_aria: string;
      completed_aria: string;
    };
    recurrence: {
      preset_none: string;
      preset_daily: string;
      preset_weekly: string;
      preset_monthly: string;
      preset_custom: string;
      end_never: string;
      end_until: string;
      end_count: string;
      custom_advanced: string;
      advanced_note: string;
      occurrences: string;
    };
  };
  tasks: {
    title: string;
    pending_count: string;
    empty_title: string;
    empty_description: string;
    empty_browse_classes: string;
    source_steadii: string;
    source_google: string;
    source_microsoft: string;
    aria_pending_tasks: string;
    no_due_date: string;
    in_progress: string;
    high_priority: string;
    overdue_days: string;
    due_today: string;
    due_tomorrow: string;
    due_in_days: string;
    due_short_date: string;
  };
  chats_list: {
    title: string;
    new_chat: string;
    empty_title: string;
    empty_description: string;
    empty_action: string;
    aria: string;
  };
  chat_view: {
    title_placeholder: string;
    new_chat: string;
    delete: string;
    blob_disabled_prefix: string;
    blob_disabled_suffix: string;
    uploading: string;
    upload_failed_http: string;
    attach_aria: string;
    send_aria: string;
    thinking_aria: string;
    attach_disabled_title: string;
    set_stream_send_failed: string;
    set_stream_action_failed: string;
  };
  agent: {
    draft_actions: {
      header_draft: string;
      to: string;
      cc: string;
      save_edits: string;
      cancel: string;
      send: string;
      edit: string;
      dismiss: string;
      sent_dispatching: string;
      undo: string;
      sent_automatically: string;
      sent: string;
      toast_sent: string;
      toast_send_failed: string;
      toast_send_cancelled: string;
      toast_undo_failed: string;
      toast_dismissed: string;
      toast_dismiss_failed: string;
      toast_draft_updated: string;
      toast_save_failed: string;
    };
    proposed_actions: {
      toast_action_failed: string;
      toast_dismissed: string;
      toast_done: string;
    };
    role_picker: {
      aria: string;
      title: string;
      skip: string;
      class_label: string;
      class_none: string;
      new_class_link: string;
      new_class_placeholder: string;
      cancel: string;
      role_professor_label: string;
      role_professor_hint: string;
      role_ta_label: string;
      role_ta_hint: string;
      role_classmate_label: string;
      role_classmate_hint: string;
      role_admin_label: string;
      role_admin_hint: string;
      role_career_label: string;
      role_career_hint: string;
      role_personal_label: string;
      role_personal_hint: string;
      role_other_label: string;
      role_other_hint: string;
      toast_saved: string;
      toast_save_failed: string;
    };
  };
  app_layout: {
    sidebar_brand_aria: string;
    past_due_message: string;
    past_due_button: string;
    credits_exceeded: string;
    credits_used_pct: string;
    upgrade: string;
    top_up: string;
    manage: string;
    recent_chats: string;
    untitled: string;
    credits_unlimited_short: string;
    credits_remaining: string;
    credits_unlimited_aria: string;
    credits_used_aria: string;
    plan_admin: string;
    plan_pro: string;
    plan_student: string;
    plan_free: string;
    you_fallback: string;
    primary_aria: string;
  };
  offline_strip: {
    message: string;
  };
  views: {
    dead_db_banner: {
      heading_not_connected: string;
      heading_not_set_up: string;
      heading_deleted: string;
      message_not_connected: string;
      message_not_set_up: string;
      message_deleted: string;
      data_safe: string;
      reconnect_notion: string;
      resetup_notion: string;
    };
  };
  markdown_editor: {
    placeholder_title: string;
    placeholder_body: string;
    aria_bold: string;
    aria_italic: string;
    aria_inline_code: string;
    aria_bullet_list: string;
    aria_numbered_list: string;
    aria_inline_math: string;
    aria_block_math: string;
    aria_heading: string;
  };
  classes_list: {
    new_class_button: string;
    add_class_button: string;
    empty_title: string;
    empty_description: string;
    aria_classes: string;
    metadata_due: string;
    metadata_mistakes: string;
  };
  notifications: {
    saved_toast: string;
    save_failed: string;
    save: string;
    enabled: string;
    notify_immediately: string;
    morning_digest_label: string;
    morning_digest_hint: string;
    digest_hour_label: string;
    digest_hour_hint: string;
    undo_window_label: string;
    undo_window_hint: string;
    high_risk_push_label: string;
    high_risk_push_hint: string;
  };
  agent_rules_section: {
    global_rules: string;
    global_rules_caption: string;
    global_high: string;
    global_medium: string;
    global_low: string;
    global_ignore: string;
    global_ignore_why: string;
    learned_contacts: string;
    learned_contacts_caption: string;
    learned_empty: string;
    recent_feedback: string;
    recent_feedback_caption: string;
    feedback_empty: string;
    feedback_proposed: string;
    custom_overrides: string;
    custom_overrides_caption: string;
    custom_overrides_empty: string;
    reset: string;
    source_learned_title: string;
    source_manual_title: string;
    source_chat_title: string;
  };
  delete_rule_button: {
    toast_removed: string;
    toast_failed: string;
    aria: string;
  };
  cancel_form: {
    bullet_downgrade: string;
    bullet_data_preserved: string;
  };
  admin: {
    title: string;
    subtitle: string;
    stat_users: string;
    stat_credits_month: string;
    stat_input_tokens_month: string;
    stat_active_subs: string;
    top_users_heading: string;
    no_usage_yet: string;
    waitlist_heading: string;
    waitlist_body: string;
    waitlist_pending: string;
    invite_codes_heading: string;
    invite_codes_body: string;
    open_dashboard: string;
  };
  chat_input: {
    placeholder: string;
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
  voice: {
    hint_caps: string;
    hint_alt: string;
    listening_placeholder: string;
    processing_placeholder: string;
    error_mic_denied: string;
    error_transcribe_failed: string;
    error_rate_limited: string;
    error_agent_failed: string;
    error_operation_partial: string;
    warning_cleanup_skipped: string;
    confirmation_handoff: string;
    choice_label: string;
    choice_full_words: string;
    choice_full_chars: string;
    choice_short_words: string;
    choice_short_chars: string;
    global_listening: string;
    global_processing: string;
    global_hint_caps: string;
    global_hint_alt: string;
    overlay_label: string;
    overlay_placeholder: string;
    overlay_hint_caps: string;
    overlay_hint_alt: string;
  };
  settings: {
    title: string;
    sign_out: string;
    no_name: string;
    sections: {
      profile: string;
      connections: string;
      resources: string;
      agent: string;
      usage: string;
      appearance: string;
      language: string;
      timezone: string;
      voice: string;
      danger: string;
    };
    voice: {
      description: string;
      trigger_label: string;
      trigger_caps: string;
      trigger_alt: string;
      saved: string;
      hint_caps: string;
      hint_alt: string;
    };
    connections: {
      workspace_fallback: string;
      connected_to: string;
      setup_complete: string;
      setup_pending: string;
      not_connected: string;
      disconnect: string;
      connect: string;
      calendar_label: string;
      calendar_granted: string;
      calendar_missing: string;
      gmail_label: string;
      gmail_granted: string;
      gmail_missing: string;
      sign_out_to_reauth: string;
      refresh_inbox: string;
      refresh_inbox_title: string;
      manage_summary: string;
      manage_link: string;
    };
    resources: {
      description: string;
      not_connected_hint: string;
      add_placeholder: string;
      add_button: string;
      empty: string;
      auto_registered: string;
      manual: string;
      remove: string;
      refresh_from_notion: string;
    };
    agent_thinks: {
      section_title: string;
      description: string;
      open: string;
    };
    agent_rules: {
      section_title: string;
      description: string;
    };
    notifications_section: string;
    staged_autonomy: {
      section_title: string;
      description_prefix: string;
      description_em: string;
      description_suffix: string;
      toggle_label: string;
      on: string;
      off: string;
    };
    agent_modes: {
      destructive_only_label: string;
      destructive_only_hint: string;
      all_label: string;
      all_hint: string;
      none_label: string;
      none_hint: string;
      save: string;
    };
    usage: {
      credits_this_month: string;
      storage_label: string;
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
    danger_zone: {
      account_placeholder: string;
      account_button: string;
      wipe_data_button: string;
      wipe_data_description: string;
      wipe_modal: {
        title: string;
        list_header: string;
        list_classes: string;
        list_syllabi: string;
        list_mistakes: string;
        list_assignments: string;
        list_chats: string;
        list_inbox: string;
        list_proposals: string;
        list_integrations: string;
        list_blobs: string;
        stays_note: string;
        irreversible: string;
        type_to_confirm: string;
        type_to_confirm_placeholder: string;
        cancel: string;
        submit: string;
        submitting: string;
        success_toast: string;
        load_failed: string;
        wipe_failed: string;
      };
    };
  };
  billing: {
    page_title: string;
    page_subtitle: string;
    checkout_completed: string;
    checkout_canceled: string;
    founding_member_label: string;
    founding_member_body: string;
    price_locked_until: string;
    currency_locked: string;
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
    tagline: "AI secretary for your studies.",
  },
  landing: {
    headline: "AI secretary\nfor your studies.",
    subhead: "Type or talk — Steadii reads, writes, and remembers for you.",
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
        body: "Send needs one-click approval and rides a 10-second undo. Nothing leaves your account without you.",
      },
      yours: {
        title: "Your data stays yours",
        body: "Verbatim mistakes, syllabi, and tasks. Yours to read, search, and export — never locked in.",
      },
    },
    what_you_do: {
      title: "Just chat.\nSteadii does the rest.",
      subhead:
        "No buttons to find, no menus to navigate. The chat input is the entire app.",
      voice_or_type: "Say or type — both feel native.",
      you_type_label: "You type",
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
      title: "Get started in three steps.",
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
      title: "All reasoning, all decisions — visible.",
      paragraph_reasoning:
        "Every reason behind every decision is visible. Click the reasoning panel under any draft and you see what the agent read, what it weighed, and which past emails it cited.",
      paragraph_yours:
        "Your data stays yours. Verbatim mistakes, syllabi, and assignments. Yours to read, search, and export — never locked in.",
      paragraph_confirm:
        "Nothing sends without you. Every outgoing message rides a 10-second undo and your explicit approval. The staged-autonomy mode that auto-sends low-stakes drafts is opt-in and per-user.",
    },
    founding: {
      headline: "α is invite-only.",
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
    hero_animation: {
      chat_header: "Chat · Steadii",
      message_placeholder: "Message Steadii…",
      extracting: "Extracting syllabus…",
      imported_summary:
        "Imported. Syllabus: <highlight>Math II (Linear Algebra)</highlight>. <highlight>7</highlight> schedule items.",
      classes_heading: "Classes",
      term_label: "Spring 2026",
      calendar_heading: "Calendar",
      week_range: "Apr 27 – May 3",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      classes: {
        new: "Math II · Linear Algebra",
        eng200: "ENG 200 · Lit Survey",
        bio110: "BIO 110 · Cell Biology",
        psy100: "PSY 100 · Intro Psych",
        hst101: "HST 101 · World History",
      },
      events: {
        math_lec: "Math II — Lec",
        math_tut: "Math II — Tut",
        math_quiz: "Math II Quiz",
        hw1_due: "HW1 due",
      },
    },
    voice_demo: {
      phrase_1: "MAT223 report due tomorrow",
      phrase_2: "Move calculus midterm to Friday",
      phrase_3: "Add task: read Chapter 5",
      raw_phrase_1: "uh, MAT223 report, like, it's due tomorrow",
      raw_phrase_2: "the calculus midterm, um, move it to Friday",
      raw_phrase_3: "uh, add task, read chapter 5",
      cleaned_phrase: "MAT223 report due tomorrow",
      noise_hint: "Filler words and false starts cleaned up automatically",
      listening: "Listening",
      processing: "Processing…",
      hold_to_talk: "Hold Caps Lock to talk",
    },
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
      "Ask Steadii to add one from chat, e.g. 'Add a physics assignment'.",
    no_term: "(no term)",
    no_term_set: "No term set",
    chats_for_class_aria: "Chats for this class",
    no_chats_tagged_title: "No chats tagged to this class yet.",
    no_chats_tagged_desc:
      "Start a chat and Steadii will auto-tag when you mention the class.",
    start_a_chat: "Start a chat",
    untitled_chat: "Untitled chat",
    actions: {
      edit: "Edit",
      delete: "Delete",
      cancel: "Cancel",
      save: "Save",
      saving: "Saving…",
      menu_label: "More actions",
    },
    edit_class: {
      button: "Edit class",
      title: "Edit class",
      name_label: "Name",
      code_label: "Code",
      term_label: "Term",
      professor_label: "Professor",
      color_label: "Color",
      saved_toast: "Class updated.",
      save_failed: "Couldn't save class.",
    },
    delete_class: {
      button: "Delete class",
      confirm_title: "Delete {name}?",
      confirm_body:
        "This will also delete {syllabi} syllabi, {assignments} tasks, and {mistakes} mistake notes. Chats referencing this class will be untagged but kept.",
      confirm_body_no_cascade:
        "This class has no syllabi, tasks, or mistake notes. Chats referencing this class will be untagged but kept.",
      success_toast: "Deleted {name}.",
      delete_failed: "Couldn't delete class.",
    },
    syllabus: {
      edit_title: "Title",
      edit_term: "Term",
      edit_modal_title: "Edit syllabus",
      empty_title: "No syllabus saved for {className}.",
      empty_description:
        "Drop a PDF, paste a URL, or upload an image and Steadii will extract the structure.",
      upload_pdf: "Upload PDF",
      paste_url: "Paste URL",
      open_original: "Open original",
      source: "Source",
      delete_confirm_title: "Delete this syllabus?",
      delete_confirm_body:
        "Calendar events already imported won't be affected.",
      saved_toast: "Syllabus updated.",
      deleted_toast: "Syllabus deleted.",
      save_failed: "Couldn't save syllabus.",
      delete_failed: "Couldn't delete syllabus.",
    },
    assignments: {
      edit_title: "Title",
      edit_due: "Due",
      edit_status: "Status",
      edit_priority: "Priority",
      edit_notes: "Notes",
      status_not_started: "Not started",
      status_in_progress: "In progress",
      status_done: "Done",
      priority_low: "Low",
      priority_medium: "Medium",
      priority_high: "High",
      priority_none: "—",
      no_due: "No due",
      due_short: "due {date}",
      priority_inline: "priority: {value}",
      delete_confirm_title: "Delete this task?",
      delete_confirm_body:
        "Pending Steadii proposals referencing it may break.",
      saved_toast: "Task updated.",
      deleted_toast: "Task deleted.",
      save_failed: "Couldn't save task.",
      delete_failed: "Couldn't delete task.",
    },
    mistakes_grid: {
      empty_title: "No mistake notes for {className} yet.",
      empty_description:
        "Paste a problem image in chat and ask for an explanation, or scan a handwritten page with the button above.",
      open_chat: "Open chat",
      delete_confirm_title: "Delete this mistake note?",
      delete_confirm_body: "You can recreate it from chat anytime.",
      deleted_toast: "Mistake note deleted.",
      delete_failed: "Couldn't delete mistake note.",
    },
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
    delete_button: "Delete",
    delete_confirm_title: "Delete this mistake note?",
    delete_confirm_body: "You can recreate it from chat anytime.",
    deleted_toast: "Mistake note deleted.",
    delete_failed: "Couldn't delete mistake note.",
  },
  login: {
    title: "Welcome back",
    subtitle: "Sign in with your university Google account.",
    button: "Continue with Google",
  },
  onboarding: {
    step1: {
      title: "Connect Google",
      one_line:
        "One consent grants Calendar + Gmail so Steadii can schedule, triage, and draft.",
      why_title: "What does this grant?",
      why_calendar_gmail:
        "Read + write access to your Calendar and read/modify/send on Gmail. The agent triages incoming mail and prepares drafts for your review — nothing sends without your confirmation and a 20-second undo window. You can revoke access anytime from your Google account.",
      why_notion:
        "Notion is optional and lives in Settings → Connections — connect it to import your existing classes, mistakes, syllabi, and assignments into Steadii.",
      button: "Grant Google access",
    },
    step2: {
      title: "Add more sources (optional)",
      one_line:
        "These widen what Steadii can see — Outlook, school timetables, Notion. Skip whatever you don't use.",
      why_title: "What gets connected?",
      why_body:
        "Each source plugs into the same calendar + tasks pipeline as Google. Microsoft 365 mirrors Outlook events and To Do tasks; an iCal subscription pulls a school timetable feed every 6 hours; Notion imports your existing classes and notes. You can add or remove any of these later from Settings → Connections.",
      skip: "Skip for now",
      connect_link: "Connect →",
      add_url_link: "Add URL →",
      sources: {
        microsoft: {
          label: "Microsoft 365",
          one_line:
            "Bring your Outlook calendar and Microsoft To Do into Steadii alongside Google.",
        },
        ical: {
          label: "iCal subscription",
          one_line:
            "Paste a school timetable URL (.ics) so deadlines show up in Steadii's planning.",
        },
        notion: {
          label: "Notion",
          one_line:
            "Import your existing classes, mistakes, syllabi, and assignments from Notion.",
        },
      },
    },
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
    contact_email: "hello@mysteadii.com",
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
    pending_label: "Pending",
    youre_clear: "You're clear.",
    item_singular: "item",
    item_plural: "items",
    open_inbox: "Open inbox",
  },
  inbox: {
    title: "Inbox",
    subhead: "What the agent is looking at right now.",
    empty_no_gmail_title: "Connect Gmail to start triage.",
    empty_no_gmail_description:
      "Sign in again with Google to grant the Gmail scope. The agent triages, you confirm.",
    empty_no_gmail_action: "Reconnect in Settings",
    empty_clear_title: "You're clear.",
    empty_clear_description:
      "Nothing pending. The agent will surface new items as they arrive.",
    pending_review_sr: "Pending review.",
    tier_high: "High",
    tier_medium: "Medium",
    tier_low: "Low",
    tier_classifying: "Classifying",
    tier_ignore: "Ignore",
    new_sender_pill: "New sender",
    question_pill: "Question",
    question_pill_title: "Steadii needs you to clarify before drafting.",
    important_pill: "Important",
    important_pill_title: "Steadii flagged this as important. No reply needed.",
    no_subject: "(no subject)",
    noticed: "Steadii noticed",
    proposal_pill: "Proposal",
    action_pill: "Action",
    status_pending: "Pending — pick an action",
    status_resolved: "Resolved",
    status_dismissed: "Dismissed",
  },
  calendar: {
    title: "Calendar",
    today: "Today",
    prev_aria: "Previous",
    next_aria: "Next",
    new_event: "New event",
    reconnect_for_tasks:
      "Reconnect Google to enable Tasks — your current sign-in doesn't include task access.",
    reconnect_button: "Reconnect",
    error_create_event: "Failed to create event",
    error_update_event: "Failed to update event",
    error_delete_event: "Failed to delete event",
    error_create_task: "Failed to create task",
    error_update_task: "Failed to update task",
    error_delete_task: "Failed to delete task",
    view_month: "month",
    view_week: "week",
    view_day: "day",
    event_panel: {
      edit_event: "Edit event",
      new_event: "New event",
      edit_task: "Edit task",
      new_task: "New task",
      close: "Close",
      field_title: "Title",
      field_all_day: "All-day",
      field_start: "Start",
      field_end: "End",
      field_recurrence: "Recurrence",
      field_location: "Location",
      field_description: "Description",
      field_reminder: "Reminder",
      field_due: "Due",
      field_notes: "Notes",
      field_completed: "Completed",
      placeholder_title: "Add a title",
      placeholder_location: "Add location",
      placeholder_description: "Notes, links, agenda…",
      placeholder_notes: "Notes, links…",
      series_instance_note: "Part of a series — editing this instance only.",
      minutes_before: "minutes before",
      cancel: "Cancel",
      confirm: "Confirm",
      delete: "Delete",
      save: "Save",
      create: "Create",
      all_day_aria: "All-day",
      completed_aria: "Completed",
    },
    recurrence: {
      preset_none: "Does not repeat",
      preset_daily: "Daily",
      preset_weekly: "Weekly",
      preset_monthly: "Monthly",
      preset_custom: "Custom weekly…",
      end_never: "No end",
      end_until: "Ends on",
      end_count: "Ends after",
      custom_advanced: "Custom (advanced)",
      advanced_note:
        "Editing this rule isn't supported in the UI yet — other fields are still editable.",
      occurrences: "occurrences",
    },
  },
  tasks: {
    title: "Tasks",
    pending_count: "{count} pending",
    empty_title: "No tasks pending.",
    empty_description:
      "Add an assignment to a class, or connect Google Tasks / Microsoft To Do, and they'll show up here. The agent surfaces deadline-during-travel and workload spikes proactively.",
    empty_browse_classes: "Browse classes",
    source_steadii: "Steadii",
    source_google: "Google",
    source_microsoft: "Microsoft",
    aria_pending_tasks: "Pending tasks",
    no_due_date: "No due date",
    in_progress: "in progress",
    high_priority: "high priority",
    overdue_days: "Overdue {n}d",
    due_today: "Due today",
    due_tomorrow: "Due tomorrow",
    due_in_days: "Due in {n}d",
    due_short_date: "Due {date}",
  },
  chats_list: {
    title: "Chats",
    new_chat: "New chat",
    empty_title: "No chats yet.",
    empty_description: "Start a conversation from Home.",
    empty_action: "Start a conversation",
    aria: "Chats",
  },
  chat_view: {
    title_placeholder: "Untitled chat",
    new_chat: "New chat",
    delete: "Delete",
    blob_disabled_prefix: "Image and PDF uploads are disabled until",
    blob_disabled_suffix: "is set. Ask the administrator.",
    uploading: "Uploading {filename}",
    upload_failed_http: "Upload failed (HTTP {status}).",
    attach_aria: "Attach",
    send_aria: "Send",
    thinking_aria: "Thinking",
    attach_disabled_title:
      "Image uploads require Vercel Blob. Ask the administrator to configure BLOB_READ_WRITE_TOKEN.",
    set_stream_send_failed: "Failed to send message.",
    set_stream_action_failed: "Failed to send action.",
  },
  agent: {
    draft_actions: {
      header_draft: "Draft",
      to: "To:",
      cc: "Cc:",
      save_edits: "Save edits",
      cancel: "Cancel",
      send: "Send",
      edit: "Edit",
      dismiss: "Dismiss",
      sent_dispatching: "Sent — dispatches in {n}s.",
      undo: "Undo",
      sent_automatically: "Sent automatically",
      sent: "Sent",
      toast_sent: "Sent · undo in {n}s",
      toast_send_failed: "Send failed",
      toast_send_cancelled: "Send cancelled",
      toast_undo_failed: "Undo failed",
      toast_dismissed: "Dismissed",
      toast_dismiss_failed: "Dismiss failed",
      toast_draft_updated: "Draft updated",
      toast_save_failed: "Save failed",
    },
    proposed_actions: {
      toast_action_failed: "Action failed: {text}",
      toast_dismissed: "Dismissed",
      toast_done: "{label} — done",
    },
    role_picker: {
      aria: "Classify sender",
      title: "New sender — help Steadii classify (optional)",
      skip: "Skip",
      class_label: "Class (optional):",
      class_none: "— none —",
      new_class_link: "+ Type new class name",
      new_class_placeholder: "e.g. MAT235",
      cancel: "Cancel",
      role_professor_label: "Professor",
      role_professor_hint: "Course instructor",
      role_ta_label: "TA",
      role_ta_hint: "Teaching assistant / tutor",
      role_classmate_label: "Classmate",
      role_classmate_hint: "Fellow student",
      role_admin_label: "Admin",
      role_admin_hint: "Registrar, advising, IT",
      role_career_label: "Career",
      role_career_hint: "Recruiter, interviewer",
      role_personal_label: "Personal",
      role_personal_hint: "Family, friends, club",
      role_other_label: "Other",
      role_other_hint: "Skip-able catch-all",
      toast_saved: "Saved: {sender} → {role}",
      toast_save_failed: "Save failed",
    },
  },
  app_layout: {
    sidebar_brand_aria: "Steadii home",
    past_due_message:
      "Your last payment failed. Update your card to keep Pro access — Stripe will retry automatically over the next two weeks before we downgrade to Free.",
    past_due_button: "Update payment",
    credits_exceeded:
      "Out of credits this cycle ({used} / {limit}). Chat continues; agent drafts and other metered features pause until reset or top-up.",
    credits_used_pct:
      "You've used {pct}% of your cycle credits ({used} / {limit}).",
    upgrade: "Upgrade",
    top_up: "Top up",
    manage: "Manage",
    recent_chats: "Recent chats",
    untitled: "Untitled",
    credits_unlimited_short: "∞ credits",
    credits_remaining: "{n} credits left",
    credits_unlimited_aria: "Credits: unlimited (admin)",
    credits_used_aria: "Credits: {used} of {limit} used",
    plan_admin: "Admin",
    plan_pro: "Pro",
    plan_student: "Student",
    plan_free: "Free",
    you_fallback: "You",
    primary_aria: "Primary",
  },
  offline_strip: {
    message: "Offline — changes will sync when reconnected.",
  },
  views: {
    dead_db_banner: {
      heading_not_connected: "Notion connection expired.",
      heading_not_set_up: "Setup hasn't run yet.",
      heading_deleted: "Steadii workspace missing.",
      message_not_connected: "Notion isn't connected yet. Connect it in Settings.",
      message_not_set_up:
        "Your Steadii workspace in Notion hasn't been set up. Run setup to continue.",
      message_deleted:
        "The Steadii workspace in Notion looks gone. Click below to recreate it — existing Notion pages outside the workspace aren't touched.",
      data_safe: "Your data is safe.",
      reconnect_notion: "Reconnect Notion",
      resetup_notion: "Re-setup Notion",
    },
  },
  markdown_editor: {
    placeholder_title: "Mistake title",
    placeholder_body:
      "Markdown body. Math via $...$ inline or $$...$$ block. Images: ![](url).",
    aria_bold: "Bold",
    aria_italic: "Italic",
    aria_inline_code: "Inline code",
    aria_bullet_list: "Bullet list",
    aria_numbered_list: "Numbered list",
    aria_inline_math: "Inline math",
    aria_block_math: "Block math",
    aria_heading: "Heading",
  },
  classes_list: {
    new_class_button: "+ New class",
    add_class_button: "+ Add class",
    empty_title: "No classes yet.",
    empty_description:
      "Classes are Steadii's core unit. Add one to start tracking assignments, mistakes, and syllabi.",
    aria_classes: "Classes",
    metadata_due: "{n} due",
    metadata_mistakes: "{n} mistakes",
  },
  notifications: {
    saved_toast: "Notification settings saved",
    save_failed: "Save failed",
    save: "Save",
    enabled: "Enabled",
    notify_immediately: "Notify me immediately",
    morning_digest_label: "Morning digest",
    morning_digest_hint:
      "One summary email per day with pending drafts. No body previews — you confirm in Steadii.",
    digest_hour_label: "Digest hour (local)",
    digest_hour_hint:
      "What time in your timezone to send the digest. Memory-locked default is 7am.",
    undo_window_label: "Undo window",
    undo_window_hint:
      "Seconds between Send and actual Gmail delivery. 10 feels fast; 60 is forgiving.",
    high_risk_push_label: "High-risk push",
    high_risk_push_hint:
      "Immediate notification when a high-risk draft lands. Pushes arrive once mobile ships — toggle is saved for later.",
  },
  agent_rules_section: {
    global_rules: "Global rules",
    global_rules_caption: "— operator-maintained, read-only",
    global_high: "AUTO-HIGH keywords",
    global_medium: "AUTO-MEDIUM keywords",
    global_low: "AUTO-LOW keywords",
    global_ignore: "IGNORE — promo sender hints",
    global_ignore_why:
      "List-Unsubscribe header + promo-domain substring = ignore bucket.",
    learned_contacts: "Learned contacts",
    learned_contacts_caption: "— grows from the role picker + future chat feedback",
    learned_empty:
      "No learned rules yet. The agent will add rows here as you confirm first-time senders and correct its triage.",
    recent_feedback: "Recent feedback",
    recent_feedback_caption:
      "— last 30 days, per sender. Bias the agent toward the choices you've actually been making.",
    feedback_empty:
      "No feedback recorded yet. Each time you Send, Edit, or Dismiss a draft, Steadii records the choice here so the classifier can learn your preferences for that sender.",
    feedback_proposed: "proposed",
    custom_overrides: "Custom overrides",
    custom_overrides_caption: "— coming after α",
    custom_overrides_empty:
      "Natural-language rules (\"Only ask me for explicit confirm on professor emails about grading\") land in a later update — they route through the agent and save as a structured rule here.",
    reset: "Reset",
    source_learned_title: "Learned from prior interactions",
    source_manual_title: "Manually set via role picker",
    source_chat_title: "Set via chat",
  },
  delete_rule_button: {
    toast_removed: "Rule removed",
    toast_failed: "Delete failed",
    aria: "Remove rule",
  },
  cancel_form: {
    bullet_downgrade: "After that, your account downgrades to Free.",
    bullet_data_preserved:
      "Your data is preserved for 120 days — resubscribe any time during that window and pick up where you left off.",
  },
  admin: {
    title: "Admin",
    subtitle: "Visible only while your user row has is_admin=true.",
    stat_users: "Users",
    stat_credits_month: "Credits (this month)",
    stat_input_tokens_month: "Input tokens (this month)",
    stat_active_subs: "Active Stripe subs",
    top_users_heading: "Top users by credits (this month)",
    no_usage_yet: "No usage this month yet.",
    waitlist_heading: "α access waitlist",
    waitlist_body:
      "Approve requests, generate Stripe Promotion Codes, send invite emails.",
    waitlist_pending: "{n} pending",
    invite_codes_heading: "Invite codes",
    invite_codes_body:
      "Friend invites are now Stripe Promotion Codes backed by the FRIEND_3MO coupon (100% off for 3 months). Create individual single-use codes in the Stripe Dashboard — no in-app issuance UI.",
    open_dashboard: "Open coupon in Stripe Dashboard →",
  },
  chat_input: {
    placeholder: "Ask Steadii…",
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
  voice: {
    hint_caps: "Hold Caps Lock to talk · Tap to chat from any page",
    hint_alt: "Hold ⌥ to talk · Tap to chat from any page",
    listening_placeholder: "Listening…",
    processing_placeholder: "Processing…",
    error_mic_denied: "Mic blocked. Allow microphone access in browser settings.",
    error_transcribe_failed: "Couldn't read that. Try again.",
    error_rate_limited: "Too many voice requests. Wait a moment.",
    error_agent_failed: "Steadii couldn't understand — try rephrasing.",
    error_operation_partial: "Some actions didn't complete — please retry in the UI.",
    warning_cleanup_skipped: "Used raw transcript (cleanup skipped).",
    confirmation_handoff: "Action needs your confirmation — opening chat.",
    choice_label: "Pick voice message length",
    choice_full_words: "Send full (~{n}w)",
    choice_full_chars: "Send full (~{n}字)",
    choice_short_words: "Send short (~{n}w)",
    choice_short_chars: "Send short (~{n}字)",
    global_listening: "Listening to Steadii…",
    global_processing: "Working on it…",
    global_hint_caps: "Tap Caps Lock to chat · Hold to talk",
    global_hint_alt: "Tap ⌥ to chat · Hold to talk",
    overlay_label: "Steadii chat",
    overlay_placeholder: "Ask Steadii anything…",
    overlay_hint_caps: "Tap Caps Lock again to close · Hold to talk",
    overlay_hint_alt: "Tap ⌥ again to close · Hold to talk",
  },
  settings: {
    title: "Settings",
    sign_out: "Sign out",
    no_name: "(no name)",
    sections: {
      profile: "Profile",
      connections: "Connections",
      resources: "Resources",
      agent: "Agent behavior",
      usage: "Usage & billing",
      appearance: "Appearance",
      language: "Language",
      timezone: "Time zone",
      voice: "Voice input",
      danger: "Danger zone",
    },
    voice: {
      description:
        "Hold a key to talk to Steadii — release to send. Caps Lock is the default; switch to the Right Option (⌥) key if your browser doesn't release Caps Lock cleanly.",
      trigger_label: "Trigger key",
      trigger_caps: "Caps Lock (default)",
      trigger_alt: "Right Option (⌥)",
      saved: "Saved",
      hint_caps: "Hold Caps Lock to talk",
      hint_alt: "Hold ⌥ to talk",
    },
    connections: {
      workspace_fallback: "workspace",
      connected_to: "Connected to {workspaceName}",
      setup_complete: "setup complete",
      setup_pending: "setup pending",
      not_connected: "Not connected",
      disconnect: "Disconnect",
      connect: "Connect",
      calendar_label: "Google Calendar",
      calendar_granted: "Calendar scope granted.",
      calendar_missing: "Calendar scope missing.",
      gmail_label: "Gmail",
      gmail_granted:
        "Gmail scope granted. The agent can triage and draft replies.",
      gmail_missing:
        "Gmail scope missing — sign out and sign back in to grant it.",
      sign_out_to_reauth: "Sign out to re-auth",
      refresh_inbox: "Refresh inbox",
      refresh_inbox_title: "Re-ingest the last 24 hours of Gmail",
      manage_summary:
        "Notion, Google, Microsoft 365, and iCal feeds.",
      manage_link: "Manage connections",
    },
    resources: {
      description:
        "Optional Notion pages the agent can read. Pages under the Steadii parent auto-register; add extra ones with a URL. Steadii's academic data lives in Postgres — this section only matters if you also want the agent to quote from your existing Notion workspace.",
      not_connected_hint:
        "Notion is not connected. Connect it under Connections above to register Notion resources.",
      add_placeholder: "https://notion.so/...",
      add_button: "Add",
      empty: "No manual resources yet.",
      auto_registered: "auto-registered",
      manual: "manual",
      remove: "Remove",
      refresh_from_notion: "Refresh from Notion",
    },
    agent_thinks: {
      section_title: "How your agent thinks",
      description:
        "A read-only retrospective view of the agent's last decisions: what it surfaced, why, and which mistakes / syllabus chunks / calendar items / past emails grounded each draft. Glass-box transparency, end to end.",
      open: "Open",
    },
    agent_rules: {
      section_title: "Agent Rules",
      description:
        "Transparency is the promise. Every rule the agent uses to triage your inbox — global keyword lists, learned contacts, manual overrides — is listed below.",
    },
    notifications_section: "Notifications",
    staged_autonomy: {
      section_title: "Staged autonomy",
      description_prefix:
        "When on, Steadii sends low-stakes drafts (currently medium-tier replies — office hours, deadlines, scheduling acknowledgments) on its own. The 10-second undo still applies, and the inbox item is labeled ",
      description_em: "Sent automatically",
      description_suffix:
        " with the full glass-box reasoning visible. Off by default — you stay in the loop on every send.",
      toggle_label: "Auto-send eligible drafts (with 10s undo)",
      on: "On — turn off",
      off: "Off — turn on",
    },
    agent_modes: {
      destructive_only_label:
        "Only confirm destructive actions (recommended)",
      destructive_only_hint:
        "Creating or updating is automatic; deletions pause for approval.",
      all_label: "Confirm every write",
      all_hint:
        "Any change — create, update, delete — pauses for approval.",
      none_label: "Never ask",
      none_hint: "Steadii acts immediately. Use with care.",
      save: "Save",
    },
    usage: {
      credits_this_month: "Credits this month",
      storage_label: "Storage",
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
    danger_zone: {
      account_placeholder:
        "Delete account and all associated data. (Coming after α.)",
      account_button: "Delete account",
      wipe_data_button: "Delete all data",
      wipe_data_description:
        "Wipes your classes, tasks, syllabi, mistakes, chats, inbox, and uploads. Your account, billing, and OAuth connections stay.",
      wipe_modal: {
        title: "Permanently delete all your data?",
        list_header: "This will permanently delete:",
        list_classes: "{count} classes",
        list_syllabi: "{count} syllabi",
        list_mistakes: "{count} mistake notes",
        list_assignments: "{count} tasks",
        list_chats: "{count} chats ({messages} messages)",
        list_inbox: "{count} inbox items",
        list_proposals: "{count} proactive proposals",
        list_integrations: "{count} connected integrations",
        list_blobs: "{count} file uploads (~{size})",
        stays_note:
          "Your account, billing, and OAuth connections will stay.",
        irreversible: "This cannot be undone.",
        type_to_confirm: "Type DELETE to confirm",
        type_to_confirm_placeholder: "DELETE",
        cancel: "Cancel",
        submit: "Delete all data",
        submitting: "Deleting…",
        success_toast: "All data deleted. Welcome back to a clean slate.",
        load_failed: "Couldn't load data counts.",
        wipe_failed: "Couldn't delete data.",
      },
    },
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
    currency_locked:
      "Pricing locked to {currency} for this account. Reach out to support to change currency.",
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
          "Personal-information handler: Steadii (sole proprietor, contact via the email you used to sign up). For inquiries from Japanese-resident users specifically, write to hello@mysteadii.com with the subject line \"APPI request\".",
      },
      appi_request_procedure: {
        heading: "How to request disclosure, correction, or suspension of use",
        body:
          "You may request disclosure of your retained personal information, correction of inaccuracies, suspension of use, or deletion. Send an email to hello@mysteadii.com from the address registered on your account, stating which records you wish to access or change. We respond within 14 days. There is no fee.",
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
          "Questions or deletion requests: email hello@mysteadii.com, or reply to your onboarding email.",
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
