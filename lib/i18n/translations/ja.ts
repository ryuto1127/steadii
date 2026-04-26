import type { Messages } from "./en";

export const ja: Messages = {
  brand: {
    name: "Steadii",
    tagline: "学期を、淡々と乗り切る。",
  },
  landing: {
    headline: "学期を、淡々と乗り切る。",
    subhead:
      "Steadiiが大学のメールをトリアージし、アプリを開く前に返信案を用意します。すべての理由が見え、いつでも編集でき、送信は必ずあなたが承認します。",
    cta: "Googleで続ける",
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
        body: "送信はワンクリック承認＋20秒のundoを通ります。あなたを通さずに何も出ません。",
      },
      yours: {
        title: "データはあなたのもの",
        body: "間違いノート・シラバス・課題はそのまま保管。読む・検索する・書き出す——いつでも自由、囲い込みません。",
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
    send_hint: "⌘⏎ で送信",
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
  settings: {
    title: "設定",
    sign_out: "サインアウト",
    sections: {
      profile: "プロフィール",
      connections: "連携",
      resources: "登録リソース",
      agent: "エージェントの挙動",
      usage: "使用量と課金",
      appearance: "外観",
      language: "言語",
      timezone: "タイムゾーン",
      danger: "危険な操作",
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
          "個人情報取扱事業者：Steadii（個人事業主）。連絡先：サインアップに使用したメールアドレスから hello@mysteadii.xyz までご連絡ください。日本居住のユーザーからのお問い合わせは、件名に「APPIに関する依頼」と明記してください。",
      },
      appi_request_procedure: {
        heading: "開示・訂正・利用停止請求の方法",
        body:
          "保有個人情報の開示、内容の訂正、利用停止、または削除をご請求いただけます。アカウント登録メールアドレスから hello@mysteadii.xyz 宛にメールを送信し、対象となるレコードを明記してください。14日以内にご対応します。手数料は不要です。",
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
          "ご質問や削除依頼は hello@mysteadii.xyz 宛にメールいただくか、オンボーディング時に届いたメールにご返信ください。",
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
