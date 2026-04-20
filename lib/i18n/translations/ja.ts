import type { Messages } from "./en";

export const ja: Messages = {
  brand: {
    name: "Steadii",
    tagline: "学期を、淡々と乗り切る。",
  },
  landing: {
    headline: "学期を、淡々と乗り切る。",
    subhead: "授業、課題、間違い — すべてひとつの会話で。",
    cta: "Googleで続ける",
    alpha: "α版 — 招待制",
    invite_hint: "α期間中は招待制です。",
    value_props: {
      conversation: {
        title: "会話ひとつで",
        body: "授業のことは何でもSteadiiに聞いてください。Notionとカレンダーを読んで答えます。",
      },
      notion: {
        title: "Notionネイティブ",
        body: "間違いノート・シラバス・課題はあなた自身のNotionに残ります。整理はするが、囲い込まない。",
      },
      verbatim: {
        title: "原文を残す",
        body: "シラバスは元のPDFと完全な原文テキストも保存。要約で情報を落としません。",
      },
    },
    mock: {
      today_schedule: "今日の予定",
      due_soon: "まもなく締切",
      past_week: "先週の振り返り",
      past_week_window: "4/13 — 4/20",
      past_week_counts:
        "チャット {chats} · 間違い {mistakes} · シラバス {syllabi}",
      past_week_pattern: "自由落下問題で3回詰まりました",
      csc108_lecture: "CSC108 講義",
      office_hours: "オフィスアワー",
      mat135_tutorial: "MAT135 演習",
      physics_ps4: "物理 PS 4",
      essay_outline: "レポートの構成",
      mat135_hw: "MAT135 課題",
      in_14h: "14時間後",
      in_2d: "2日後",
      in_3d: "3日後",
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
    home: "ホーム",
    chats: "チャット",
    classes: "授業",
    calendar: "カレンダー",
    settings: "設定",
  },
  login: {
    title: "おかえりなさい",
    subtitle: "大学のGoogleアカウントでサインインしてください。",
    button: "Googleで続ける",
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
    generate_practice_action: "練習問題を生成",
    welcome_title: "Steadiiへようこそ",
    welcome_body:
      "最初の授業を登録すると、今日の予定・締切の近い課題・最近の活動が表示されます。",
    add_first_class: "+ 最初の授業を追加",
    welcome_input_placeholder:
      "シラバスや画像を貼ったり、気になることを聞いてみてください…",
  },
  chat_input: {
    placeholder: "Steadiiに何でも聞いてみてください…",
    send_hint: "⌘⏎ で送信",
  },
  settings: {
    title: "設定",
    sign_out: "サインアウト",
    sections: {
      profile: "プロフィール",
      connections: "連携",
      resources: "登録リソース",
      agent: "エージェントの挙動",
      usage: "使用量と課金",
      redeem: "コード入力",
      appearance: "外観",
      language: "言語",
      danger: "危険な操作",
    },
    appearance_theme_label: "テーマ",
    language_description:
      "UIの言語を選びます。エージェントの応答はあなたが入力した言語に自動で合わせます。",
    language_option_en: "English",
    language_option_ja: "日本語",
  },
  legal: {
    privacy_title: "プライバシーポリシー",
    terms_title: "利用規約",
    placeholder: "これはα版のプレースホルダーです。正式公開前に更新されます。",
  },
};
