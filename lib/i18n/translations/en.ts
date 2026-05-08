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
      step1_label: string;
      step1_sender: string;
      step1_subject: string;
      step1_chip_tier: string;
      step1_chip_time: string;
      step1_classifying: string;
      step1_outcome: string;
      step1_outcome_meta: string;
      step2_label: string;
      step2_filter_all: string;
      step2_filter_hidden: string;
      step2_restore: string;
      step2_meta: string;
      step3_label: string;
      step3_sender: string;
      step3_subject: string;
      step3_chip_tier: string;
      step3_chip_time: string;
      step3_status: string;
      step3_meta: string;
    };
    boundaries: {
      title: string;
      subhead: string;
      cards: {
        learning: { who: string; key: string; body: string };
        deciding: { who: string; key: string; body: string };
        doing: { who: string; key: string; body: string };
      };
    };
    founding: {
      headline: string;
      sub: string;
      cta: string;
      cta_secondary: string;
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
      app_header: string;
      greeting: string;
      summary_ready: string;
      palette_placeholder: string;
      palette_typing_query: string;
      briefing_label: string;
      briefing_event: string;
      card_title: string;
      card_eta: string;
      card_body: string;
      card_bullet_1: string;
      card_bullet_2: string;
      card_bullet_3: string;
      card_action_open_calendar: string;
      card_action_mark_reviewed: string;
      card_dismiss_aria: string;
      chip_email: string;
      chip_mistake: string;
      chip_calendar: string;
      nav_home: string;
      nav_inbox: string;
      nav_calendar: string;
      nav_classes: string;
      nav_chats: string;
      nav_settings: string;
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
    activity: string;
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
    context_note: string;
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
  app: { welcome: string; empty_state: string; loading_aria: string };
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
    hidden_filter_aria: string;
    filter_all: string;
    filter_all_with_count: string;
    filter_action: string;
    filter_hidden: string;
    restore_button: string;
    hidden_empty_title: string;
    hidden_empty_description: string;
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
    create: {
      open_button: string;
      form_title: string;
      field_title: string;
      field_title_placeholder: string;
      field_due: string;
      field_notes: string;
      field_notes_placeholder: string;
      submit: string;
      submitting: string;
      cancel: string;
      toast_created: string;
      toast_failed: string;
    };
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
    next_action_banner: {
      draft_reply_title: string;
      draft_reply_body: string;
      ask_clarifying_title: string;
      ask_clarifying_body: string;
      archive_title: string;
      archive_body: string;
      snooze_title: string;
      snooze_body: string;
      no_op_title: string;
      no_op_body: string;
      notify_only_title: string;
      notify_only_body: string;
      paused_title: string;
      paused_body: string;
    };
    reasoning_panel: {
      header_draft_reply: string;
      header_ask_clarifying: string;
      header_archive: string;
      header_snooze: string;
      header_no_op: string;
      header_notify_only: string;
      header_paused: string;
      header_default: string;
      collapse: string;
      expand: string;
    };
    draft_details: {
      expand: string;
      collapse: string;
      sources_heading: string;
      action_items: {
        heading: string;
        heading_empty: string;
        add_to_tasks: string;
        added: string;
        adding: string;
        toast_added: string;
        toast_failed: string;
      };
    };
    pre_send_check: {
      modal_title: string;
      modal_body: string;
      send_anyway: string;
      cancel: string;
    };
    thinking_bar: {
      thinking_complete: string;
      bound_to: string;
      this_class: string;
      fanout_mistake: string;
      fanout_sender_history: string;
      fanout_syllabus: string;
      fanout_calendar: string;
      fanout_email: string;
      fanout_none: string;
      legacy_emails_surfaced: string;
    };
    proposal_detail: {
      why_flagged: string;
      sources: string;
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
    weekly_digest_label: string;
    weekly_digest_hint: string;
    undo_window_label: string;
    undo_window_hint: string;
    high_risk_push_label: string;
    high_risk_push_hint: string;
    snooze_24h_aria: string;
    tier_matrix_heading: string;
    tier_matrix_caption: string;
    tier_a_label: string;
    tier_a_hint: string;
    tier_b_label: string;
    tier_b_hint: string;
    tier_c_label: string;
    tier_c_hint: string;
    tier_d_label: string;
    tier_d_hint: string;
    tier_e_label: string;
    tier_e_hint: string;
    channel_push: string;
    channel_digest: string;
    channel_in_app: string;
    channel_off: string;
  };
  queue: {
    section_heading: string;
    section_caption: string;
    show_more: string;
    show_less: string;
    empty_title: string;
    empty_body: string;
    empty_cta: string;
    toast_sent: string;
    archetype_a_pill: string;
    archetype_b_pill: string;
    archetype_c_pill: string;
    archetype_d_pill: string;
    archetype_e_pill: string;
    issue_title: {
      time_conflict: string;
      exam_conflict: string;
      deadline_during_travel: string;
      exam_under_prepared: string;
      workload_over_capacity: string;
      syllabus_calendar_ambiguity: string;
      group_project_detected: string;
      group_member_silent: string;
      fallback: string;
    };
    shared: {
      dismiss: string;
      verify_recommended: string;
      take_action: string;
      open: string;
      open_thread: string;
      open_group: string;
      notify_only_body: string;
      clarify_fallback: string;
    };
    menu: {
      snooze_1h: string;
      snooze_24h: string;
      snooze_1w: string;
      dismiss_permanent: string;
    };
    undo: {
      done_with_remaining: string;
      undo: string;
    };
    card_a: {
      dismiss: string;
    };
    card_b: {
      review: string;
      send: string;
      skip: string;
      dismiss: string;
    };
    card_b_secondary: {
      open_detail: string;
      open_calendar: string;
      mark_reviewed: string;
    };
    card_d: {
      detail: string;
      undo: string;
      dismiss: string;
    };
    card_e: {
      free_text_placeholder: string;
      submit: string;
      ask_later: string;
      reject: string;
      response_pending: string;
    };
  };
  command_palette: {
    placeholder_default: string;
    placeholder_examples_label: string;
    submit_aria: string;
    recent_heading: string;
    recent_empty: string;
    examples_heading: string;
    examples: string[];
    examples_short: string[];
    open_in_chat_link: string;
    keyboard_hint: string;
    voice_hint: string;
  };
  home_v2: {
    queue_label: string;
    today_label: string;
    today_no_events: string;
    today_no_tasks: string;
    today_no_deadlines: string;
    today_calendar_heading: string;
    today_tasks_heading: string;
    today_deadlines_heading: string;
    activity_heading: string;
    activity_caption: string;
    activity_empty: string;
    activity_more: string;
    activity_view_all: string;
    activity_action_label: Record<string, string>;
    more_this_week: string;
    day_today: string;
    day_tomorrow: string;
    task_complete_aria: string;
    task_complete_failed: string;
  };
  activity_page: {
    eyebrow: string;
    page_title: string;
    page_subtitle: string;
    stats_heading: string;
    range_this_week: string;
    range_this_month: string;
    range_all_time: string;
    stat_archived_short: string;
    stat_drafted_short: string;
    stat_calendar_short: string;
    stat_time_saved: string;
    stat_time_saved_caption: string;
    today: string;
    yesterday: string;
    load_more: string;
    load_more_loading: string;
    empty_title: string;
    empty_description_connected: string;
    empty_description_no_gmail: string;
    empty_cta_connect: string;
  };
  onboarding_wait: {
    title: string;
    body_p1: string;
    body_p2: string;
    body_p3: string;
    finish_button: string;
    palette_hint: string;
    progress_label: string;
    push_permission_prompt: string;
    push_permission_yes: string;
    push_permission_no: string;
  };
  pre_brief: {
    eyebrow: string;
    back_to_home: string;
    open_in_calendar: string;
    at_a_glance: string;
    full_briefing: string;
    no_bullets: string;
    attendees: string;
  };
  group_detail: {
    eyebrow: string;
    back_to_home: string;
    deadline_label: string;
    members_heading: string;
    tasks_heading: string;
    tasks_empty: string;
    source_threads_heading: string;
    last_reply_label: string;
    draft_checkin: string;
    open_in_mail: string;
    regenerate: string;
    archive_group: string;
    confirm_archive: string;
    add_task: string;
    task_title_placeholder: string;
    task_assignee_placeholder: string;
    aria_mark_done: string;
    aria_mark_undone: string;
    aria_remove_task: string;
    toast_drafted: string;
    toast_draft_failed: string;
    toast_archived: string;
    toast_archive_failed: string;
    toast_task_added: string;
    toast_task_failed: string;
    status: {
      active: string;
      silent: string;
      done: string;
    };
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
    tutor_offer: {
      heading: string;
      body: string;
      open_in_chatgpt: string;
      ask_anyway: string;
      preparing: string;
      open_failed: string;
    };
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
      trigger_meta: string;
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
    inbox_auto_archive: {
      section_title: string;
      description: string;
      toggle_label: string;
      on: string;
      off: string;
      safety_ramp_note: string;
    };
    profile_completion: {
      heading: string;
      missing_name: string;
      missing_locale: string;
      all_set: string;
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
  // polish-19 — i18n hardening sweep. New micro-namespaces for surfaces
  // the audit script flagged but that didn't have a home in the existing
  // tree. Where a finding fit cleanly into an existing namespace, the key
  // was added there instead of inflating this section.
  theme_toggle: {
    aria: string;
    option_light: string;
    option_dark: string;
    option_system: string;
  };
  timeline_strip: {
    aria_label: string;
    event_aria: string;
  };
  inline_suggestion: {
    dismiss: string;
  };
  primary_nav: {
    aria_label: string;
  };
  notification_bell: {
    aria_label: string;
    needs_review: string;
    no_high_risk: string;
    overflow_more_view_all: string;
    steadii_noticed: string;
    view_all: string;
  };
  reauth_banner: {
    body: string;
    reconnect: string;
    dismiss: string;
    dismiss_aria: string;
  };
  gmail_revoked_banner: {
    heading: string;
    body: string;
    reconnect: string;
  };
  onboarding_skip_recovery_banner: {
    heading: string;
    body: string;
    connect: string;
    dismiss: string;
    dismiss_aria: string;
  };
  error_page: {
    badge: string;
    heading: string;
    body_with_id: string;
    fallback_id: string;
    retry: string;
    back_home: string;
  };
  inbox_detail: {
    back: string;
    new_sender: string;
    paused_title: string;
    paused_body: string;
    manage_billing: string;
    risk_high: string;
    risk_medium: string;
    risk_low: string;
    risk_classifying: string;
    no_subject: string;
  };
  proposal_detail: {
    back: string;
    what_to_do: string;
    already_status_pending: string;
    already_status_resolved: string;
    already_status_dismissed: string;
    already_status_with_action: string;
    status_resolved: string;
    status_dismissed: string;
    issue_time_conflict: string;
    issue_exam_conflict: string;
    issue_deadline_during_travel: string;
    issue_exam_under_prepared: string;
    issue_workload_over_capacity: string;
    issue_syllabus_calendar_ambiguity: string;
    issue_auto_action_log: string;
    issue_admin_waitlist_pending: string;
    issue_group_project_detected: string;
    issue_group_member_silent: string;
  };
  class_form: {
    back: string;
    title: string;
    name_label: string;
    name_placeholder: string;
    code_label: string;
    code_placeholder: string;
    term_label: string;
    term_placeholder: string;
    color_label: string;
    color_aria: string;
    optional_indicator: string;
    submit: string;
    cancel: string;
  };
  cancel_form_page: {
    title: string;
    scheduled_toast: string;
    back_to_billing: string;
    why_label: string;
    optional_indicator: string;
    continue: string;
    skip: string;
    back: string;
    summary_heading: string;
    keep_access_until: string;
  };
  connections_page: {
    title: string;
    setup_rerun_success: string;
    imported_prefix: string;
    imported_suffix: string;
    microsoft_connected_toast: string;
    microsoft_disconnected_toast: string;
    ical_subscription_added: string;
    notion_label: string;
    connected_to: string;
    import_button: string;
    rerun_setup: string;
    reconnect: string;
    disconnect: string;
    notion_blurb: string;
    connect_notion: string;
    google_calendar: string;
    gmail: string;
    microsoft_label: string;
    connected_simple: string;
    reconnect_missing_scopes: string;
    microsoft_blurb: string;
    connect_microsoft: string;
    ical_heading: string;
    ical_blurb: string;
    url_label: string;
    url_placeholder: string;
    label_optional_label: string;
    label_placeholder: string;
    add_button: string;
    paused_prefix: string;
    last_error_prefix: string;
    last_synced_prefix: string;
    last_synced_z_suffix: string;
    reactivate: string;
    remove: string;
    github: {
      title: string;
      description: string;
      save: string;
      help_text: string;
      invalid: string;
      saved_toast: string;
      cleared_toast: string;
    };
    reclassify_inbox: {
      button: string;
      help: string;
      done: string;
    };
    regenerate_drafts: {
      button: string;
      help: string;
      done: string;
      more: string;
      exhausted: string;
    };
    voice_profile: {
      title: string;
      description: string;
      empty: string;
      button: string;
      help: string;
      gmail_required: string;
      saved_toast: string;
      insufficient_toast: string;
      error_toast: string;
    };
  };
  agent_thinks_page: {
    settings_back: string;
    title: string;
    description_prefix: string;
    description_suffix: string;
    empty: string;
    from_label: string;
    writing_style: {
      heading: string;
      empty: string;
      remove: string;
      removed_toast: string;
    };
    contact_personas: {
      heading: string;
      description: string;
      empty: string;
      remove: string;
      no_facts_yet: string;
    };
  };
  syllabus_new_page: {
    title: string;
    subtitle: string;
  };
  invite_page: {
    invalid_title: string;
    invalid_body: string;
    back_to_steadii: string;
    invite_title: string;
    invite_body: string;
    today_label: string;
    after_3mo_label: string;
    price_after: string;
    cancel_anytime: string;
  };
  clarification_reply: {
    heading: string;
    body: string;
    placeholder: string;
  };
  chat_history_row: {
    confirm: string;
  };
  chat_view_v2: {
    blob_token_const: string;
  };
  mistake_note_dialog: {
    title: string;
    title_label: string;
    title_placeholder: string;
    class_label: string;
    class_none: string;
    unit_label: string;
    difficulty_label: string;
    tags_label: string;
    tags_placeholder: string;
    cancel: string;
  };
  new_chat_input: {
    attach_aria: string;
    ai_ready: string;
    send_aria: string;
  };
  tool_call_card: {
    delete_target_label: string;
    cancel: string;
    confirm_delete: string;
  };
  hero_animation_extra: {
    cmd_k: string;
  };
  voice_demo_extra: {
    caps_key_label: string;
  };
  markdown_editor_extra: {
    saved_at_label: string;
    class_label: string;
    class_none: string;
    unit_label: string;
    difficulty_label: string;
    tags_label: string;
    tags_placeholder: string;
    bold_glyph: string;
    italic_glyph: string;
    inline_code_glyph: string;
    inline_math_glyph: string;
    block_math_glyph: string;
    heading_glyph: string;
    edit_tab: string;
    preview_tab: string;
  };
  notion_connect_panel: {
    connected: string;
    one_thing_first: string;
    permission_screen_prefix: string;
    permission_screen_quoted: string;
    permission_screen_suffix: string;
    bullet_only_steadii: string;
    bullet_single_page: string;
    got_it: string;
    connect_notion: string;
  };
  drop_zone: {
    remove: string;
    upload_aria: string;
    drop_prefix: string;
    drop_separator: string;
    click_to_browse: string;
    max_size: string;
  };
  syllabus_wizard: {
    url_label: string;
    url_placeholder: string;
    or_a_prefix: string;
    or_a_pdf_image: string;
    or_a_pdf: string;
    blob_warning_prefix: string;
    blob_token_const: string;
    blob_warning_suffix: string;
    preview_heading: string;
    preview_body: string;
    field_course_name: string;
    field_course_code: string;
    field_term: string;
    field_instructor: string;
    field_grading: string;
    field_attendance: string;
    field_textbooks: string;
    field_office_hours: string;
    class_link_label: string;
    class_none: string;
    schedule_heading: string;
    start_over: string;
  };
  voice_overlay_extra: {
    send_aria: string;
  };
};

export const en: MessagesShape = {
  brand: {
    name: "Steadii",
    tagline: "Your chief of staff for college life.",
  },
  landing: {
    headline: "Your chief of staff\nfor college life.",
    subhead:
      "Steadii reads, writes, schedules, and tracks — so you don't have to.",
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
        body: "Syllabi, tasks, and the notes Steadii keeps about you. Yours to read, search, and export — never locked in.",
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
          input: "When's the Math II midterm?",
          action:
            "Reads your syllabus → \"Ch 3-5, midterm 5/16. Adding the date to your calendar.\"",
        },
        absence: {
          input: "I might not make it to campus tomorrow",
          action:
            "Drafts emails to tomorrow's professors and offers a calendar absence-mark.",
        },
      },
    },
    steadii_in_motion: {
      title: "And it filters out the noise.",
      body:
        "Steadii classifies every inbound email. Clear noise — newsletters, no-reply, marketing — is auto-archived so your queue stays focused on what needs you. The agent learns from anything you restore.",
      real_screen: "Real surfaces. Mock data.",
      step1_label: "Inbox · 09:42",
      step1_sender: "Coursera Newsletter",
      step1_subject: "Top courses this week",
      step1_chip_tier: "tier 1",
      step1_chip_time: "2m",
      step1_classifying: "Classifying… Tier 1 noise · 96%",
      step1_outcome: "Auto-archived",
      step1_outcome_meta:
        "Queue stayed clean. Logged in this week's digest.",
      step2_label: "Inbox · later that day",
      step2_filter_all: "Inbox",
      step2_filter_hidden: "Hidden ({n})",
      step2_restore: "Restore — keep these in inbox",
      step2_meta:
        "Open the Hidden filter any time to review or restore.",
      step3_label: "Tomorrow",
      step3_sender: "Coursera Newsletter",
      step3_subject: "New course series for you",
      step3_chip_tier: "review",
      step3_chip_time: "now",
      step3_status: "Confidence ↓ · surfaced for review",
      step3_meta:
        "Steadii learned from the restore. Similar items now stay visible.",
    },
    boundaries: {
      title: "What you do, what Steadii does",
      subhead:
        "We draw the line clearly. Don't outsource thinking to an AI. Don't spend your day on logistics.",
      cards: {
        learning: {
          who: "You",
          key: "Learning",
          body: "Spend time on concepts with ChatGPT, Claude, Gemini. The thing you came here for.",
        },
        deciding: {
          who: "You",
          key: "Deciding",
          body: "Steadii never moves ahead of you. Every call lands in your hands first.",
        },
        doing: {
          who: "Steadii",
          key: "Doing",
          body: "Replies emails, books rooms, files paperwork, chases group progress.",
        },
      },
    },
    founding: {
      headline: "Founding seats — first 100.",
      sub: "Lock your price forever.",
      cta: "Request access",
      cta_secondary: "Have an invite code?",
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
      app_header: "Home · Steadii",
      greeting: "Good morning, Ryuto",
      summary_ready: "Your day is ready.",
      palette_placeholder: "Tell Steadii…",
      palette_typing_query:
        "Brief me before tomorrow's meeting with Prof. Tanaka",
      briefing_label: "Today",
      briefing_event: "10:00 — Meeting w/ Prof. Tanaka",
      card_title: "Meeting with Prof. Tanaka in 14 min",
      card_eta: "14m",
      card_body: "Pre-brief ready. 3 items pulled from your context.",
      card_bullet_1: "Last thread: Ch 4 extension request, 5/14",
      card_bullet_2: "Pending: midterm scope question (no reply yet)",
      card_bullet_3: "Recent note: §3.4 linear transformations",
      card_action_open_calendar: "Open in Calendar",
      card_action_mark_reviewed: "Mark reviewed",
      card_dismiss_aria: "Dismiss",
      chip_email: "email-1",
      chip_mistake: "note-1",
      chip_calendar: "calendar-1",
      nav_home: "Home",
      nav_inbox: "Inbox",
      nav_calendar: "Calendar",
      nav_classes: "Classes",
      nav_chats: "Recent",
      nav_settings: "Settings",
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
    chats: "Recent",
    classes: "Classes",
    calendar: "Calendar",
    tasks: "Tasks",
    activity: "Activity",
    settings: "Settings",
  },
  classes: {
    tabs: {
      syllabus: "Syllabus",
      // "Tasks" is the user-facing label; the URL key, schema table, and
      // route handler all stay `assignments` to avoid a migration.
      assignments: "Tasks",
      // Wave 1 secretary pivot: framed as Steadii's notes about the user
      // (input for draft personalization), not as study material.
      mistakes: "Notes",
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
        "This will also delete {syllabi} syllabi, {assignments} tasks, and {mistakes} of Steadii's notes about you. Chats referencing this class will be untagged but kept.",
      confirm_body_no_cascade:
        "This class has no syllabi, tasks, or saved notes. Chats referencing this class will be untagged but kept.",
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
      empty_title: "Steadii hasn't tracked any weak-area notes for {className} yet.",
      empty_description:
        "These are the notes Steadii keeps so it can personalize drafts and spot when emails relate to topics you've struggled with. Drop a handwritten page above or paste one into chat.",
      open_chat: "Open chat",
      delete_confirm_title: "Delete this note?",
      delete_confirm_body: "Steadii will lose this context for future drafts. You can re-add it from chat anytime.",
      deleted_toast: "Note deleted.",
      delete_failed: "Couldn't delete this note.",
    },
  },
  mistakes: {
    add_from_photo: "📷 Add from photo",
    context_note:
      "Steadii uses these notes to personalize drafts and notice when emails relate to topics you've struggled with. Not a study tool — for studying, use ChatGPT or Claude.",
    photo_upload_modal_title: "Add to Steadii's notes",
    photo_upload_modal_subtitle:
      "Steadii reads the page verbatim and uses it as context when drafting your emails — not as a study guide. For studying, use ChatGPT or Claude.",
    photo_choose_file: "Choose file",
    photo_supported_formats: "PDF, PNG, JPEG, GIF, WebP",
    photo_extracting: "Extracting…",
    photo_preview_label: "Preview (editable)",
    photo_title_placeholder: "Title (e.g. 'Integration by parts — weak area')",
    photo_save_button: "Save to Steadii's notes",
    photo_cancel: "Cancel",
    photo_extract_failed: "Couldn't read the file. Try again or use a clearer image.",
    photo_save_failed: "Couldn't save. Please try again.",
    delete_button: "Delete",
    delete_confirm_title: "Delete this note?",
    delete_confirm_body: "Steadii will lose this context for future drafts. You can re-add it from chat anytime.",
    deleted_toast: "Note deleted.",
    delete_failed: "Couldn't delete this note.",
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
        "Notion is optional and lives in Settings → Connections — connect it to import your existing classes, notes, syllabi, and assignments into Steadii.",
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
            "Import your existing classes, notes, syllabi, and assignments from Notion.",
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
    loading_aria: "Loading",
  },
  home: {
    today_schedule: "Today's schedule",
    due_soon: "Due soon",
    past_week: "Past week",
    no_events: "No classes or events today.",
    nothing_due: "Nothing due. You're clear.",
    not_enough_history: "Not enough history yet. Come back next week.",
    counts: "{chats} chats · {mistakes} notes · {syllabi} syllabi",
    review_action: "Open chat",
    generate_practice_action: "Open chat",
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
    summary_ready: "Here's where you are this week.",
    full_calendar: "Full calendar",
    assignments_remaining: "{count} tasks remaining today",
    study_sessions: "chats",
    focus_summary: "You ran {hours} hours of Steadii sessions this week.",
    focus_summary_empty: "Not enough activity yet — give it a week.",
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
    hidden_filter_aria: "Inbox view filter",
    filter_all: "Inbox",
    filter_all_with_count: "All ({n})",
    filter_action: "Action needed ({n})",
    filter_hidden: "Hidden ({n})",
    restore_button: "Restore — keep these in inbox",
    hidden_empty_title: "Nothing hidden yet.",
    hidden_empty_description:
      "When Steadii archives a low-risk email, it'll appear here so you can review or restore it.",
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
    create: {
      open_button: "New task",
      form_title: "Add a task",
      field_title: "Title",
      field_title_placeholder: "What needs to get done?",
      field_due: "Due date (optional)",
      field_notes: "Notes (optional)",
      field_notes_placeholder: "Anything to remember when you do this",
      submit: "Add task",
      submitting: "Adding…",
      cancel: "Cancel",
      toast_created: "Task added.",
      toast_failed: "Couldn't add the task. Try again.",
    },
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
      role_ta_hint: "Teaching assistant",
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
    next_action_banner: {
      draft_reply_title: "Steadii drafted a reply.",
      draft_reply_body: "Review the draft below. Edit if needed, then Send.",
      ask_clarifying_title: "Steadii needs more info from you.",
      ask_clarifying_body:
        "Provide the missing context below. Once you reply, Steadii drafts the response.",
      archive_title: "No reply needed.",
      archive_body: "Steadii recommends archiving this. Dismiss when you've handled it.",
      snooze_title: "Steadii suggests revisiting later.",
      snooze_body: "Dismiss for now; the item will resurface when relevant.",
      no_op_title: "No action proposed.",
      no_op_body: "Steadii didn't see anything that needs you. Dismiss to clear it.",
      notify_only_title: "Important — no reply needed.",
      notify_only_body:
        "Steadii flagged this so you don't miss it. Read and dismiss.",
      paused_title: "Paused — credits exhausted.",
      paused_body:
        "Top up to resume draft generation. Classification continues for free.",
    },
    reasoning_panel: {
      header_draft_reply: "Why this draft",
      header_ask_clarifying: "Why Steadii is asking",
      header_archive: "Why archive",
      header_snooze: "Why snooze",
      header_no_op: "Why no action",
      header_notify_only: "Why this is important",
      header_paused: "Why paused",
      header_default: "Steadii's reasoning",
      collapse: "Collapse",
      expand: "Expand",
    },
    draft_details: {
      expand: "Show Steadii's reasoning",
      collapse: "Hide reasoning",
      sources_heading: "Sources Steadii referenced",
      action_items: {
        heading: "Steadii detected {n} action items",
        heading_empty: "No action items detected",
        add_to_tasks: "Add to my tasks",
        added: "Added",
        adding: "Adding…",
        toast_added: "Added to your tasks.",
        toast_failed: "Couldn't add this task.",
      },
    },
    pre_send_check: {
      modal_title: "Steadii spotted potential issues",
      modal_body:
        "These phrases didn't appear in the original thread. Double-check before sending.",
      send_anyway: "Send anyway",
      cancel: "Edit draft",
    },
    thinking_bar: {
      thinking_complete: "Thinking · complete",
      bound_to: "Bound to",
      this_class: "this class",
      fanout_mistake: "{n} note",
      fanout_sender_history: "{n} prior reply",
      fanout_syllabus: "{n} syllabus",
      fanout_calendar: "{n} calendar",
      fanout_email: "{n} email",
      fanout_none: "no fanout context",
      legacy_emails_surfaced: "{returned} of {total} emails surfaced",
    },
    proposal_detail: {
      why_flagged: "Why Steadii flagged this",
      sources: "Sources",
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
    placeholder_title: "Title for Steadii's note",
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
      "Classes are Steadii's core unit. Add one to start tracking assignments, syllabi, and the notes Steadii keeps about your weak areas.",
    aria_classes: "Classes",
    metadata_due: "{n} due",
    metadata_mistakes: "{n} notes",
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
    weekly_digest_label: "Weekly Sunday recap email",
    weekly_digest_hint:
      "Sent every Sunday at 5pm in your timezone with what Steadii did this week.",
    undo_window_label: "Undo window",
    undo_window_hint:
      "Seconds between Send and actual Gmail delivery. 10 feels fast; 60 is forgiving.",
    high_risk_push_label: "High-risk push",
    high_risk_push_hint:
      "Immediate notification when a high-risk draft lands. Pushes arrive once mobile ships — toggle is saved for later.",
    snooze_24h_aria: "Snooze for 24 hours",
    tier_matrix_heading: "Per-card-type routing",
    tier_matrix_caption:
      "Which channel fires when each card archetype lands in your queue. The in-app queue always shows everything.",
    tier_a_label: "Decision required",
    tier_a_hint: "High-stakes blocks — exam conflicts, deadlines clashing with travel.",
    tier_b_label: "Drafts ready to review",
    tier_b_hint: "Replies Steadii has prepared. You hit Send.",
    tier_c_label: "Soft notices",
    tier_c_hint: "Steadii noticed something but hasn't drafted yet.",
    tier_d_label: "Completed actions",
    tier_d_hint: "Auto-archives, auto-imports, low-risk auto-sends.",
    tier_e_label: "Clarifying questions",
    tier_e_hint: "Steadii needs more info before it can act.",
    channel_push: "Push",
    channel_digest: "Digest",
    channel_in_app: "In-app only",
    channel_off: "Off",
  },
  queue: {
    section_heading: "Steadii queue",
    section_caption: "What needs you. Sorted by stakes — decisions first.",
    show_more: "Show more",
    show_less: "Show less",
    empty_title: "Queue is empty.",
    empty_body:
      "Steadii is watching. New email, deadline, or conflict will land here.",
    empty_cta: "Ask Steadii to do something",
    toast_sent: "Sent.",
    archetype_a_pill: "Decide",
    archetype_b_pill: "Draft ready",
    archetype_c_pill: "Notice",
    archetype_d_pill: "Done",
    archetype_e_pill: "Question",
    issue_title: {
      time_conflict: "Calendar conflict",
      exam_conflict: "Exam clash",
      deadline_during_travel: "Deadline during travel",
      exam_under_prepared: "Exam prep gap",
      workload_over_capacity: "Workload overload",
      syllabus_calendar_ambiguity: "Syllabus needs review",
      group_project_detected: "Group project detected",
      group_member_silent: "Group member silent",
      fallback: "Steadii noticed",
    },
    shared: {
      dismiss: "Dismiss",
      verify_recommended: "Verify before acting.",
      take_action: "Take action",
      open: "Open",
      open_thread: "Open thread",
      open_group: "Open group",
      notify_only_body: "Important from {sender}. No reply expected — review when you can.",
      clarify_fallback:
        "Steadii needs more context before drafting a reply to {sender}.",
    },
    menu: {
      snooze_1h: "Snooze 1 hour",
      snooze_24h: "Snooze 1 day",
      snooze_1w: "Snooze 1 week",
      dismiss_permanent: "Dismiss permanently",
    },
    undo: {
      done_with_remaining: "Done. {n}s to undo.",
      undo: "Undo",
    },
    card_a: {
      dismiss: "Skip",
    },
    card_b: {
      review: "Review",
      send: "Send",
      skip: "Skip",
      dismiss: "Dismiss",
    },
    card_b_secondary: {
      open_detail: "Open detail",
      open_calendar: "Open in Calendar",
      mark_reviewed: "Mark reviewed",
    },
    card_d: {
      detail: "Detail",
      undo: "Undo",
      dismiss: "Dismiss",
    },
    card_e: {
      free_text_placeholder: "Or type something else…",
      submit: "Send to Steadii",
      ask_later: "Ask later",
      reject: "Reject",
      response_pending: "Awaiting response",
    },
  },
  command_palette: {
    placeholder_default: "Tell Steadii…",
    placeholder_examples_label: "draft · schedule · move · check-in · cancel",
    submit_aria: "Send command",
    recent_heading: "Recent",
    recent_empty: "Your last commands will show here.",
    examples_heading: "Try",
    examples: [
      "Draft a polite extension request to Prof. Tanaka for ECO101",
      "Move my Friday 3pm meeting to Monday morning",
      "Check in on the group project — anyone gone quiet?",
      "Email TA Yamada — I'll miss tomorrow's lab",
      "What's piling up this week?",
    ],
    examples_short: [
      "Draft an extension email",
      "Move Friday's meeting",
      "Check on the group project",
      "What's due this week?",
    ],
    open_in_chat_link: "Open in chat",
    keyboard_hint: "⌘K",
    voice_hint: "Hold Caps Lock to talk · ⌘K to focus",
  },
  home_v2: {
    queue_label: "Queue",
    today_label: "Today",
    today_no_events: "Nothing scheduled in the next 7 days.",
    today_no_tasks: "Nothing on the task list this week.",
    today_no_deadlines: "No deadlines this week.",
    today_calendar_heading: "Calendar",
    today_tasks_heading: "Tasks",
    today_deadlines_heading: "Deadlines",
    activity_heading: "Recent activity",
    activity_caption: "What Steadii has been doing lately.",
    activity_empty: "Nothing yet.",
    activity_more: "More",
    activity_view_all: "View all →",
    activity_action_label: {
      draft_sent: "Sent draft",
      draft_dismissed: "Skipped draft",
      auto_archived: "Auto-archived",
      auto_replied: "Auto-replied",
      proposal_resolved: "Resolved",
      proposal_dismissed: "Dismissed",
      calendar_imported: "Imported event",
      mistake_added: "Added note",
      generic: "Action",
    },
    more_this_week: "+ {n} more this week",
    day_today: "Today",
    day_tomorrow: "Tomorrow",
    task_complete_aria: "Mark {title} done",
    task_complete_failed: "Couldn't mark task done — try again",
  },
  activity_page: {
    eyebrow: "Audit log",
    page_title: "Activity",
    page_subtitle: "Everything Steadii has done for you, in one place.",
    stats_heading: "Activity stats",
    range_this_week: "This week",
    range_this_month: "This month",
    range_all_time: "All time",
    stat_archived_short: "Archived",
    stat_drafted_short: "Drafted",
    stat_calendar_short: "Calendar",
    stat_time_saved: "Time saved",
    stat_time_saved_caption: "Estimated, all-time. Conservative.",
    today: "Today",
    yesterday: "Yesterday",
    load_more: "Load more",
    load_more_loading: "Loading…",
    empty_title: "Nothing here yet.",
    empty_description_connected:
      "Your first ingest will appear here once Steadii starts triaging.",
    empty_description_no_gmail:
      "Steadii hasn't done anything yet — connect Gmail to get started.",
    empty_cta_connect: "Open Settings",
  },
  onboarding_wait: {
    title: "Steadii is on it.",
    body_p1:
      "Steadii will read the last 7 days of email and prepare your first draft.",
    body_p2:
      "Usually within 24h, your first proposal lands on Home. We'll push you a notification.",
    body_p3: "Anything you want handled in the meantime, just ask:",
    finish_button: "Take me to Home",
    palette_hint: "or paste a syllabus, command, or question…",
    progress_label: "Step 3 of 3",
    push_permission_prompt:
      "Allow Steadii to send a push when your first proposal is ready?",
    push_permission_yes: "Yes, notify me",
    push_permission_no: "Skip notifications",
  },
  pre_brief: {
    eyebrow: "Meeting pre-brief",
    back_to_home: "Back to Home",
    open_in_calendar: "Open in Calendar",
    at_a_glance: "At a glance",
    full_briefing: "Full briefing",
    no_bullets: "Nothing material to share for this meeting.",
    attendees: "Attendees",
  },
  group_detail: {
    eyebrow: "Group project",
    back_to_home: "Back to Home",
    deadline_label: "Deadline:",
    members_heading: "Members",
    tasks_heading: "Tasks",
    tasks_empty: "No tasks yet — add one below.",
    source_threads_heading: "Source threads",
    last_reply_label: "Last reply:",
    draft_checkin: "Draft check-in",
    open_in_mail: "Open in Mail",
    regenerate: "Regenerate",
    archive_group: "Archive group",
    confirm_archive:
      "Archive this group project? It will move to Done and stop appearing on Home.",
    add_task: "Add task",
    task_title_placeholder: "Task title…",
    task_assignee_placeholder: "Assignee email (optional)",
    aria_mark_done: "Mark task done",
    aria_mark_undone: "Mark task not done",
    aria_remove_task: "Remove task",
    toast_drafted: "Draft ready.",
    toast_draft_failed: "Draft failed.",
    toast_archived: "Archived.",
    toast_archive_failed: "Archive failed.",
    toast_task_added: "Task added.",
    toast_task_failed: "Task failed.",
    status: {
      active: "Active",
      silent: "Silent",
      done: "Done",
    },
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
    placeholder: "Tell Steadii what to handle…",
    example_prompts: [
      "What's due this week?",
      "Draft a reply to Prof. Tanaka's email",
      "Add a chemistry task for Friday",
      "What's my next class?",
      "Email my TA — I'll miss the lab tomorrow",
      "Reschedule my Friday meeting to Monday",
      "Snooze the office-hours email till tomorrow",
      "Who haven't I emailed in 3+ weeks?",
    ],
  },
  chat: {
    actions: {
      add_to_mistakes: "+ Add to Steadii's notes",
      generate_similar: "Generate similar",
      save_mistake: "Save to Steadii's notes",
    },
    dismiss: "Dismiss",
    remove_attachment: "Remove",
    tutor_offer: {
      heading: "This looks like a study question.",
      body:
        "Steadii handles academic admin (email, schedule, deadlines). For learning, ChatGPT is faster. Want me to send you there with your context loaded?",
      open_in_chatgpt: "Open in ChatGPT",
      ask_anyway: "No, ask Steadii anyway",
      preparing: "Preparing your context…",
      open_failed: "Couldn't open ChatGPT — try again or ask Steadii.",
    },
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
        "Hold a key to talk to Steadii — release to send. Pick the trigger that matches your keyboard: Right Option (⌥) for US/EN keyboards (no IME interception), Right Command (⌘) for JIS/JP keyboards (Right Option there is the かな key and gets eaten by the IME). Caps Lock is the legacy default but most macOS browsers treat it as a toggle.",
      trigger_label: "Trigger key",
      trigger_caps: "Caps Lock (legacy)",
      trigger_alt: "Right Option (⌥) — US / EN keyboards",
      trigger_meta: "Right Command (⌘) — JIS / JP keyboards",
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
    inbox_auto_archive: {
      section_title: "Inbox",
      description:
        "Steadii silently archives marketing, no-reply, and other clear-noise emails so they don't clutter your queue. You can review hidden items in the weekly digest or via the Hidden filter in Inbox.",
      toggle_label: "Hide low-risk emails automatically",
      on: "On — turn off",
      off: "Off — turn on",
      safety_ramp_note:
        "α: defaults off for the first two weeks while we tune the classifier. Toggle changes only apply to new email.",
    },
    profile_completion: {
      heading: "Finish your profile",
      missing_name:
        "Add your name so Steadii can address you in drafts.",
      missing_locale:
        "Pick a language so the digest and queue speak the right one.",
      all_set: "Profile is complete.",
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
          "Steadii is an academic chief of staff — it triages email, drafts replies, manages your calendar and deadlines. It is not a substitute for doing your coursework. Submitting any machine-generated output as your own on a graded assignment is your responsibility and may violate your institution's policies.",
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
      "What's my biggest backlog right now — emails I haven't replied to, deadlines slipping, or commitments I haven't followed up on?",
    generate_similar_problems:
      "Draft check-in messages to any of my professors I haven't emailed in 3+ weeks but have ongoing topics with.",
  },
  theme_toggle: {
    aria: "Theme",
    option_light: "Light",
    option_dark: "Dark",
    option_system: "System",
  },
  timeline_strip: {
    aria_label: "Timeline",
    event_aria: "{title}, {start} to {end}",
  },
  inline_suggestion: {
    dismiss: "Dismiss",
  },
  primary_nav: {
    aria_label: "Primary navigation",
  },
  notification_bell: {
    aria_label: "Notifications",
    needs_review: "Needs review",
    no_high_risk: "No high-risk items right now.",
    overflow_more_view_all: "+{count} more — view all",
    steadii_noticed: "Steadii noticed",
    view_all: "View all →",
  },
  reauth_banner: {
    body: "Gmail triage is new. Sign out and back in to grant the Gmail scope — the agent can't read or draft until you do.",
    reconnect: "Reconnect",
    dismiss: "Dismiss",
    dismiss_aria: "Dismiss",
  },
  gmail_revoked_banner: {
    heading: "Gmail access expired",
    body:
      "Steadii can no longer read or draft email. Sign in again with Google to restore access — your settings stay intact.",
    reconnect: "Reconnect Gmail",
  },
  onboarding_skip_recovery_banner: {
    heading: "Connect calendar to get more from Steadii",
    body:
      "You skipped the optional integrations during setup. Adding your calendar lets Steadii spot conflicts, prep meeting briefs, and surface deadline overlap with your inbox.",
    connect: "Connect now",
    dismiss: "Dismiss",
    dismiss_aria: "Dismiss this prompt",
  },
  error_page: {
    badge: "Something went wrong",
    heading: "Steadii stumbled on this page.",
    body_with_id: "The error has been reported. If it keeps happening, mention this ID when you email us:",
    fallback_id: "n/a",
    retry: "Try again",
    back_home: "Back to Home",
  },
  inbox_detail: {
    back: "Inbox",
    new_sender: "New sender",
    paused_title: "Draft generation paused",
    paused_body: "You ran out of credits this cycle. Top up to resume draft generation — classification continues for free.",
    manage_billing: "Manage billing →",
    risk_high: "High",
    risk_medium: "Medium",
    risk_low: "Low",
    risk_classifying: "Classifying",
    no_subject: "(no subject)",
  },
  proposal_detail: {
    back: "Back to inbox",
    what_to_do: "What would you like to do?",
    already_status_pending: "This proposal is already pending",
    already_status_resolved: "This proposal is already resolved",
    already_status_dismissed: "This proposal is already dismissed",
    already_status_with_action: " (chose: {action})",
    status_resolved: "Resolved",
    status_dismissed: "Dismissed",
    issue_time_conflict: "Time conflict",
    issue_exam_conflict: "Exam conflict",
    issue_deadline_during_travel: "Deadline during travel",
    issue_exam_under_prepared: "Exam coming up",
    issue_workload_over_capacity: "Workload spike",
    issue_syllabus_calendar_ambiguity: "Confirm import",
    issue_auto_action_log: "Steadii action log",
    issue_admin_waitlist_pending: "Waitlist request",
    issue_group_project_detected: "Group project detected",
    issue_group_member_silent: "Group member silent",
  },
  class_form: {
    back: "Classes",
    title: "New class",
    name_label: "Name",
    name_placeholder: "e.g. Linear Algebra",
    code_label: "Course code",
    code_placeholder: "e.g. MAT223",
    term_label: "Term",
    term_placeholder: "e.g. Spring 2026",
    color_label: "Color",
    color_aria: "Class color",
    optional_indicator: "(optional)",
    submit: "Create class",
    cancel: "Cancel",
  },
  cancel_form_page: {
    title: "Cancel subscription",
    scheduled_toast: "Cancellation scheduled.",
    back_to_billing: "Back to Billing",
    why_label: "Why are you canceling?",
    optional_indicator: "(optional)",
    continue: "Continue",
    skip: "Skip",
    back: "Back",
    summary_heading: "What happens when you cancel:",
    keep_access_until: "You keep full access until",
  },
  connections_page: {
    title: "Connections",
    setup_rerun_success: "Setup re-run successfully. Your Steadii workspace has been re-created in Notion.",
    imported_prefix: "Imported",
    imported_suffix: "rows from Notion into Steadii.",
    microsoft_connected_toast: "Microsoft 365 connected.",
    microsoft_disconnected_toast: "Microsoft 365 disconnected.",
    ical_subscription_added: "iCal subscription",
    notion_label: "Notion",
    connected_to: "Connected to",
    import_button: "Import from Notion",
    rerun_setup: "Re-run setup",
    reconnect: "Re-connect",
    disconnect: "Disconnect",
    notion_blurb: "Import copies your Notion classes, mistakes, syllabi, and assignments into Steadii's Postgres store (idempotent — safe to re-run). Re-run setup if the Steadii page has been deleted from Notion or the four databases are out of sync.",
    connect_notion: "Connect Notion",
    google_calendar: "Google Calendar",
    gmail: "Gmail",
    microsoft_label: "Microsoft 365",
    connected_simple: "Connected.",
    reconnect_missing_scopes: "Re-connect to grant missing scopes",
    microsoft_blurb: "Pull Outlook calendar events and Microsoft To Do tasks into the same prompt block as Google.",
    connect_microsoft: "Connect Microsoft 365",
    ical_heading: "iCal subscriptions",
    ical_blurb: "Paste any read-only iCal feed (school timetable, public calendar) and Steadii will sync it every 6 hours.",
    url_label: "URL",
    url_placeholder: "https://… or webcal://…",
    label_optional_label: "Label (optional)",
    label_placeholder: "e.g. UToronto",
    add_button: "Add",
    paused_prefix: "Paused —",
    last_error_prefix: "Last error:",
    last_synced_prefix: "Last synced",
    last_synced_z_suffix: "Z",
    reactivate: "Reactivate",
    remove: "Remove",
    github: {
      title: "GitHub username",
      description:
        "Used to promote PR notifications that mention you out of the auto-low bucket.",
      save: "Save",
      help_text:
        "Find this in github.com/settings/profile. Letters, numbers, and dashes only — max 39 characters.",
      invalid: "Invalid GitHub username format.",
      saved_toast: "GitHub username saved.",
      cleared_toast: "GitHub username removed.",
    },
    reclassify_inbox: {
      button: "Re-classify inbox with latest rules",
      help:
        "Re-runs the L1 classifier over every open inbox item. Useful when Steadii ships an updated rule and legacy items are still tagged with the old bucket (e.g. Vercel/GitHub bot notifications stuck at HIGH from before the GitHub-aware routing landed).",
      done: "Re-classified — {changed} items updated, {ignored} now silently ignored.",
    },
    regenerate_drafts: {
      button: "Regenerate AI drafts",
      help:
        "Re-runs L2 reasoning + draft body over your open inbox drafts using the latest classification logic and your current language preference. Up to 10 drafts per click. Costs the usual L2 credits.",
      done: "Regenerated {refreshed} drafts.",
      more: "Regenerated {refreshed} drafts. More queued — click again to continue.",
      exhausted: "Regenerated {refreshed} drafts before credits ran out. Top up to continue.",
    },
    voice_profile: {
      title: "Writing voice",
      description:
        "A one-line description of how you write, generated from your last 50 sent emails. Steadii injects it into every draft so first-time-sender replies sound like you instead of generic LLM tone.",
      empty: "No voice profile yet. Click below once Gmail is connected to generate one.",
      button: "Re-learn my writing voice",
      help:
        "Reads up to 50 sent messages from Gmail, summarizes register / language mix / typical length / signature style. Takes ~10 seconds and costs about $0.05 in credits.",
      gmail_required: "Connect Gmail above to enable voice-profile extraction.",
      saved_toast: "Voice profile updated.",
      insufficient_toast:
        "Not enough sent mail to extract a voice profile yet. Send a few emails through your Gmail account and try again.",
      error_toast: "Voice profile generation failed. Try again, or check the integration status.",
    },
  },
  agent_thinks_page: {
    settings_back: "Settings",
    title: "How your agent thinks",
    description_prefix: "The last",
    description_suffix: "decisions, with the fanout sources that grounded each one. Read-only — see something off? Open the inbox item to give feedback.",
    empty: "The agent hasn't drafted anything yet. Once it does, every decision lands here.",
    from_label: "From",
    writing_style: {
      heading: "Writing style learned from your edits",
      empty:
        "No style rules yet. Once you've sent a few drafts after editing them, Steadii will learn your phrasing preferences and surface them here.",
      remove: "Remove",
      removed_toast: "Style rule removed.",
    },
    contact_personas: {
      heading: "Contacts Steadii has learned about",
      description:
        "What Steadii remembers about each person you correspond with. The relationship label sets tone in drafts; the facts inform how Steadii replies.",
      empty:
        "No contacts learned yet. Once you've corresponded with a few people, Steadii will distill what it knows about each of them here.",
      remove: "Forget this contact",
      no_facts_yet: "No specific facts learned yet.",
    },
  },
  syllabus_new_page: {
    title: "Upload a syllabus",
    subtitle: "Drop a PDF, an image, or paste a URL. We'll extract the structure and show you a preview before saving.",
  },
  invite_page: {
    invalid_title: "Invite link not valid",
    invalid_body: "This invitation has been revoked, used, or expired. Ask whoever sent you the link for a fresh one.",
    back_to_steadii: "Back to Steadii",
    invite_title: "You're invited to Steadii Pro",
    invite_body: "This invite unlocks 3 months of Pro — full AI agent, 1000 credits per cycle, everything. No charge for the first three months; the plan then rolls to the standard Pro price unless you cancel.",
    today_label: "Today",
    after_3mo_label: "After 3 months",
    price_after: "$20 / month",
    cancel_anytime: "You can cancel any time before the trial ends from Settings → Billing.",
  },
  clarification_reply: {
    heading: "Provide context",
    body: "Steadii will pick this up in a chat thread, draft a reply with the new info, and bring it back to you.",
    placeholder: "e.g. The Legal Status form is here: https://… ; the deadline they meant is May 15.",
  },
  chat_history_row: {
    confirm: "Confirm",
  },
  chat_view_v2: {
    blob_token_const: "BLOB_READ_WRITE_TOKEN",
  },
  mistake_note_dialog: {
    title: "Add to Mistake Notes",
    title_label: "Title (short problem summary)",
    title_placeholder: "e.g. 2D projectile with wind",
    class_label: "Class",
    class_none: "(none)",
    unit_label: "Unit / chapter",
    difficulty_label: "Difficulty",
    tags_label: "Tags (comma-separated)",
    tags_placeholder: "vectors, integration",
    cancel: "Cancel",
  },
  new_chat_input: {
    attach_aria: "Attach image or PDF",
    ai_ready: "AI Ready",
    send_aria: "Send",
  },
  tool_call_card: {
    delete_target_label: "The agent wants to DELETE:",
    cancel: "Cancel",
    confirm_delete: "Confirm deletion",
  },
  hero_animation_extra: {
    cmd_k: "⌘K",
  },
  voice_demo_extra: {
    caps_key_label: "⇪ Caps",
  },
  markdown_editor_extra: {
    saved_at_label: "Saved at",
    class_label: "Class",
    class_none: "(none)",
    unit_label: "Unit",
    difficulty_label: "Difficulty",
    tags_label: "Tags",
    tags_placeholder: "vectors, integration",
    bold_glyph: "B",
    italic_glyph: "I",
    inline_code_glyph: "</>",
    inline_math_glyph: "ƒ",
    block_math_glyph: "ƒ²",
    heading_glyph: "H",
    edit_tab: "Edit",
    preview_tab: "Preview",
  },
  notion_connect_panel: {
    connected: "Connected.",
    one_thing_first: "One thing to know first",
    permission_screen_prefix: "On Notion's permission screen, select",
    permission_screen_quoted: "\"All pages\"",
    permission_screen_suffix: ". Steadii creates its own workspace for you — you don't need to pre-create a page.",
    bullet_only_steadii: "Steadii only touches pages under the Steadii parent it creates.",
    bullet_single_page: "Picking a single page here is the main reason onboarding gets stuck.",
    got_it: "Got it — show me Connect",
    connect_notion: "Connect Notion",
  },
  drop_zone: {
    remove: "Remove",
    upload_aria: "Upload file",
    drop_prefix: "Drop {hint} here, or",
    drop_separator: "here, or",
    click_to_browse: "click to browse",
    max_size: "Max 20 MB",
  },
  syllabus_wizard: {
    url_label: "URL (web-page syllabi only)",
    url_placeholder: "https://…",
    or_a_prefix: "Or a",
    or_a_pdf_image: "PDF / image",
    or_a_pdf: "PDF",
    blob_warning_prefix: "Image uploads require Vercel Blob. Ask the administrator to configure",
    blob_token_const: "BLOB_READ_WRITE_TOKEN",
    blob_warning_suffix: ". PDF uploads still work.",
    preview_heading: "Preview",
    preview_body: "Edit anything before saving. Leave a field blank to skip it.",
    field_course_name: "Course name",
    field_course_code: "Course code",
    field_term: "Term",
    field_instructor: "Instructor",
    field_grading: "Grading",
    field_attendance: "Attendance",
    field_textbooks: "Textbooks",
    field_office_hours: "Office hours",
    class_link_label: "Class (optional — link this syllabus to a Class)",
    class_none: "(none)",
    schedule_heading: "Schedule",
    start_over: "Start over",
  },
  voice_overlay_extra: {
    send_aria: "Send",
  },
};

export type Messages = MessagesShape;
