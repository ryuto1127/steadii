import type { Messages } from "./en";

export const ja: Messages = {
  brand: {
    name: "Steadii",
    tagline: "学業に、あなただけの AI 秘書を。",
  },
  landing: {
    headline: "学業に、\nあなただけの AI 秘書を。",
    subhead: "話しても、書いても — Steadii が読み、書き、覚える。",
    cta: "Google で続ける",
    cta_request_access: "α アクセスをリクエスト",
    cta_already_approved: "既に承認済の方: サインイン",
    alpha: "α版 — 招待制",
    invite_hint: "α期間中は招待制です。",
    value_props: {
      triage: {
        title: "頼む前にドラフトが揃う",
        body: "受信メールを自動でトリアージし、リスクを分類し、あなたの口調で返信案を準備します。受信箱ではなくキューを開く感覚です。",
      },
      glassbox: {
        title: "ガラス箱：すべて見える",
        body: "各ドラフトには何が発動したか、どの過去メールを参照したか、何を検討したかが添えられています。隠れて動くことはありません。",
      },
      confirm: {
        title: "送信は必ずあなたが承認",
        body: "送信はワンクリック承認＋10 秒の undo を通ります。あなたを通さずに何も出ません。",
      },
      yours: {
        title: "データはあなたのもの",
        body: "間違いノート・シラバス・課題はそのまま保管。読む・検索する・書き出す——いつでも自由、囲い込みません。",
      },
    },
    what_you_do: {
      title: "話すだけ。\nあとは Steadii。",
      subhead:
        "ボタン探しもメニュー操作も不要。チャット入力だけが Steadii の操作画面。",
      you_type_label: "あなたが入力",
      cards: {
        calendar: {
          input: "金曜 14 時に田中先生と meeting",
          action: "予定に追加しました。",
        },
        syllabus: {
          input: "数学 II の試験範囲どこ?",
          action:
            "シラバスを読み取り → 「3〜5章、5/16 中間、§3.4 極限が要注意」。",
        },
        absence: {
          input: "明日大学行けないかも",
          action:
            "今日の教授に欠席連絡 draft、カレンダーに欠席マークを提案。",
        },
      },
    },
    steadii_in_motion: {
      title: "そして、先回りもする。",
      body:
        "シラバス、カレンダー、過去の間違い。Steadii はそれを横断して読み、あなたが見落とすことに気づきます。",
      real_screen: "実画面。モックではありません。",
      step_calendar: "東京旅行 · 5/15 — 5/17",
      step_calendar_meta: "カレンダー · 3 日間の予定を追加",
      step_notification: "重要 — 日程の衝突",
      step_notification_meta:
        "5/16 の数学 II 中間試験と東京旅行が重なります。",
      step_proposal: "衝突を検出",
      step_proposal_meta:
        "参照：シラバス §中間 · カレンダー · 過去の振替メール 2 件",
      action_email: "教授にメール",
      action_reschedule: "旅行を再調整",
      action_dismiss: "閉じる",
    },
    how_it_works: {
      title: "3 ステップで始める。",
      steps: {
        connect: {
          title: "つなぐ",
          body:
            "Google でサインイン。Steadii が受信箱とカレンダーを読み取ります。セットアップは約 90 秒。",
        },
        watch: {
          title: "見守る",
          body:
            "Steadii がメールをトリアージし、衝突を監視し、返信案を準備。すべてが見え、あなたを通さずには何も送られません。",
        },
        trust: {
          title: "育てる",
          body:
            "間違っているときは「閉じる」を押す。Steadii はそこから学びます。使うほど、あなたに合っていきます。",
        },
      },
    },
    glass_box: {
      title: "思考も判断も、見えるところに。",
      paragraph_reasoning:
        "判断の理由はすべて見えます。各ドラフトの推論パネルを開けば、エージェントが読んだもの、比較したこと、参照した過去のメールが確認できます。",
      paragraph_yours:
        "データはあなたのもの。間違いノート・シラバス・課題はそのまま保管。読む・検索する・書き出す——いつでも自由、囲い込みません。",
      paragraph_confirm:
        "送信は必ずあなたを通ります。送信は 10 秒の undo と明示的な承認を経て送られます。低リスクのドラフトを自動送信する段階的自動送信モードはオプトイン、ユーザー単位で切替可能です。",
    },
    founding: {
      headline: "α は招待制。",
      body:
        "Founding メンバーはサインアップ時の料金が永続固定、さらに北米公開（2026 年 9 月）前にすべての新機能を先行利用できます。",
      cta: "α アクセスをリクエスト",
    },
    locale_toggle: {
      en: "EN",
      ja: "JA",
      aria_label: "言語",
    },
    footer: {
      privacy: "プライバシー",
      terms: "利用規約",
      contact: "お問い合わせ",
      subject_to_change: "α · 変更の可能性あり",
    },
    sign_in: "サインイン",
  },
  nav: {
    inbox: "受信箱",
    home: "ホーム",
    chats: "チャット",
    classes: "授業",
    calendar: "カレンダー",
    tasks: "タスク",
    settings: "設定",
  },
  classes: {
    tabs: {
      syllabus: "シラバス",
      assignments: "タスク",
      mistakes: "間違いノート",
      chats: "チャット",
    },
    no_assignments_title: "タスクはまだありません。",
    no_assignments_desc:
      "チャットからSteadiiに追加を頼めます。例：「物理の課題を追加して」。",
    no_term: "（学期未設定）",
    no_term_set: "学期未設定",
    chats_for_class_aria: "この授業のチャット",
    no_chats_tagged_title: "この授業に紐付くチャットはまだありません。",
    no_chats_tagged_desc:
      "チャットで授業名に触れると、Steadii が自動で紐付けます。",
    start_a_chat: "チャットを始める",
    untitled_chat: "無題のチャット",
    actions: {
      edit: "編集",
      delete: "削除",
      cancel: "キャンセル",
      save: "保存",
      saving: "保存中…",
      menu_label: "その他の操作",
    },
    edit_class: {
      button: "授業を編集",
      title: "授業を編集",
      name_label: "授業名",
      code_label: "コード",
      term_label: "学期",
      professor_label: "教員",
      color_label: "カラー",
      saved_toast: "授業を更新しました。",
      save_failed: "授業を保存できませんでした。",
    },
    delete_class: {
      button: "授業を削除",
      confirm_title: "{name} を削除しますか？",
      confirm_body:
        "シラバス {syllabi} 件、タスク {assignments} 件、間違いノート {mistakes} 件も同時に削除されます。この授業を参照しているチャットのタグは外れますが、内容は保持されます。",
      confirm_body_no_cascade:
        "この授業に紐付くシラバス・タスク・間違いノートはありません。参照しているチャットはタグが外れますが、チャット自体は残ります。",
      success_toast: "{name} を削除しました。",
      delete_failed: "授業を削除できませんでした。",
    },
    syllabus: {
      edit_title: "タイトル",
      edit_term: "学期",
      edit_modal_title: "シラバスを編集",
      empty_title: "{className} のシラバスはまだ登録されていません。",
      empty_description:
        "PDF をドロップ、URL を貼り付け、または画像をアップロードすると、Steadii が構造を抽出します。",
      upload_pdf: "PDF をアップロード",
      paste_url: "URL を貼り付け",
      open_original: "原本を開く",
      source: "ソース",
      delete_confirm_title: "このシラバスを削除しますか？",
      delete_confirm_body:
        "取り込み済みのカレンダー予定には影響しません。",
      saved_toast: "シラバスを更新しました。",
      deleted_toast: "シラバスを削除しました。",
      save_failed: "シラバスを保存できませんでした。",
      delete_failed: "シラバスを削除できませんでした。",
    },
    assignments: {
      edit_title: "タイトル",
      edit_due: "締切",
      edit_status: "ステータス",
      edit_priority: "優先度",
      edit_notes: "メモ",
      status_not_started: "未着手",
      status_in_progress: "進行中",
      status_done: "完了",
      priority_low: "低",
      priority_medium: "中",
      priority_high: "高",
      priority_none: "—",
      no_due: "期限なし",
      due_short: "{date} 締切",
      priority_inline: "優先度: {value}",
      delete_confirm_title: "このタスクを削除しますか？",
      delete_confirm_body:
        "このタスクを参照中の Steadii の提案が壊れる可能性があります。",
      saved_toast: "タスクを更新しました。",
      deleted_toast: "タスクを削除しました。",
      save_failed: "タスクを保存できませんでした。",
      delete_failed: "タスクを削除できませんでした。",
    },
    mistakes_grid: {
      empty_title: "{className} の間違いノートはまだありません。",
      empty_description:
        "問題画像をチャットに貼って解説を頼むか、上のボタンから手書きページを取り込んでください。",
      open_chat: "チャットを開く",
      delete_confirm_title: "この間違いノートを削除しますか？",
      delete_confirm_body: "チャットからいつでも作り直せます。",
      deleted_toast: "間違いノートを削除しました。",
      delete_failed: "間違いノートを削除できませんでした。",
    },
  },
  mistakes: {
    add_from_photo: "📷 写真から追加",
    photo_upload_modal_title: "手書きノートを取り込む",
    photo_upload_modal_subtitle:
      "Steadiiはページをそのまま読み取ります。要約も解釈もしません。",
    photo_choose_file: "ファイルを選択",
    photo_supported_formats: "PDF・PNG・JPEG・GIF・WebP に対応",
    photo_extracting: "読み取り中…",
    photo_preview_label: "プレビュー（編集可）",
    photo_title_placeholder: "タイトル（例：「部分積分 — 練習 3」）",
    photo_save_button: "間違いノートに保存",
    photo_cancel: "キャンセル",
    photo_extract_failed:
      "読み取りに失敗しました。もう一度試すか、より鮮明な画像を使ってください。",
    photo_save_failed: "保存に失敗しました。もう一度お試しください。",
    delete_button: "削除",
    delete_confirm_title: "この間違いノートを削除しますか？",
    delete_confirm_body: "チャットからいつでも作り直せます。",
    deleted_toast: "間違いノートを削除しました。",
    delete_failed: "間違いノートを削除できませんでした。",
  },
  login: {
    title: "おかえりなさい",
    subtitle: "大学のGoogleアカウントでサインインしてください。",
    button: "Googleで続ける",
  },
  onboarding: {
    step1: {
      title: "Google を接続",
      one_line:
        "一度の許可で Calendar と Gmail を連携。Steadii が予定の調整・メールのトリアージ・返信案の作成を行います。",
      why_title: "何を許可することになりますか？",
      why_calendar_gmail:
        "Calendar の読み書きと、Gmail の読み取り・修正・送信が可能になります。エージェントが受信メールをトリアージし、確認用に返信案を準備します。あなたの承認と 20 秒の undo を経ないと送信は行われません。許可はいつでも Google アカウントから取り消せます。",
      why_notion:
        "Notion は任意です。設定 → 連携から後でも追加できます。連携すると既存の授業・間違いノート・シラバス・課題を Steadii にインポートできます。",
      button: "Google アクセスを許可",
    },
    step2: {
      title: "他のサービス（任意）",
      one_line:
        "Steadii が見える範囲を広げます — Outlook・学校時間割・Notion。使っていないものはスキップで OK。",
      why_title: "何が連携されますか？",
      why_body:
        "各サービスは Google と同じカレンダー＋タスクの処理パイプラインに繋がります。Microsoft 365 は Outlook の予定と To Do、iCal 購読は学校の時間割フィード（6 時間ごとに同期）、Notion は既存の授業とノートをインポートします。後から設定 → 連携でいつでも追加・削除できます。",
      skip: "あとで設定",
      connect_link: "連携 →",
      add_url_link: "URL を追加 →",
      sources: {
        microsoft: {
          label: "Microsoft 365",
          one_line:
            "Outlook のカレンダーと Microsoft To Do を Google と並べて Steadii に取り込みます。",
        },
        ical: {
          label: "iCal 購読",
          one_line:
            "学校の時間割 URL（.ics）を貼り付けると、締切が Steadii の予定に表示されます。",
        },
        notion: {
          label: "Notion",
          one_line:
            "既存の授業・間違いノート・シラバス・課題を Notion からインポートします。",
        },
      },
    },
  },
  request_access: {
    title: "α アクセスをリクエスト",
    subtitle:
      "Steadii は α 期間中、招待制です。簡単な情報をご記入ください。承認次第メールでお知らせします（通常 24 時間以内）。",
    email_label: "メールアドレス",
    name_label: "名前（任意）",
    university_label: "大学（任意）",
    reason_label: "Steadii で何を解決したいですか？（任意）",
    reason_placeholder: "例: CS のメールが多すぎてトリアージを手伝ってほしい。",
    submit: "リクエストを送信",
    error_invalid_email: "正しいメールアドレスを入力してください。",
    error_rate_limited:
      "短時間に多くのリクエストが届きました。1 時間後にお試しください。",
    back_to_landing: "← トップへ戻る",
  },
  access_pending: {
    title_ja: "ありがとうございます。",
    title_en: "Thanks — request received.",
    body_ja:
      "承認されたら ご記入の email にお知らせします。通常 24 時間以内に確認します。",
    body_en:
      "We'll notify you by email when approved (usually within 24h).",
    already_submitted_hint:
      "既にリクエストを受け付けています。承認次第メールでお知らせします。",
    back_to_landing: "← トップへ戻る",
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
    request_access_cta: "α アクセスをリクエスト →",
  },
  app: {
    welcome: "{name}さん、ようこそ。",
    empty_state: "まだ何もありません。",
  },
  home: {
    today_schedule: "今日の予定",
    due_soon: "まもなく締切",
    past_week: "先週の振り返り",
    no_events: "今日は授業も予定もありません。",
    nothing_due: "締切なし。今は落ち着いています。",
    not_enough_history: "履歴がまだ足りません。来週また見てみてください。",
    counts: "チャット {chats} · 間違い {mistakes} · シラバス {syllabi}",
    review_action: "復習する",
    generate_practice_action: "練習",
    welcome_title: "Steadiiへようこそ",
    welcome_body:
      "最初の授業を登録すると、今日の予定・締切の近い課題・最近の活動が表示されます。",
    add_first_class: "+ 最初の授業を追加",
    welcome_input_placeholder:
      "シラバスや画像を貼ったり、気になることを聞いてみてください…",
    greeting_morning: "おはよう、{name}。",
    greeting_afternoon: "こんにちは、{name}。",
    greeting_evening: "こんばんは、{name}。",
    greeting_night: "まだ起きてる？{name}。",
    summary_ready: "今週の学習サマリーを用意しました。",
    full_calendar: "カレンダー全体",
    assignments_remaining: "今日残っている課題 {count} 件",
    study_sessions: "学習セッション",
    focus_summary: "今週は {hours} 時間集中しました。いいペースです。",
    focus_summary_empty: "まだデータが少なめ。もう少し積み重ねると傾向が見えます。",
  },
  chat_input: {
    placeholder: "Steadiiに聞く…",
    example_prompts: [
      "今週の課題は？",
      "この物理の問題を解説して",
      "金曜までに化学の課題を追加",
      "次の授業は何？",
      "CSC108のシラバスを要約して",
      "似た練習問題を作って",
      "最近の間違いを振り返りたい",
      "先週の勉強時間を教えて",
    ],
  },
  chat: {
    actions: {
      add_to_mistakes: "+ 間違いノートに追加",
      generate_similar: "類題を生成",
      save_mistake: "間違いノートを保存",
    },
    dismiss: "閉じる",
    remove_attachment: "削除",
  },
  voice: {
    hint_caps: "Caps Lock を長押しで話す・タップでチャットを開く",
    hint_alt: "右 ⌥ を長押しで話す・タップでチャットを開く",
    listening_placeholder: "聞いてます…",
    error_mic_denied: "マイクが許可されていません。ブラウザ設定で許可してください。",
    error_transcribe_failed: "うまく読み取れませんでした。もう一度どうぞ。",
    error_rate_limited: "音声入力の回数が多すぎます。少し待ってから再試行してください。",
    error_agent_failed: "Steadii が理解できませんでした。言い換えてもう一度どうぞ。",
    error_operation_partial: "一部の操作が完了しませんでした。UI から再試行してください。",
    warning_cleanup_skipped: "整形をスキップして生の文字起こしを使用しました。",
    confirmation_handoff: "確認が必要な操作です。チャットを開きます。",
    choice_label: "音声メッセージの長さを選択",
    choice_full_words: "そのまま送る（~{n}語）",
    choice_full_chars: "そのまま送る（~{n}字）",
    choice_short_words: "短くして送る（~{n}語）",
    choice_short_chars: "短くして送る（~{n}字）",
    global_listening: "Steadii が聞いています…",
    global_processing: "考えています…",
    global_hint_caps: "Caps Lock をタップでチャット・長押しで話す",
    global_hint_alt: "右 ⌥ をタップでチャット・長押しで話す",
    overlay_label: "Steadii チャット",
    overlay_placeholder: "Steadii に何でも聞いてください…",
    overlay_hint_caps: "Caps Lock をもう一度タップで閉じる・長押しで話す",
    overlay_hint_alt: "右 ⌥ をもう一度タップで閉じる・長押しで話す",
  },
  settings: {
    title: "設定",
    sign_out: "サインアウト",
    no_name: "（名前未設定）",
    sections: {
      profile: "プロフィール",
      connections: "連携",
      resources: "登録リソース",
      agent: "エージェントの挙動",
      usage: "使用量と課金",
      appearance: "外観",
      language: "言語",
      timezone: "タイムゾーン",
      voice: "音声入力",
      danger: "危険な操作",
    },
    voice: {
      description:
        "キーを長押ししている間、Steadii が音声を聞いています。離すと送信。デフォルトは Caps Lock、もしブラウザの挙動が不安定なら右 ⌥ キーに切り替えられます。",
      trigger_label: "トリガーキー",
      trigger_caps: "Caps Lock（デフォルト）",
      trigger_alt: "右 Option（⌥）",
      saved: "保存しました",
      hint_caps: "Caps Lock を長押しで話す",
      hint_alt: "右 ⌥ を長押しで話す",
    },
    connections: {
      workspace_fallback: "ワークスペース",
      connected_to: "{workspaceName} に接続済み",
      setup_complete: "セットアップ完了",
      setup_pending: "セットアップ中",
      not_connected: "未接続",
      disconnect: "接続解除",
      connect: "接続",
      calendar_label: "Google カレンダー",
      calendar_granted: "カレンダー権限を付与済み。",
      calendar_missing: "カレンダー権限がありません。",
      gmail_label: "Gmail",
      gmail_granted:
        "Gmail 権限を付与済み。エージェントが受信箱を分類して下書きを作れます。",
      gmail_missing:
        "Gmail 権限がありません。サインアウトして再度サインインすると付与できます。",
      sign_out_to_reauth: "再認証するにはサインアウト",
      refresh_inbox: "受信箱を再読み込み",
      refresh_inbox_title: "直近 24 時間の Gmail を再取得",
      manage_summary: "Notion・Google・Microsoft 365・iCal フィード。",
      manage_link: "連携を管理",
    },
    resources: {
      description:
        "エージェントが読める Notion ページ（任意）。Steadii 親ページ配下は自動登録、それ以外は URL を貼って追加します。Steadii の学習データは Postgres に保存されるので、既存の Notion ワークスペースから引用させたい場合のみ設定してください。",
      not_connected_hint:
        "Notion が未接続です。上の「連携」から接続するとリソースを登録できます。",
      add_placeholder: "https://notion.so/...",
      add_button: "追加",
      empty: "登録されたリソースはまだありません。",
      auto_registered: "自動登録",
      manual: "手動",
      remove: "削除",
      refresh_from_notion: "Notion から再取得",
    },
    agent_thinks: {
      section_title: "エージェントの思考過程",
      description:
        "直近の判断の振り返りビュー（読み取り専用）。何を取り上げたか、なぜか、どの間違いノート・シラバス断片・カレンダー予定・過去メールを根拠にしたかが見えます。最後までガラス箱。",
      open: "開く",
    },
    agent_rules: {
      section_title: "エージェントのルール",
      description:
        "透明性が前提です。受信箱のトリアージで使うルール（共通キーワード、学習済み連絡先、手動の上書き）はすべて下に並んでいます。",
    },
    notifications_section: "通知",
    staged_autonomy: {
      section_title: "段階的な自律送信",
      description_prefix:
        "オンにすると、低リスクの下書き（現状は中位の返信 — オフィスアワー、締切、日程確認）を Steadii が自動送信します。10 秒の undo は引き続き有効で、受信箱には ",
      description_em: "自動送信",
      description_suffix:
        " ラベルとガラス箱の理由が表示されます。デフォルトはオフ — 送信ごとに確認したい場合はそのまま。",
      toggle_label: "対象の下書きを自動送信（10 秒 undo あり）",
      on: "オン — オフにする",
      off: "オフ — オンにする",
    },
    agent_modes: {
      destructive_only_label:
        "破壊的な操作だけ確認する（推奨）",
      destructive_only_hint:
        "作成・更新は自動。削除は承認待ちで止まります。",
      all_label: "すべての書き込みを確認する",
      all_hint:
        "作成・更新・削除のいずれも承認待ちで止まります。",
      none_label: "確認しない",
      none_hint: "Steadii が即座に実行します。慎重に。",
      save: "保存",
    },
    usage: {
      credits_this_month: "今月のクレジット",
      storage_label: "ストレージ",
    },
    appearance_theme_label: "テーマ",
    language_description:
      "UIの言語を選びます。エージェントの応答はあなたが入力した言語に自動で合わせます。",
    language_option_en: "English",
    language_option_ja: "日本語",
    timezone_description:
      "「明日」などの相対的な日付をこのタイムゾーンで解釈します。初回はブラウザから自動検出されます。",
    timezone_placeholder: "例: Asia/Tokyo",
    timezone_save: "保存",
    timezone_detected: "検出",
    timezone_saved: "保存しました",
    timezone_invalid: "不明なタイムゾーンです",
    danger_zone: {
      account_placeholder:
        "アカウントとすべての関連データを削除します。（α 終了後に提供予定）",
      account_button: "アカウントを削除",
      wipe_data_button: "すべてのデータを削除",
      wipe_data_description:
        "授業・タスク・シラバス・間違いノート・チャット・受信トレイ・アップロードを消去します。アカウント・課金・OAuth 連携はそのまま残ります。",
      wipe_modal: {
        title: "すべてのデータを完全に削除しますか？",
        list_header: "以下が完全に削除されます：",
        list_classes: "授業 {count} 件",
        list_syllabi: "シラバス {count} 件",
        list_mistakes: "間違いノート {count} 件",
        list_assignments: "タスク {count} 件",
        list_chats: "チャット {count} 件（メッセージ {messages} 件）",
        list_inbox: "受信トレイ {count} 件",
        list_proposals: "プロアクティブ提案 {count} 件",
        list_integrations: "連携 {count} 件",
        list_blobs: "アップロード {count} 件（約 {size}）",
        stays_note:
          "アカウント・課金・OAuth 連携はそのまま残ります。",
        irreversible: "この操作は元に戻せません。",
        type_to_confirm: "確認のため DELETE と入力してください",
        type_to_confirm_placeholder: "DELETE",
        cancel: "キャンセル",
        submit: "すべてのデータを削除",
        submitting: "削除中…",
        success_toast: "すべてのデータを削除しました。",
        load_failed: "件数を取得できませんでした。",
        wipe_failed: "削除に失敗しました。",
      },
    },
  },
  billing: {
    page_title: "課金・プラン",
    page_subtitle:
      "α期間中はStripeをテストモードで運用しています。実際の請求は行われませんが、サブスクリプションの状態は反映されます。",
    checkout_completed:
      "決済が完了しました。Stripeのwebhook経由で数秒以内にプランが反映されます。",
    checkout_canceled: "決済をキャンセルしました。プランの変更はありません。",
    founding_member_label: "Founding メンバー。",
    founding_member_body: "現在の料金がそのまま永続的に固定されます。",
    price_locked_until: "料金は {date} まで固定されています。",
    currency_locked:
      "このアカウントは {currency} 表記で固定されています。変更はサポートまでご連絡ください。",
    current_plan: "現在のプラン",
    plan_admin: "Admin（フラグ付与）· 上限なし",
    plan_student: "Student",
    plan_student_renews: "Student · 次回更新 {date}",
    plan_pro_trial: "Pro（14日間トライアル）· {date} まで",
    plan_pro: "Pro",
    plan_pro_renews: "Pro · 次回更新 {date}",
    plan_free: "Free",
    credits_this_cycle: "今期のクレジット",
    credits_unlimited: "（上限なし）",
    admin_quota_unenforced: "Adminバイパス — クレジット上限は適用されません。",
    credits_remaining: "残 {remaining} クレジット · リセット {date}",
    topup_remaining:
      "+ {remaining} トップアップ分（購入から90日で失効）",
    storage: "ストレージ",
    cancel_subscription: "サブスクリプションを解約",
    actions: {
      admin_bypass:
        "Adminバイパスを利用中です — Stripeの定期課金は不要です。",
      upgrade_pro: "Proにアップグレード · {price}",
      upgrade_student: "Student · {price}（学校メールが必要）",
      opening: "開いています…",
      manage_sub: "サブスクリプションを管理",
      add_credits: "クレジットを追加",
      topup_500: "+500クレジット · {price}",
      topup_2000: "+2000クレジット · {price}（25%お得）",
      topup_expiry: "トップアップ分は購入から90日で失効します。",
      stepping_away: "しばらく離れますか？",
      extend_retention: "データ保持を延長 · {price}（12ヶ月）",
      extend_retention_help:
        "デフォルトは解約後120日。これを12ヶ月に延長します。",
    },
  },
  legal: {
    privacy_title: "プライバシーポリシー",
    terms_title: "利用規約",
    placeholder: "これはα版のプレースホルダーです。正式公開前に更新されます。",
    alpha_caveat: "α版 — 内容は変更される可能性があります",
    last_updated: "最終更新日",
    last_updated_date: "2026-04-25",
    privacy: {
      what_we_collect: {
        heading: "取得する情報",
        body:
          "Googleプロフィール（氏名・メールアドレス・アバター）、Google（Calendar・Gmail）へのOAuthトークン、および（任意で連携した場合のみ）NotionへのOAuthトークン（いずれもアプリケーション層でAES-256-GCM暗号化）、Postgresデータベース（Neon）に保存される授業情報・間違いノート・シラバス・課題、チャット履歴、アップロードされたファイルを保存します。デバイスフィンガープリントやトラッキングCookieは取得しません。",
      },
      how_we_use_it: {
        heading: "情報の利用方法",
        body:
          "(1) サービス運営（チャット応答、Gmailトリアージ、Google Calendar・Classroomの読み取り、学習ノートの保存・検索）、(2) プラン上限（クレジット・ストレージ）の管理、(3) エラーログによるデバッグの目的で利用します。OpenAIへのリクエストには、回答に必要な最小限のコンテキストのみを送信します。",
      },
      model_training: {
        heading: "モデル学習について",
        body:
          "OpenAIのAPIはデフォルトで利用者データをモデル学習に使用しません。Steadii側でも学習用途を有効化していません。OpenAI以外のモデルプロバイダは利用していません。",
      },
      third_parties: {
        heading: "第三者（委託先）",
        body:
          "Vercel（ホスティング・エッジキャッシュ・Blobストレージ）、Neon（PostgreSQL、学習データの主データストア）、OpenAI（推論）、Google（認証・Calendar・Classroom・Gmail）、Notion（任意の片方向インポート連携）、Stripe（課金、α期間中はテストモード）、Sentry（エラートラッキング、PIIスクラブ有効）。",
      },
      data_location: {
        heading: "データ保管場所",
        body:
          "α期間中、VercelおよびNeonは主に米国リージョンで運用されます。EUまたは日本国内リージョンでの保管が必要な場合は、サインアップ前に管理者までご連絡ください。",
      },
      retention_deletion: {
        heading: "データ保持・削除",
        body:
          "管理者宛にメールでご連絡いただければ、いつでもアカウントを削除できます。削除依頼から30日以内に、users・accounts・notion_connections・chats・messages・message_attachments・blob_assets（Vercel Blob実体含む）・registered_resources・audit_log・usage_eventsから該当行を削除します。",
      },
      your_rights: {
        heading: "ユーザーの権利",
        body:
          "保有データのコピー請求、訂正、削除をいつでも依頼できます。サインアップ時のメールアドレスから管理者宛にご連絡ください。",
      },
      alpha_caveat: {
        heading: "α版に関する注意",
        body:
          "本ポリシーはα版（招待制・Stripeテストモード）におけるドラフトです。β版もしくは一般公開前に正式版へ差し替えます。重要な変更はサインアップ時のメールアドレス宛にご通知します。",
      },
      appi_purpose: {
        heading: "個人情報の利用目的",
        body:
          "Steadiiは、提供サービスの運営、利用制限の管理、エラーログによるデバッグ、およびアカウントに関する連絡のために個人情報を利用します。個人情報を販売することはなく、広告目的の処理も行いません。",
      },
      appi_third_party: {
        heading: "第三者提供（委託先）",
        body:
          "サービス運営にあたり、以下の委託先に個人情報の取扱いを委託しています：OpenAI（推論）、Google（認証・Calendar・Classroom・Gmail）、Stripe（決済）、Vercel（ホスティング・Blobストレージ）、Neon（PostgreSQLデータベース）、Sentry（エラートラッキング）。各委託先はSteadiiの指示に基づき、目的の達成に必要な範囲でのみ個人情報を取り扱います。",
      },
      appi_cross_border: {
        heading: "国境を越えた個人情報の移転",
        body:
          "OpenAI、Vercel、Neon、Stripe、Sentryの各委託先は、主に米国に所在するサーバーで個人情報を処理します。Googleの各サービスは複数のリージョンにまたがって処理する場合があります。各委託先との間で適切な契約上の保護措置を講じており、各委託先が個人情報の保護に関する法律（APPI）の基準と実質的に同等の個人情報保護プログラムを運用していることを確認しています。",
      },
      appi_contact: {
        heading: "個人情報取扱事業者の連絡先",
        body:
          "個人情報取扱事業者：Steadii（個人事業主）。連絡先：サインアップに使用したメールアドレスから hello@mysteadii.com までご連絡ください。日本居住のユーザーからのお問い合わせは、件名に「APPIに関する依頼」と明記してください。",
      },
      appi_request_procedure: {
        heading: "開示・訂正・利用停止請求の方法",
        body:
          "保有個人情報の開示、内容の訂正、利用停止、または削除をご請求いただけます。アカウント登録メールアドレスから hello@mysteadii.com 宛にメールを送信し、対象となるレコードを明記してください。14日以内にご対応します。手数料は不要です。",
      },
    },
    terms: {
      alpha_status: {
        heading: "α版のステータス",
        body:
          "Steadiiは現在、招待制のα版として提供されています。本サービスは「現状有姿（as-is）」で提供され、いつでも変更または提供停止される可能性があり、特定の目的への適合性を保証するものではありません。α期間中、課金はStripeのテストモードで運用され、実際の請求は発生しません。",
      },
      acceptable_use: {
        heading: "禁止事項",
        body:
          "Steadiiを学術不正に利用しないでください。本エージェントは学習補助ツールであり、推論・解説・整理を行うためのものです。生成された出力をそのまま自分の成果物として評価対象の課題に提出することは、利用者自身の責任となり、所属機関の規程に違反する可能性があります。",
      },
      your_content: {
        heading: "ユーザーコンテンツ",
        body:
          "授業情報、間違いノート、シラバス、添付ファイル、チャットメッセージ、および任意で連携するNotionページなど、Steadiiに入力するすべてのコンテンツの所有権はユーザーに帰属します。Steadiiにはサービス提供目的に限り、これらを処理する限定的なライセンスを付与いただきます。",
      },
      external_services: {
        heading: "外部サービス",
        body:
          "SteadiiはGoogleサービス（Calendar・Classroom・Gmail）、OpenAI、Vercel Blob、Stripeに接続します。Notionは任意連携です。Steadiiの利用にあたっては各サービスの利用規約にも同意したものとみなされます。いずれかのサービスが利用不能となった場合、Steadiiの該当機能はグレースフルにデグレードします。",
      },
      plan_limits: {
        heading: "プラン上限",
        body:
          "Free：月300クレジット、ファイル1個あたり5MB、合計200MBまで。ProおよびStudent：月1,000クレジット、ファイル1個あたり50MB、合計2GBまで。1クレジットは概ね$0.005相当のモデル利用量です。各上限は事前通知のうえ変更される場合があります。",
      },
      founding_member: {
        heading: "Founding メンバー価格固定",
        body:
          "最初に有料登録された100名のPro/Studentユーザーおよびすべてのαご招待者は「Founding メンバー」となります。Foundingメンバーは、サブスクリプションを継続している限り、サインアップ時の料金が固定され、その後の価格改定の影響を受けません。101名目以降のユーザーは、初回支払い期間から12ヶ月間の価格固定が適用されます。",
      },
      termination: {
        heading: "解除・終了",
        body:
          "ユーザーはいつでもSteadiiの利用を停止できます。本規約に違反した場合、Steadiiはアクセスを停止することがあります。終了時のデータ削除はプライバシーポリシーに従います。",
      },
      liability: {
        heading: "責任の制限",
        body:
          "適用法令で認められる最大限の範囲において、Steadiiは本サービスの利用に起因する間接的、結果的、または付随的損害（締切の遅延、回答の誤り等を含む）について責任を負いません。",
      },
      contact: {
        heading: "お問い合わせ",
        body:
          "ご質問や削除依頼は hello@mysteadii.com 宛にメールいただくか、オンボーディング時に届いたメールにご返信ください。",
      },
    },
  },
  seed_prompts: {
    review_recent_mistakes:
      "最近1週間の間違いノートから、特に復習した方がよいものを3件挙げて、それぞれのポイントを短くまとめてください。",
    generate_similar_problems:
      "最近1週間の間違いノートのパターンを元に、似た形式の練習問題を3題作成してください。解答は伏せておいてください。",
  },
};
