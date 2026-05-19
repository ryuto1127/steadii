// Friendly display labels for IANA timezone IDs.
//
// The IANA database uses `<continent>/<city>` keys — `America/Vancouver`,
// `America/Toronto`, `Asia/Tokyo`, etc. The `America/` prefix is a historical
// convention for the continent and does NOT indicate the country (Vancouver
// and Toronto are in Canada). Users — reasonably — read "America/Vancouver"
// as "USA" and find it jarring. Surfacing the raw IANA ID in user-facing
// UI is an avoidable identity-leak.
//
// Internal storage / date-time math continues to use the IANA ID — that's
// the canonical form for `Intl.DateTimeFormat` / `Temporal` / `tzdata`.
// These labels are display-layer only.

export type LocaleKey = "en" | "ja";

export const FRIENDLY_TZ_LABELS: Record<LocaleKey, Record<string, string>> = {
  en: {
    "America/Vancouver": "Vancouver, Canada (Pacific)",
    "America/Los_Angeles": "Los Angeles, USA (Pacific)",
    "America/Denver": "Denver, USA (Mountain)",
    "America/Chicago": "Chicago, USA (Central)",
    "America/New_York": "New York, USA (Eastern)",
    "America/Toronto": "Toronto, Canada (Eastern)",
    "America/Mexico_City": "Mexico City, Mexico (Central)",
    "America/Sao_Paulo": "São Paulo, Brazil",
    "Europe/London": "London, UK (GMT/BST)",
    "Europe/Paris": "Paris, France (CET/CEST)",
    "Europe/Berlin": "Berlin, Germany (CET/CEST)",
    "Europe/Madrid": "Madrid, Spain (CET/CEST)",
    "Europe/Rome": "Rome, Italy (CET/CEST)",
    "Europe/Amsterdam": "Amsterdam, Netherlands (CET/CEST)",
    "Europe/Moscow": "Moscow, Russia",
    "Africa/Cairo": "Cairo, Egypt",
    "Africa/Johannesburg": "Johannesburg, South Africa",
    "Asia/Dubai": "Dubai, UAE",
    "Asia/Kolkata": "Kolkata, India",
    "Asia/Bangkok": "Bangkok, Thailand",
    "Asia/Singapore": "Singapore",
    "Asia/Hong_Kong": "Hong Kong",
    "Asia/Shanghai": "Shanghai, China",
    "Asia/Taipei": "Taipei, Taiwan",
    "Asia/Tokyo": "Tokyo, Japan (JST)",
    "Asia/Seoul": "Seoul, South Korea (KST)",
    "Australia/Sydney": "Sydney, Australia",
    "Pacific/Auckland": "Auckland, New Zealand",
    UTC: "UTC (Coordinated Universal Time)",
  },
  ja: {
    "America/Vancouver": "バンクーバー (カナダ・太平洋時間)",
    "America/Los_Angeles": "ロサンゼルス (米国・太平洋時間)",
    "America/Denver": "デンバー (米国・山岳部時間)",
    "America/Chicago": "シカゴ (米国・中部時間)",
    "America/New_York": "ニューヨーク (米国・東部時間)",
    "America/Toronto": "トロント (カナダ・東部時間)",
    "America/Mexico_City": "メキシコシティ (メキシコ・中部時間)",
    "America/Sao_Paulo": "サンパウロ (ブラジル)",
    "Europe/London": "ロンドン (英国・GMT/BST)",
    "Europe/Paris": "パリ (フランス・CET/CEST)",
    "Europe/Berlin": "ベルリン (ドイツ・CET/CEST)",
    "Europe/Madrid": "マドリード (スペイン・CET/CEST)",
    "Europe/Rome": "ローマ (イタリア・CET/CEST)",
    "Europe/Amsterdam": "アムステルダム (オランダ・CET/CEST)",
    "Europe/Moscow": "モスクワ (ロシア)",
    "Africa/Cairo": "カイロ (エジプト)",
    "Africa/Johannesburg": "ヨハネスブルグ (南アフリカ)",
    "Asia/Dubai": "ドバイ (UAE)",
    "Asia/Kolkata": "コルカタ (インド)",
    "Asia/Bangkok": "バンコク (タイ)",
    "Asia/Singapore": "シンガポール",
    "Asia/Hong_Kong": "香港",
    "Asia/Shanghai": "上海 (中国)",
    "Asia/Taipei": "台北 (台湾)",
    "Asia/Tokyo": "東京 (JST)",
    "Asia/Seoul": "ソウル (韓国・KST)",
    "Australia/Sydney": "シドニー (オーストラリア)",
    "Pacific/Auckland": "オークランド (ニュージーランド)",
    UTC: "UTC (協定世界時)",
  },
};

export function friendlyTimezoneLabel(
  iana: string,
  locale: LocaleKey,
): string {
  return FRIENDLY_TZ_LABELS[locale][iana] ?? iana;
}
