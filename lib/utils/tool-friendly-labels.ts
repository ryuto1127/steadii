// Centralized human-readable labels for every tool the agent can call.
// Used by:
//   - components/chat/tool-call-summary.tsx (compact chip sequence)
//   - components/chat/tool-call-card.tsx (expanded per-tool rows)
//
// Two modes per locale:
//   - running: present-progressive verb phrase shown while the call is
//     in flight ("メールを探しています…" / "Searching emails…")
//   - done: past-tense / nominal phrase shown once the call settles
//     ("メールを探す" / "Searched emails")
//
// The compact chip uses the `done` form by default and switches to the
// `running` form for the in-flight tool during streaming. The expanded
// card uses whichever matches the row's status.
//
// 2026-05-14 — added after Ryuto's dogfood revealed raw tool IDs
// (`save_working_hours → convert_timezone × 2`) leaking into the
// user-facing chip. Engineering identifiers are useless for an end user.

export type ToolLabelLocale = "ja" | "en";

export type ToolLabel = {
  running: string;
  done: string;
};

type LocaleMap = Record<string, ToolLabel>;

const JA_LABELS: LocaleMap = {
  // Email
  email_search: { running: "メールを探しています", done: "メールを探す" },
  email_get_body: { running: "本文を確認しています", done: "本文を確認" },
  email_get_new_content_only: {
    running: "新規本文を取得しています",
    done: "新規本文を取得",
  },
  email_thread_summarize: {
    running: "スレッドを要約しています",
    done: "スレッドを要約",
  },
  gmail_send: { running: "メールを送信しています", done: "メールを送信" },

  // Calendar
  calendar_list_events: {
    running: "カレンダーを確認しています",
    done: "カレンダーを確認",
  },
  calendar_create_event: {
    running: "予定を作成しています",
    done: "予定を作成",
  },
  calendar_update_event: {
    running: "予定を更新しています",
    done: "予定を更新",
  },
  calendar_delete_event: {
    running: "予定を削除しています",
    done: "予定を削除",
  },

  // Time / location reasoning
  convert_timezone: {
    running: "時差を変換しています",
    done: "時差を変換",
  },
  infer_sender_timezone: {
    running: "送信者の時差を推測しています",
    done: "送信者の時差を推測",
  },

  // Entity / facts / memory
  lookup_entity: {
    running: "関連情報を探しています",
    done: "関連情報を確認",
  },
  save_user_fact: {
    running: "ユーザー情報を記録しています",
    done: "ユーザー情報を記録",
  },
  save_working_hours: {
    running: "対応可能時間帯を保存しています",
    done: "対応可能時間帯を保存",
  },

  // Tasks
  tasks_list: { running: "タスクを確認しています", done: "タスクを確認" },
  tasks_create: { running: "タスクを作成しています", done: "タスクを作成" },
  tasks_update: { running: "タスクを更新しています", done: "タスクを更新" },
  tasks_complete: {
    running: "タスクを完了にしています",
    done: "タスクを完了",
  },
  tasks_delete: { running: "タスクを削除しています", done: "タスクを削除" },

  // Assignments (course-level)
  assignments_create: {
    running: "課題を登録しています",
    done: "課題を登録",
  },

  // Classes
  class_create: { running: "授業を登録しています", done: "授業を登録" },

  // Classroom / iCal / syllabus
  classroom_list_courses: {
    running: "Classroom を確認しています",
    done: "Classroom を確認",
  },
  classroom_list_coursework: {
    running: "Classroom の課題を確認しています",
    done: "Classroom の課題を確認",
  },
  classroom_list_announcements: {
    running: "Classroom のお知らせを確認しています",
    done: "Classroom のお知らせを確認",
  },
  ical_subscribe: {
    running: "カレンダーフィードを登録しています",
    done: "カレンダーフィードを登録",
  },
  syllabus_extract: {
    running: "シラバスを読み取っています",
    done: "シラバスを読み取り",
  },
  read_syllabus_full_text: {
    running: "シラバス本文を確認しています",
    done: "シラバス本文を確認",
  },

  // Notion
  notion_search_pages: {
    running: "Notion を検索しています",
    done: "Notion を検索",
  },
  notion_get_page: {
    running: "Notion のページを確認しています",
    done: "Notion のページを確認",
  },
  notion_create_page: {
    running: "Notion ページを作成しています",
    done: "Notion ページを作成",
  },
  notion_update_page: {
    running: "Notion ページを更新しています",
    done: "Notion ページを更新",
  },
  notion_delete_page: {
    running: "Notion ページを削除しています",
    done: "Notion ページを削除",
  },
  notion_query_database: {
    running: "Notion データベースを検索しています",
    done: "Notion データベースを検索",
  },
  notion_create_row: {
    running: "Notion に行を追加しています",
    done: "Notion に行を追加",
  },
  notion_update_row: {
    running: "Notion の行を更新しています",
    done: "Notion の行を更新",
  },

  // Misc
  summarize_week: {
    running: "今週の振り返りを作成しています",
    done: "今週の振り返り",
  },
  schedule_office_hours: {
    running: "オフィスアワーを調整しています",
    done: "オフィスアワーを調整",
  },
  resolve_clarification: {
    running: "確認内容をまとめています",
    done: "確認内容をまとめ",
  },
};

const EN_LABELS: LocaleMap = {
  // Email
  email_search: { running: "Searching emails", done: "Searched emails" },
  email_get_body: { running: "Reading email body", done: "Read email body" },
  email_get_new_content_only: {
    running: "Reading new content only",
    done: "Read new content only",
  },
  email_thread_summarize: {
    running: "Summarizing thread",
    done: "Summarized thread",
  },
  gmail_send: { running: "Sending email", done: "Sent email" },

  // Calendar
  calendar_list_events: { running: "Reading calendar", done: "Read calendar" },
  calendar_create_event: {
    running: "Creating calendar event",
    done: "Calendar event created",
  },
  calendar_update_event: {
    running: "Updating calendar event",
    done: "Calendar event updated",
  },
  calendar_delete_event: {
    running: "Deleting calendar event",
    done: "Calendar event deleted",
  },

  // Time / location reasoning
  convert_timezone: { running: "Converting time zone", done: "Converted time zone" },
  infer_sender_timezone: {
    running: "Detecting sender's timezone",
    done: "Detected sender's timezone",
  },

  // Entity / facts / memory
  lookup_entity: {
    running: "Looking up related info",
    done: "Looked up related info",
  },
  save_user_fact: {
    running: "Saving fact about you",
    done: "Saved fact about you",
  },
  save_working_hours: {
    running: "Saving meeting hours",
    done: "Saved meeting hours",
  },

  // Tasks
  tasks_list: { running: "Reading tasks", done: "Read tasks" },
  tasks_create: { running: "Creating task", done: "Task created" },
  tasks_update: { running: "Updating task", done: "Task updated" },
  tasks_complete: { running: "Completing task", done: "Task completed" },
  tasks_delete: { running: "Deleting task", done: "Task deleted" },

  // Assignments (course-level)
  assignments_create: { running: "Adding assignment", done: "Assignment added" },

  // Classes
  class_create: { running: "Adding class", done: "Class added" },

  // Classroom / iCal / syllabus
  classroom_list_courses: {
    running: "Reading Classroom courses",
    done: "Read Classroom courses",
  },
  classroom_list_coursework: {
    running: "Reading Classroom coursework",
    done: "Read Classroom coursework",
  },
  classroom_list_announcements: {
    running: "Reading Classroom announcements",
    done: "Read Classroom announcements",
  },
  ical_subscribe: {
    running: "Subscribing to calendar feed",
    done: "Subscribed to calendar feed",
  },
  syllabus_extract: { running: "Reading syllabus", done: "Syllabus read" },
  read_syllabus_full_text: {
    running: "Reading syllabus source",
    done: "Read syllabus source",
  },

  // Notion
  notion_search_pages: { running: "Searching Notion", done: "Searched Notion" },
  notion_get_page: { running: "Reading Notion page", done: "Read Notion page" },
  notion_create_page: {
    running: "Creating Notion page",
    done: "Notion page created",
  },
  notion_update_page: {
    running: "Updating Notion page",
    done: "Notion page updated",
  },
  notion_delete_page: {
    running: "Deleting Notion page",
    done: "Notion page deleted",
  },
  notion_query_database: {
    running: "Querying Notion database",
    done: "Queried Notion database",
  },
  notion_create_row: { running: "Adding Notion row", done: "Notion row added" },
  notion_update_row: {
    running: "Updating Notion row",
    done: "Notion row updated",
  },

  // Misc
  summarize_week: {
    running: "Summarizing past week",
    done: "Summarized past week",
  },
  schedule_office_hours: {
    running: "Scheduling office hours",
    done: "Office hours scheduled",
  },
  resolve_clarification: {
    running: "Wrapping up clarification",
    done: "Clarification resolved",
  },
};

const LOCALE_MAPS: Record<ToolLabelLocale, LocaleMap> = {
  ja: JA_LABELS,
  en: EN_LABELS,
};

// Fallback when a tool ID is missing from the map. Replaces underscores
// with spaces so `tasks_complete` reads as "tasks complete" rather than
// the raw identifier. Better than exposing the engineering name but
// adding the explicit entry above is always preferred — keep the map
// up to date when a new tool ships.
function fallback(tool: string): ToolLabel {
  const pretty = tool.replaceAll("_", " ");
  return { running: pretty, done: pretty };
}

export function toolLabel(
  tool: string,
  locale: ToolLabelLocale = "en"
): ToolLabel {
  return LOCALE_MAPS[locale][tool] ?? fallback(tool);
}

// Compact helpers for the chip + card consumers.
export function toolLabelRunning(
  tool: string,
  locale: ToolLabelLocale = "en"
): string {
  return toolLabel(tool, locale).running;
}

export function toolLabelDone(
  tool: string,
  locale: ToolLabelLocale = "en"
): string {
  return toolLabel(tool, locale).done;
}
