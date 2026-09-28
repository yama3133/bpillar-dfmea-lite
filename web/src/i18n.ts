import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const LANGS = ['ja', 'en', 'ar', 'zh-CN'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'ja';
const STORAGE_KEY = 'dfmea.lang';

/** Native names for the language switcher. */
export const NATIVE_NAMES: Record<Lang, string> = { ja: '日本語', en: 'English', ar: 'العربية', 'zh-CN': '简体中文' };

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);
export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');
/** Intl locale; Arabic keeps Latin digits so numbers read the same across languages. */
export const intlLocale = (lang: Lang) => (lang === 'ar' ? 'ar-u-nu-latn' : lang);

/**
 * Bidi isolation for values interpolated into translated strings (plain-text equivalent of <bdi>).
 * ltr: identifiers, IRIs, versions, e-mail addresses. auto: free text whose direction is unknown.
 */
export const isoLtr = (v: unknown) => `\u2066${String(v)}\u2069`;
export const isoAuto = (v: unknown) => `\u2068${String(v)}\u2069`;

export const STATUS_KEYS = [
  'notStarted', 'inProgress', 'ACCEPTED', 'ANALYZING', 'VALIDATED', 'WAITING_HITL', 'HITL_DECIDED',
  'completed', 'rejected_by_reviewer', 'failed',
] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];
export type ValidationCode = 'OK' | 'UNRESOLVED_IRI' | 'BROKEN_CAUSAL_PATH' | 'COMPONENT_MISMATCH';
export type DecisionKey = 'approve' | 'reject';

/** Looks up a server-provided code; unknown codes are shown as-is. */
export const lookup = (m: Record<string, string>, code: string): string => m[code] ?? code;

const ja = {
  langNames: { ja: '日本語', en: '英語', ar: 'アラビア語', 'zh-CN': '中国語(簡体字)' } as Record<Lang, string>,
  uiLanguage: '表示言語',
  loading: '読み込み中…',
  configLoadFailed: (m: string) => `設定の読み込みに失敗しました: ${m}`,
  logout: 'ログアウト',
  // Login
  signInTitle: 'サインイン',
  email: 'メールアドレス',
  password: 'パスワード',
  signingIn: 'サインイン中…',
  signIn: 'サインイン',
  // New review
  newReviewTitle: '新規レビュー',
  ontologyVersion: 'オントロジーのバージョン',
  presets: 'プリセット:',
  target: '対象部品 / インターフェース',
  selectPlaceholder: '選択してください',
  kind: { Component: '部品', Interface: 'インターフェース' },
  scenario: 'シナリオ',
  outputLanguageHint: (l: string) => `AIの所見(根拠・推奨対策)は${l}で作成されます。作成後に表示言語を切り替えても再生成はされません。`,
  startReview: 'レビュー開始',
  // Review detail
  reviewTitle: 'レビュー',
  status: '状態',
  connected: '● 接続中',
  disconnected: '○ 未接続',
  targetShort: '対象',
  ontology: 'オントロジー',
  analysis: '分析',
  analysisValue: (sec: string, tokens: string) => `${sec}秒 / ${tokens} トークン`,
  decision: '判断',
  aiLanguage: 'AI出力の言語',
  aiLanguageNote: 'レビュー作成時の言語です。表示言語を切り替えても既存レビューのAI出力は再生成されません。',
  aiLanguageUnknown: '記録なし(多言語対応前のレビュー)',
  statuses: {
    notStarted: '開始待ち', inProgress: '進行中', ACCEPTED: '受付済み', ANALYZING: '分析中', VALIDATED: '検証済み',
    WAITING_HITL: '判断待ち', HITL_DECIDED: '判断済み', completed: '完了', rejected_by_reviewer: '担当者が却下', failed: '失敗',
  } as Record<StatusKey, string>,
  decisions: { approve: '承認', reject: '却下' } as Record<DecisionKey, string>,
  // HITL
  hitlTitle: 'レビュー担当者の判断が必要です',
  hitlBody: (th: string) => `信頼度が閾値 ${th} 未満の所見があります。`,
  confidenceValue: (c: string) => `信頼度 ${c}`,
  comment: 'コメント',
  approve: '承認',
  reject: '却下',
  // Findings
  findingsTitle: '所見(RPN降順)',
  col: {
    failureMode: '故障モード', causePath: '原因パス', effect: '影響', confidence: '信頼度', validation: '検証',
    severity: '重大度 (Severity)', occurrence: '発生度 (Occurrence)', detection: '検出度 (Detection)',
    rpn: 'リスク優先数 (RPN = S×O×D)',
  },
  notValidated: '未検証',
  noAccepted: '検証を通過した所見はありません。',
  pendingValidation: '検証待ち',
  rejectedSummary: (n: number) => `検証で却下された所見(${n}件)`,
  rationaleSummary: (id: string) => `${id} の根拠と推奨対策`,
  validationCodes: {
    OK: 'オントロジー上の検証をすべて通過',
    UNRESOLVED_IRI: 'IRIが期待するクラスに解決できません',
    BROKEN_CAUSAL_PATH: '原因パスの隣接ノード間に直接の辺がありません',
    COMPONENT_MISMATCH: '故障モードの発生箇所が対象と一致しません',
  } as Record<ValidationCode, string>,
  // Timeline
  eventsTitle: 'イベント',
  waitingEvents: 'イベント待ち…',
  evt: {
    accepted: (l?: string) => (l ? `レビューを受け付けました(AI出力: ${l})` : 'レビューを受け付けました'),
    pinned: (v: string) => `オントロジー v${v} を固定しました`,
    agentStarted: (a: string) => `${a} が開始`,
    agentFinished: (a: string, sec: string) => `${a} が完了(${sec}秒)`,
    proposed: (n: number, tokens: string) => `所見 ${n} 件を提案 / ${tokens} トークン`,
    validation: (a: number, r: number, hitl: boolean) => `通過 ${a} / 却下 ${r}${hitl ? ' / 担当者の判断が必要' : ''}`,
    hitlRequired: (th: string) => `信頼度 ${th} 未満の所見があります`,
    hitlDecided: (d: string, by: string) => `${by} が${d}しました`,
    completed: (s: string) => `レビュー終了: ${s}`,
    failed: (e: string) => `失敗: ${e}`,
  },
  // Errors
  errors: {
    api: (status: number, m: string) => `リクエストに失敗しました(HTTP ${status}): ${m}`,
    wsConnect: 'リアルタイム接続(WebSocket)に失敗しました。自動で再接続します。',
    signInNextStep: (step: string) => `サインインに追加の手順が必要です: ${step}`,
    badCredentials: 'メールアドレスまたはパスワードが正しくありません。',
    tooManyAttempts: '試行回数が多すぎます。しばらく待ってから再度お試しください。',
    generic: (m: string) => `エラーが発生しました: ${m}`,
  },
};

export type Messages = typeof ja;

const en: Messages = {
  langNames: { ja: 'Japanese', en: 'English', ar: 'Arabic', 'zh-CN': 'Chinese (Simplified)' },
  uiLanguage: 'Display language',
  loading: 'Loading…',
  configLoadFailed: (m) => `Couldn't load the configuration: ${m}`,
  logout: 'Sign out',
  signInTitle: 'Sign in',
  email: 'Email',
  password: 'Password',
  signingIn: 'Signing in…',
  signIn: 'Sign in',
  newReviewTitle: 'New review',
  ontologyVersion: 'Ontology version',
  presets: 'Presets:',
  target: 'Component / interface',
  selectPlaceholder: 'Select one',
  kind: { Component: 'Components', Interface: 'Interfaces' },
  scenario: 'Scenario',
  outputLanguageHint: (l) => `The AI findings (rationale and recommended actions) will be written in ${l}. Switching the display language later does not regenerate them.`,
  startReview: 'Start review',
  reviewTitle: 'Review',
  status: 'Status',
  connected: '● Live',
  disconnected: '○ Offline',
  targetShort: 'Target',
  ontology: 'Ontology',
  analysis: 'Analysis',
  analysisValue: (sec, tokens) => `${sec}s / ${tokens} tokens`,
  decision: 'Decision',
  aiLanguage: 'AI output language',
  aiLanguageNote: 'Set when the review was created. Switching the display language does not regenerate the AI output of existing reviews.',
  aiLanguageUnknown: 'Not recorded (created before multilingual support)',
  statuses: {
    notStarted: 'Not started', inProgress: 'In progress', ACCEPTED: 'Accepted', ANALYZING: 'Analyzing', VALIDATED: 'Validated',
    WAITING_HITL: 'Awaiting decision', HITL_DECIDED: 'Decided', completed: 'Completed', rejected_by_reviewer: 'Rejected by reviewer', failed: 'Failed',
  },
  decisions: { approve: 'approved', reject: 'rejected' },
  hitlTitle: 'A reviewer decision is required',
  hitlBody: (th) => `Some findings have a confidence below the ${th} threshold.`,
  confidenceValue: (c) => `confidence ${c}`,
  comment: 'Comment',
  approve: 'Approve',
  reject: 'Reject',
  findingsTitle: 'Findings (by RPN, highest first)',
  col: {
    failureMode: 'Failure mode', causePath: 'Cause path', effect: 'Effect', confidence: 'Confidence', validation: 'Validation',
    severity: 'Severity', occurrence: 'Occurrence', detection: 'Detection', rpn: 'Risk priority number (S×O×D)',
  },
  notValidated: 'Not validated',
  noAccepted: 'No findings passed validation.',
  pendingValidation: 'Awaiting validation',
  rejectedSummary: (n) => `Findings rejected by validation (${n})`,
  rationaleSummary: (id) => `Rationale and recommended actions for ${id}`,
  validationCodes: {
    OK: 'Passed all ontology checks',
    UNRESOLVED_IRI: 'An IRI does not resolve to the expected class',
    BROKEN_CAUSAL_PATH: 'Adjacent nodes in the cause path are not directly linked',
    COMPONENT_MISMATCH: 'The failure mode does not occur at the target',
  },
  eventsTitle: 'Events',
  waitingEvents: 'Waiting for events…',
  evt: {
    accepted: (l) => (l ? `Review accepted (AI output: ${l})` : 'Review accepted'),
    pinned: (v) => `Pinned ontology v${v}`,
    agentStarted: (a) => `${a} started`,
    agentFinished: (a, sec) => `${a} finished (${sec}s)`,
    proposed: (n, tokens) => `${n} finding${n === 1 ? '' : 's'} proposed / ${tokens} tokens`,
    validation: (a, r, hitl) => `${a} passed / ${r} rejected${hitl ? ' / reviewer decision needed' : ''}`,
    hitlRequired: (th) => `Findings below confidence ${th}`,
    hitlDecided: (d, by) => `${by} ${d} the review`,
    completed: (s) => `Review finished: ${s}`,
    failed: (e) => `Failed: ${e}`,
  },
  errors: {
    api: (status, m) => `Request failed (HTTP ${status}): ${m}`,
    wsConnect: "Couldn't open the live connection (WebSocket). Retrying automatically.",
    signInNextStep: (step) => `Sign-in needs an additional step: ${step}`,
    badCredentials: 'Incorrect email or password.',
    tooManyAttempts: 'Too many attempts. Please wait a moment and try again.',
    generic: (m) => `Something went wrong: ${m}`,
  },
};

const ar: Messages = {
  langNames: { ja: 'اليابانية', en: 'الإنجليزية', ar: 'العربية', 'zh-CN': 'الصينية المبسطة' },
  uiLanguage: 'لغة العرض',
  loading: 'جارٍ التحميل…',
  configLoadFailed: (m) => `تعذّر تحميل الإعدادات: ${m}`,
  logout: 'تسجيل الخروج',
  signInTitle: 'تسجيل الدخول',
  email: 'البريد الإلكتروني',
  password: 'كلمة المرور',
  signingIn: 'جارٍ تسجيل الدخول…',
  signIn: 'تسجيل الدخول',
  newReviewTitle: 'مراجعة جديدة',
  ontologyVersion: 'إصدار الأنطولوجيا',
  presets: 'إعدادات جاهزة:',
  target: 'المكوّن / واجهة الربط',
  selectPlaceholder: 'اختر عنصرًا',
  kind: { Component: 'المكوّنات', Interface: 'واجهات الربط' },
  scenario: 'السيناريو',
  outputLanguageHint: (l) => `ستُكتب نتائج الذكاء الاصطناعي (المبررات والإجراءات الموصى بها) باللغة ${l}. تغيير لغة العرض لاحقًا لا يعيد توليدها.`,
  startReview: 'بدء المراجعة',
  reviewTitle: 'المراجعة',
  status: 'الحالة',
  connected: '● متصل',
  disconnected: '○ غير متصل',
  targetShort: 'الهدف',
  ontology: 'الأنطولوجيا',
  analysis: 'التحليل',
  analysisValue: (sec, tokens) => `${sec} ث / ${tokens} رمز`,
  decision: 'القرار',
  aiLanguage: 'لغة مخرجات الذكاء الاصطناعي',
  aiLanguageNote: 'تُحدَّد عند إنشاء المراجعة. تغيير لغة العرض لا يعيد توليد مخرجات الذكاء الاصطناعي للمراجعات الحالية.',
  aiLanguageUnknown: 'غير مسجّلة (مراجعة أُنشئت قبل دعم تعدد اللغات)',
  statuses: {
    notStarted: 'لم تبدأ', inProgress: 'قيد التنفيذ', ACCEPTED: 'مقبولة', ANALYZING: 'قيد التحليل', VALIDATED: 'تم التحقق',
    WAITING_HITL: 'بانتظار القرار', HITL_DECIDED: 'تم اتخاذ القرار', completed: 'مكتملة', rejected_by_reviewer: 'رفضها المراجِع', failed: 'فشلت',
  },
  decisions: { approve: 'الموافقة', reject: 'الرفض' },
  hitlTitle: 'يلزم قرار من المراجِع',
  hitlBody: (th) => `توجد نتائج تقل درجة الثقة فيها عن الحد ${th}.`,
  confidenceValue: (c) => `درجة الثقة ${c}`,
  comment: 'تعليق',
  approve: 'موافقة',
  reject: 'رفض',
  findingsTitle: 'النتائج (مرتبة تنازليًا حسب RPN)',
  col: {
    failureMode: 'نمط الفشل', causePath: 'مسار السبب', effect: 'الأثر', confidence: 'الثقة', validation: 'التحقق',
    severity: 'الخطورة (Severity)', occurrence: 'الحدوث (Occurrence)', detection: 'الكشف (Detection)',
    rpn: 'رقم أولوية المخاطر (RPN = S×O×D)',
  },
  notValidated: 'لم يُتحقق منها',
  noAccepted: 'لا توجد نتائج اجتازت التحقق.',
  pendingValidation: 'بانتظار التحقق',
  rejectedSummary: (n) => `نتائج رُفضت في التحقق (${n})`,
  rationaleSummary: (id) => `المبررات والإجراءات الموصى بها لـ ${id}`,
  validationCodes: {
    OK: 'اجتازت جميع فحوص الأنطولوجيا',
    UNRESOLVED_IRI: 'أحد المعرّفات (IRI) لا يُحال إلى الفئة المتوقعة',
    BROKEN_CAUSAL_PATH: 'لا توجد صلة مباشرة بين عقدتين متجاورتين في مسار السبب',
    COMPONENT_MISMATCH: 'نمط الفشل لا يحدث في الهدف المحدد',
  },
  eventsTitle: 'الأحداث',
  waitingEvents: 'بانتظار الأحداث…',
  evt: {
    accepted: (l) => (l ? `تم قبول المراجعة (لغة المخرجات: ${l})` : 'تم قبول المراجعة'),
    pinned: (v) => `تم تثبيت الأنطولوجيا v${v}`,
    agentStarted: (a) => `بدأ ${a}`,
    agentFinished: (a, sec) => `انتهى ${a} (${sec} ث)`,
    proposed: (n, tokens) => `اقتُرحت ${n} نتيجة / ${tokens} رمز`,
    validation: (a, r, hitl) => `اجتاز ${a} / رُفض ${r}${hitl ? ' / يلزم قرار المراجِع' : ''}`,
    hitlRequired: (th) => `توجد نتائج بدرجة ثقة أقل من ${th}`,
    hitlDecided: (d, by) => `اتخذ ${by} قرار ${d}`,
    completed: (s) => `انتهت المراجعة: ${s}`,
    failed: (e) => `فشل: ${e}`,
  },
  errors: {
    api: (status, m) => `فشل الطلب (HTTP ${status}): ${m}`,
    wsConnect: 'تعذّر فتح الاتصال المباشر (WebSocket). ستتم إعادة المحاولة تلقائيًا.',
    signInNextStep: (step) => `يتطلب تسجيل الدخول خطوة إضافية: ${step}`,
    badCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    tooManyAttempts: 'محاولات كثيرة جدًا. يُرجى الانتظار قليلًا ثم المحاولة مرة أخرى.',
    generic: (m) => `حدث خطأ: ${m}`,
  },
};

const zhCN: Messages = {
  langNames: { ja: '日语', en: '英语', ar: '阿拉伯语', 'zh-CN': '简体中文' },
  uiLanguage: '显示语言',
  loading: '正在加载…',
  configLoadFailed: (m) => `无法加载配置：${m}`,
  logout: '退出登录',
  signInTitle: '登录',
  email: '电子邮箱',
  password: '密码',
  signingIn: '正在登录…',
  signIn: '登录',
  newReviewTitle: '新建评审',
  ontologyVersion: '本体版本',
  presets: '预设：',
  target: '零部件 / 接口',
  selectPlaceholder: '请选择',
  kind: { Component: '零部件', Interface: '接口' },
  scenario: '场景',
  outputLanguageHint: (l) => `AI 生成的评审结论（依据与建议措施）将使用${l}。之后切换显示语言不会重新生成。`,
  startReview: '开始评审',
  reviewTitle: '评审',
  status: '状态',
  connected: '● 已连接',
  disconnected: '○ 未连接',
  targetShort: '对象',
  ontology: '本体',
  analysis: '分析',
  analysisValue: (sec, tokens) => `${sec} 秒 / ${tokens} 个 token`,
  decision: '决定',
  aiLanguage: 'AI 输出语言',
  aiLanguageNote: '在创建评审时确定。切换显示语言不会重新生成已有评审的 AI 输出。',
  aiLanguageUnknown: '未记录（多语言支持之前创建的评审）',
  statuses: {
    notStarted: '等待开始', inProgress: '进行中', ACCEPTED: '已受理', ANALYZING: '分析中', VALIDATED: '已校验',
    WAITING_HITL: '等待决定', HITL_DECIDED: '已决定', completed: '已完成', rejected_by_reviewer: '评审人已驳回', failed: '失败',
  },
  decisions: { approve: '批准', reject: '驳回' },
  hitlTitle: '需要评审人作出决定',
  hitlBody: (th) => `存在置信度低于阈值 ${th} 的结论。`,
  confidenceValue: (c) => `置信度 ${c}`,
  comment: '备注',
  approve: '批准',
  reject: '驳回',
  findingsTitle: '评审结论（按 RPN 降序）',
  col: {
    failureMode: '失效模式', causePath: '原因路径', effect: '失效影响', confidence: '置信度', validation: '校验',
    severity: '严重度 (Severity)', occurrence: '频度 (Occurrence)', detection: '探测度 (Detection)',
    rpn: '风险优先数 (RPN = S×O×D)',
  },
  notValidated: '未校验',
  noAccepted: '没有通过校验的结论。',
  pendingValidation: '等待校验',
  rejectedSummary: (n) => `未通过校验的结论（${n} 条）`,
  rationaleSummary: (id) => `${id} 的依据与建议措施`,
  validationCodes: {
    OK: '已通过全部本体校验',
    UNRESOLVED_IRI: 'IRI 无法解析为预期的类',
    BROKEN_CAUSAL_PATH: '原因路径中相邻节点之间没有直接关联',
    COMPONENT_MISMATCH: '失效模式的发生位置与评审对象不一致',
  },
  eventsTitle: '事件',
  waitingEvents: '等待事件…',
  evt: {
    accepted: (l) => (l ? `已受理评审（AI 输出：${l}）` : '已受理评审'),
    pinned: (v) => `已固定本体 v${v}`,
    agentStarted: (a) => `${a} 已开始`,
    agentFinished: (a, sec) => `${a} 已完成（${sec} 秒）`,
    proposed: (n, tokens) => `提出 ${n} 条结论 / ${tokens} 个 token`,
    validation: (a, r, hitl) => `通过 ${a} / 驳回 ${r}${hitl ? ' / 需评审人决定' : ''}`,
    hitlRequired: (th) => `存在置信度低于 ${th} 的结论`,
    hitlDecided: (d, by) => `${by} 已${d}`,
    completed: (s) => `评审结束：${s}`,
    failed: (e) => `失败：${e}`,
  },
  errors: {
    api: (status, m) => `请求失败（HTTP ${status}）：${m}`,
    wsConnect: '无法建立实时连接（WebSocket），将自动重试。',
    signInNextStep: (step) => `登录还需要额外步骤：${step}`,
    badCredentials: '电子邮箱或密码不正确。',
    tooManyAttempts: '尝试次数过多，请稍后再试。',
    generic: (m) => `发生错误：${m}`,
  },
};

export const MESSAGES: Record<Lang, Messages> = { ja, en, ar, 'zh-CN': zhCN };

/** Maps a BCP 47 tag from the browser to a supported UI language (Traditional Chinese is not matched). */
export function matchLang(tag: string): Lang | null {
  const t = tag.toLowerCase();
  const base = t.split('-')[0];
  if (base === 'ja' || base === 'en' || base === 'ar') return base;
  if (t === 'zh' || t === 'zh-cn' || t === 'zh-sg' || t.startsWith('zh-hans')) return 'zh-CN';
  return null;
}

function readStored(): Lang | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(lang: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable (private mode etc.) */
  }
}

export function detectInitialLang(): Lang {
  const stored = readStored();
  if (stored) return stored;
  const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const p of prefs) {
    const m = p && matchLang(p);
    if (m) return m;
  }
  return DEFAULT_LANG;
}

function applyToDocument(lang: Lang): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = dirOf(lang);
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Messages;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = detectInitialLang();
    applyToDocument(l); // before first paint, so RTL does not flash in as LTR
    return l;
  });
  useEffect(() => applyToDocument(lang), [lang]);
  const setLang = useCallback((l: Lang) => {
    writeStored(l);
    setLangState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang, t: MESSAGES[lang] }), [lang, setLang]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n must be used inside I18nProvider');
  return v;
}
