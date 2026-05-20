import { useEffect, useState, type ReactNode } from 'react';
import {
  BookOpen,
  Brain,
  ClipboardCopy,
  Eraser,
  Gauge,
  Keyboard,
  Mic,
  PenLine,
  PlugZap,
  Settings,
  Trash2,
  Sparkles,
  Smile,
  Cpu,
  MessageSquareText,
  Copy,
  Check
} from 'lucide-react';
import ModelsView from './ModelsView';
import './styles.css';
import { DEFAULT_CLEANUP_PROMPT, ENGINEER_CLEANUP_PROMPT, CHARM_CLEANUP_PROMPT } from '../shared/cleanupPolicy';

export interface MultiPromptData {
  activeStyle: 'default' | 'engineer' | 'charm';
  prompts: {
    default: string;
    engineer: string;
    charm: string;
  };
}

export function parseMultiPrompt(promptStr: string): MultiPromptData {
  const defaultPrompts = {
    default: DEFAULT_CLEANUP_PROMPT,
    engineer: ENGINEER_CLEANUP_PROMPT,
    charm: CHARM_CLEANUP_PROMPT
  };

  if (!promptStr) {
    return {
      activeStyle: 'default',
      prompts: defaultPrompts
    };
  }

  const trimmed = promptStr.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const activeStyle = parsed.activeStyle || 'default';
        const prompts = parsed.prompts || {};
        return {
          activeStyle: activeStyle === 'engineer' || activeStyle === 'charm' ? activeStyle : 'default',
          prompts: {
            default: typeof prompts.default === 'string' ? prompts.default : DEFAULT_CLEANUP_PROMPT,
            engineer: typeof prompts.engineer === 'string' ? prompts.engineer : ENGINEER_CLEANUP_PROMPT,
            charm: typeof prompts.charm === 'string' ? prompts.charm : CHARM_CLEANUP_PROMPT
          }
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    activeStyle: 'default',
    prompts: {
      default: promptStr,
      engineer: ENGINEER_CLEANUP_PROMPT,
      charm: CHARM_CLEANUP_PROMPT
    }
  };
}

type View = 'dashboard' | 'models' | 'settings';
type Appearance = 'light' | 'dark' | 'pink' | 'green';

const APPEARANCES: { id: Appearance; label: string }[] = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'pink', label: '柔粉' },
  { id: 'green', label: '青绿' }
];

type WordbookEntry = {
  id: string;
  target: string;
  variants: string[];
};

type LlmProviderConfig = {
  key: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
};

type AsrProfileConfig = {
  id: string;
  kind: 'local' | 'cloud-upload' | 'cloud-streaming';
  displayName: string;
  engine: string;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

type RecordItem = {
  id: string;
  time: string;
  original: string;
  refined: string;
  userCorrection?: string;
  status: '已输入' | '整理中' | '失败';
  asr?: string;
  cleanup?: string;
  durationMs?: number;
  asrDurationMs?: number;
  cleanupDurationMs?: number;
  pasteSucceeded?: boolean;
};

type SettingsState = {
  triggerKey: string;
  recordMode: string;
  asr: string;
  asrAcceleration: string;
  localModelDir: string;
  localAsrExePath: string;
  localAsrModelPath: string;
  ffmpegPath: string;
  fasterWhisperModelPath: string;
  senseVoiceModelPath: string;
  pythonPath: string;
  cleanupEnabled: boolean;
  provider: string;
  baseURL: string;
  model: string;
  apiKey: string;
  llmProviders: LlmProviderConfig[];
  activeLlmProviderKey: string;
  prompt: string;
  outputMode: string;
  dataDir: string;
  shortPressAction: string;
  longPressAction: string;
  smartMouseMode: boolean;
  mouseTrigger: string;
  wordbook: WordbookEntry[];
  cloudAsrType: string;
  cloudAsrBaseUrl: string;
  cloudAsrApiKey: string;
  cloudAsrModel: string;
  asrProfiles: AsrProfileConfig[];
  activeAsrProfileId: string;
};

type TailKallFacade = {
  getDashboard?: () => Promise<{ settings: SettingsState; records: RecordItem[] }>;
  saveSettings?: (settings: SettingsState) => Promise<SettingsState>;
  submitRecording?: (audio: ArrayBuffer, durationMs: number) => Promise<{ ok: boolean }>;
  copyText?: (text: string) => Promise<void>;
  rewriteRecord?: (id: string) => Promise<void>;
  pasteRecord?: (id: string) => Promise<void>;
  deleteRecord?: (id: string) => Promise<void>;
  clearAllRecords?: () => Promise<{ ok: boolean }>;
  testRewriteApi?: (settings: SettingsState) => Promise<{ ok: boolean; message: string }>;
  saveCorrection?: (id: string, text: string) => Promise<void>;
  learnWordbook?: () => Promise<{ ok: boolean; added: number; updated: number; wordbook?: WordbookEntry[] }>;
  windowControl?: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<boolean>;
  onRecordingStart?: (callback: () => void) => () => void;
  onRecordingStop?: (callback: () => void) => () => void;
  onRecordAdded?: (callback: (record: RecordItem) => void) => () => void;
  onRecordUpdated?: (callback: (record: RecordItem) => void) => () => void;
  onRecordDeleted?: (callback: (id: string) => void) => () => void;
  onRecordsCleared?: (callback: () => void) => () => void;
  onRecordsSynced?: (callback: (records: RecordItem[]) => void) => () => void;
};

declare global {
  interface Window {
    tailkall?: TailKallFacade;
  }
}

const demoSettings: SettingsState = {
  triggerKey: 'Ctrl + Alt + Space',
  recordMode: '按住说话',
  asr: 'whisper.cpp',
  asrAcceleration: 'GPU 优先',
  localModelDir: 'D:\\Antigravity\\tailkall\\models',
  localAsrExePath: 'D:\\Antigravity\\tailkall\\models\\whisper\\Release\\whisper-cli.exe',
  localAsrModelPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin',
  ffmpegPath: 'D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe',
  fasterWhisperModelPath: 'D:\\Antigravity\\tailkall\\models\\faster-whisper\\small',
  senseVoiceModelPath: 'D:\\Antigravity\\tailkall\\models\\sensevoice\\SenseVoiceSmall',
  pythonPath: 'D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe',
  cleanupEnabled: false,
  provider: 'OpenAI Compatible',
  baseURL: 'https://api.example.com/v1',
  model: 'gpt-4.1-mini',
  apiKey: 'demo-api-key',
  llmProviders: [
    { key: 'openai', displayName: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4.1-mini', enabled: false, isDefault: false },
    { key: 'deepseek', displayName: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'demo-api-key', model: 'deepseek-chat', enabled: true, isDefault: true },
    { key: 'openrouter', displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'siliconflow', displayName: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'volcengine-ark', displayName: '火山方舟', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'dashscope', displayName: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'moonshot', displayName: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'zhipu', displayName: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'tencent-hunyuan', displayName: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'gemini-compatible', displayName: 'Gemini Compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '', model: '', enabled: false, isDefault: false },
    { key: 'ollama', displayName: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'qwen2.5', enabled: false, isDefault: false },
    { key: 'custom-openai', displayName: '自定义 OpenAI-compatible', baseUrl: '', apiKey: '', model: '', enabled: false, isDefault: false }
  ],
  activeLlmProviderKey: 'deepseek',
  prompt: DEFAULT_CLEANUP_PROMPT,
  outputMode: '粘贴到当前光标',
  dataDir: 'D:\\Antigravity\\tailkall\\data',
  shortPressAction: '语音输入',
  longPressAction: '语音助手',
  smartMouseMode: true,
  mouseTrigger: 'Mouse Middle',
  wordbook: [],
  cloudAsrType: 'openai-whisper',
  cloudAsrBaseUrl: '',
  cloudAsrApiKey: '',
  cloudAsrModel: 'whisper-1',
  asrProfiles: [
    { id: 'local-sensevoice', kind: 'local', displayName: '本地 SenseVoice / FunASR', engine: 'SenseVoice / FunASR', enabled: true },
    { id: 'local-faster-whisper', kind: 'local', displayName: '本地 faster-whisper', engine: 'faster-whisper', enabled: true },
    { id: 'local-whisper-cpp', kind: 'local', displayName: '本地 whisper.cpp', engine: 'whisper.cpp', enabled: true },
    { id: 'cloud-upload-openai', kind: 'cloud-upload', displayName: '云端上传转写 API', engine: 'openai-whisper', enabled: false, baseUrl: 'https://api.openai.com', apiKey: '', model: 'whisper-1' },
    { id: 'cloud-streaming-custom', kind: 'cloud-streaming', displayName: '云端流式转写 API', engine: 'streaming-compatible', enabled: false, baseUrl: '', apiKey: '', model: '' }
  ],
  activeAsrProfileId: 'local-whisper-cpp'
};

const demoRecords: RecordItem[] = [
  {
    id: 'rec-1',
    time: '2026/05/19 09:18',
    original:
      '请帮我整理今天会议关于登录体验、首屏性能和快捷键冲突处理的讨论，保留结论、负责人和下次跟进时间。',
    refined: '会议结论：优化登录体验与首屏性能，排查快捷键冲突。负责人分别跟进，下次例会同步结果。',
    status: '已输入',
    asr: '本地 Whisper / small',
    cleanup: 'OpenAI Compatible / gpt-4.1-mini',
    durationMs: 8200,
    asrDurationMs: 3200,
    cleanupDurationMs: 1800,
    pasteSucceeded: true
  },
  {
    id: 'rec-2',
    time: '2026/05/18 17:42',
    original: '把这段客户反馈整理成工单，强调语音识别延迟和偶发粘贴失败。',
    refined: '工单：语音识别存在延迟，偶发粘贴失败。请排查录音结束到文本输出链路。',
    status: '已输入',
    asrDurationMs: 1200
  }
];

function getFacade(): TailKallFacade {
  return window.tailkall ?? {};
}

function useAppearance(): [Appearance, (appearance: Appearance) => void] {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    return (localStorage.getItem('tailkall-appearance') as Appearance | null) ?? 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-appearance', appearance);
    localStorage.setItem('tailkall-appearance', appearance);
  }, [appearance]);

  return [appearance, setAppearance];
}

export default function App() {
  const [appearance, setAppearance] = useAppearance();
  const [view, setView] = useState<View>('dashboard');
  const [settings, setSettings] = useState<SettingsState>(demoSettings);
  const [records, setRecords] = useState<RecordItem[]>(demoRecords);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState('未测试');
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  useEffect(() => {
    getFacade()
      .getDashboard?.()
      .then((dashboard) => {
        setSettings(dashboard.settings);
        setRecords(dashboard.records);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const facade = getFacade();
    const offRecordAdded = facade.onRecordAdded?.((record) => {
      setRecords((current) => [record, ...current]);
    });
    const offRecordUpdated = facade.onRecordUpdated?.((record) => {
      setRecords((current) => current.map((item) => (item.id === record.id ? record : item)));
    });
    const offRecordDeleted = facade.onRecordDeleted?.((id) => {
      setRecords((current) => current.filter((item) => item.id !== id));
    });
    const offRecordsCleared = facade.onRecordsCleared?.(() => {
      setRecords([]);
    });
    const offRecordsSynced = facade.onRecordsSynced?.((records) => {
      setRecords(records);
    });
    return () => {
      offRecordAdded?.();
      offRecordUpdated?.();
      offRecordDeleted?.();
      offRecordsCleared?.();
      offRecordsSynced?.();
    };
  }, []);

  useEffect(() => {
    const facade = getFacade();
    const offStart = facade.onRecordingStart?.(() => {
      void startBrowserRecording();
    });
    const offStop = facade.onRecordingStop?.(() => {
      mediaRecorder?.stop();
    });
    return () => {
      offStart?.();
      offStop?.();
    };
  }, [mediaRecorder]);

  const startBrowserRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream);
    const startedAt = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const audio = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
      await getFacade().submitRecording?.(audio, Date.now() - startedAt);
      setMediaRecorder(null);
    };
    recorder.start();
    setMediaRecorder(recorder);
  };

  const updateSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      void getFacade().saveSettings?.(next).catch(() => undefined);
      return next;
    });
  };

  const copyText = async (text: string) => {
    const facade = getFacade();
    if (facade.copyText) {
      await facade.copyText(text);
      return;
    }
    await navigator.clipboard?.writeText?.(text);
  };

  const deleteRecord = async (id: string) => {
    await getFacade().deleteRecord?.(id);
    setRecords((current) => current.filter((record) => record.id !== id));
  };

  const clearAllRecords = async () => {
    await getFacade().clearAllRecords?.();
    setRecords([]);
  };

  const saveCorrection = async (id: string, text: string) => {
    await getFacade().saveCorrection?.(id, text);
    setRecords((current) =>
      current.map((item) => (item.id === id ? { ...item, userCorrection: text } : item))
    );
  };


  const testRewriteApi = async () => {
    const result = await getFacade().testRewriteApi?.(settings);
    setTestStatus(result?.message || '连接成功');
  };

  return (
    <div className="window-shell">
      <main className="app-shell">
        <aside className="sidebar" aria-label="主导航">
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '3px', marginBottom: '24px' }}>
            <svg width="28" height="28" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, transform: 'translateY(-1px)' }}>
              <defs>
                <linearGradient id="purple-pink-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#7c3aed" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
                <linearGradient id="pink-blue-grad" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ec4899" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
              {/* 后层青蓝环 */}
              <path
                d="M 38 46 C 44 32, 54 18, 70 20 C 86 22, 88 44, 70 54 C 54 62, 44 76, 50 84"
                stroke="url(#pink-blue-grad)"
                strokeWidth="12"
                strokeLinecap="round"
                fill="none"
              />
              {/* 前层紫粉环 - 覆盖在上面形成 3D 莫比乌斯交叉 */}
              <path
                d="M 62 54 C 56 68, 46 82, 30 80 C 14 78, 12 56, 30 46 C 46 38, 56 24, 50 16"
                stroke="url(#purple-pink-grad)"
                strokeWidth="12"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <span style={{ fontSize: '20px', fontWeight: '850', color: 'var(--text-primary)', letterSpacing: '-0.8px', marginLeft: '0px' }}>
              napSay
            </span>
          </div>
          <NavButton active={view === 'dashboard'} icon={<Gauge size={18} />} label="主页" onClick={() => setView('dashboard')} />
          <NavButton active={view === 'models'} icon={<Brain size={18} />} label="模型" onClick={() => setView('models')} />
          <NavButton active={view === 'settings'} icon={<Settings size={18} />} label="设置" onClick={() => setView('settings')} />
        </aside>

        <div className="main-layout">
          <div className="top-drag-zone" />
          <section className={view === 'dashboard' ? 'content dashboard-content' : 'content'}>
            {view === 'dashboard' && (
              <Dashboard
                settings={settings}
                editingRecordId={editingRecordId}
                records={records}
                onClearAll={clearAllRecords}
                onCopyRefined={(record) => copyText(record.refined)}
                onCopyOriginal={(record) => copyText(record.original)}
                onDelete={(record) => deleteRecord(record.id)}
                onEdit={(record) => setEditingRecordId(record.id)}
                onSaveCorrection={saveCorrection}
                onUpdateOriginal={(record, value) => {
                  setRecords((current) => current.map((item) => (item.id === record.id ? { ...item, original: value } : item)));
                }}
                onUpdatePrompt={(newPrompt) => updateSetting('prompt', newPrompt)}
              />
            )}
            {view === 'models' && (
              <ModelsView
                settings={settings}
                testStatus={testStatus}
                onTestRewriteApi={testRewriteApi}
                onUpdate={updateSetting}
              />
            )}
            {view === 'settings' && (
              <SettingsView
                appearance={appearance}
                settings={settings}
                onAppearanceChange={setAppearance}
                onUpdate={updateSetting}
              />
            )}
          </section>
        </div>
        <WindowControls />
      </main>
    </div>
  );
}

function WindowControls() {
  const control = (action: 'minimize' | 'toggle-maximize' | 'close') => {
    void getFacade().windowControl?.(action);
  };

  return (
    <div aria-label="窗口控制" className="window-controls" role="toolbar">
      <button aria-label="最小化" onClick={() => control('minimize')} type="button">
        <svg className="control-icon" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button aria-label="最大化或还原" onClick={() => control('toggle-maximize')} type="button">
        <svg className="control-icon" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button aria-label="关闭" className="close" onClick={() => control('close')} type="button">
        <svg className="control-icon" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M2.5 2.5 L7.5 7.5 M7.5 2.5 L2.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}


function NavButton(props: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={props.active ? 'nav-button active' : 'nav-button'} onClick={props.onClick} type="button">
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function Dashboard(props: {
  settings: SettingsState;
  records: RecordItem[];
  editingRecordId?: string | null;
  onClearAll?: () => void;
  onCopyRefined?: (record: RecordItem) => void;
  onCopyOriginal?: (record: RecordItem) => void;
  onDelete?: (record: RecordItem) => void;
  onEdit?: (record: RecordItem) => void;
  onSaveCorrection?: (id: string, text: string) => void;
  onUpdateOriginal?: (record: RecordItem, value: string) => void;
  onUpdatePrompt?: (newPrompt: string) => void;
}) {
  const multiPrompt = parseMultiPrompt(props.settings.prompt);

  const handleStyleChange = (style: 'default' | 'engineer' | 'charm') => {
    const updated = {
      ...multiPrompt,
      activeStyle: style
    };
    props.onUpdatePrompt?.(JSON.stringify(updated));
  };

  return (
    <div className="view-stack dashboard-view">
      <h1>主页</h1>
      <div className="metric-grid">
        <Metric icon={<Keyboard />} label="当前触发键" value={props.settings.triggerKey} />
        <Metric icon={<Mic />} label="ASR" value={props.settings.asr} />
        <Metric icon={<PlugZap />} label="文案整理 API" value={`${props.settings.provider} / ${props.settings.model}`} />
      </div>

      <div className="style-preset-panel">
        <div className="style-preset-title">
          <div className="style-preset-icon">
            <Sparkles size={16} />
          </div>
          <div className="style-preset-text">
            <h3>AI 整理风格预设</h3>
            <p>选择最契合您输入内容的大模型语气和逻辑结构</p>
          </div>
        </div>
        <div className="style-preset-options">
          <button
            className={`style-preset-btn ${multiPrompt.activeStyle === 'default' ? 'active' : ''}`}
            onClick={() => handleStyleChange('default')}
            type="button"
          >
            <MessageSquareText size={14} />
            默认整理
          </button>
          <button
            className={`style-preset-btn ${multiPrompt.activeStyle === 'engineer' ? 'active' : ''}`}
            onClick={() => handleStyleChange('engineer')}
            type="button"
          >
            <Cpu size={14} />
            理智工科
          </button>
          <button
            className={`style-preset-btn ${multiPrompt.activeStyle === 'charm' ? 'active' : ''}`}
            onClick={() => handleStyleChange('charm')}
            type="button"
          >
            <Smile size={14} />
            高情商夸夸
          </button>
        </div>
      </div>

      <section className="panel dashboard-panel" aria-label="最近记录">
        <div className="panel-header">
          <h2>最近记录</h2>
          {props.records.length > 0 && (
            <button className="clear-all-btn" onClick={props.onClearAll} type="button">
              <Eraser size={14} />
              清空
            </button>
          )}
        </div>
        <FullRecordList {...props} />
      </section>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-icon">{icon}</div>
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
      </div>
    </div>
  );
}

/* ─── Full card list ──────────────────────────────────────────────────── */
function FullRecordList(props: {
  records: RecordItem[];
  editingRecordId?: string | null;
  onCopyRefined?: (record: RecordItem) => void;
  onCopyOriginal?: (record: RecordItem) => void;
  onDelete?: (record: RecordItem) => void;
  onEdit?: (record: RecordItem) => void;
  onSaveCorrection?: (id: string, text: string) => void;
  onUpdateOriginal?: (record: RecordItem, value: string) => void;
}) {
  const [expandedCorrectionId, setExpandedCorrectionId] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), 1200);
    return () => clearTimeout(timer);
  }, [copiedId]);

  const handleCopyOriginal = (record: RecordItem) => {
    props.onCopyOriginal?.(record);
    setCopiedId(record.id + '-original');
  };

  const handleCopyRefined = (record: RecordItem) => {
    props.onCopyRefined?.(record);
    setCopiedId(record.id + '-refined');
  };

  const openCorrection = (record: RecordItem) => {
    setExpandedCorrectionId(record.id);
    setCorrectionDraft(record.userCorrection ?? '');
  };

  const commitCorrection = (record: RecordItem) => {
    if (correctionDraft.trim()) {
      props.onSaveCorrection?.(record.id, correctionDraft.trim());
    }
    setExpandedCorrectionId(null);
  };

  const statusClass = (s: string) => s === '已输入' ? 'ok' : s === '整理中' ? 'busy' : 'fail';

  return (
    <div className="record-list">
      {props.records.map((record) => (
        <div className="record-card" key={record.id}>
          <div className="record-row">
            <div className="record-content">
              <div className="record-meta">
                <span>{record.time}</span>
                <span className={`record-status ${statusClass(record.status)}`}>{record.status}</span>
                {record.asrDurationMs != null && (
                  <span className="record-duration">提取 {(record.asrDurationMs / 1000).toFixed(1)}s</span>
                )}
                {record.cleanupDurationMs != null && (
                  <span className="record-duration">整理 {(record.cleanupDurationMs / 1000).toFixed(1)}s</span>
                )}
              </div>

              {props.editingRecordId === record.id ? (
                <input
                  aria-label="编辑原文"
                  className="inline-editor"
                  onBlur={() => props.onEdit?.({ ...record, id: '' })}
                  onChange={(event) => props.onUpdateOriginal?.(record, event.target.value)}
                  value={record.original}
                />
              ) : (
                <div className="record-refined">{record.refined}</div>
              )}

              {expandedCorrectionId === record.id && (
                <div className="correction-area">
                  <span className="correction-label">粘贴你修正后的完整文本，软件将从中学习词库规律：</span>
                  <textarea
                    aria-label="修正文本"
                    autoFocus
                    className="correction-textarea"
                    onBlur={() => commitCorrection(record)}
                    onChange={(e) => setCorrectionDraft(e.target.value)}
                    placeholder="粘贴修正后的文本…"
                    value={correctionDraft}
                  />
                </div>
              )}
            </div>

            <div className="record-actions">
              {/* 复制整理后文本 */}
              <button
                className={`record-action-btn${copiedId === record.id + '-refined' ? ' success' : ''}`}
                data-tooltip={copiedId === record.id + '-refined' ? '已复制整理文本' : '复制整理文本'}
                aria-label="复制整理文本"
                onClick={() => handleCopyRefined(record)}
                type="button"
              >
                {copiedId === record.id + '-refined' ? <Check size={13} /> : <Sparkles size={13} />}
              </button>

              {/* 复制原始文本 */}
              <button
                className={`record-action-btn${copiedId === record.id + '-original' ? ' success' : ''}`}
                data-tooltip={copiedId === record.id + '-original' ? '已复制原始文本' : '复制原始文本'}
                aria-label="复制原始文本"
                onClick={() => handleCopyOriginal(record)}
                type="button"
              >
                {copiedId === record.id + '-original' ? <Check size={13} /> : <Copy size={13} />}
              </button>

              {/* 纠错 */}
              <button
                className={`record-action-btn${record.userCorrection ? ' has-correction' : ''}`}
                data-tooltip={record.userCorrection ? '修正已提交' : '提交修正'}
                aria-label="纠错"
                onClick={() => openCorrection(record)}
                type="button"
              >
                <PenLine size={13} />
              </button>

              {/* 删除 */}
              <button
                className="record-action-btn danger"
                data-tooltip="删除"
                aria-label="删除"
                onClick={() => props.onDelete?.(record)}
                type="button"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsView(props: {
  appearance: Appearance;
  settings: SettingsState;
  onAppearanceChange: (appearance: Appearance) => void;
  onUpdate: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
}) {
  const { settings, onUpdate } = props;
  const [learnStatus, setLearnStatus] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newVariants, setNewVariants] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureDisplay, setCaptureDisplay] = useState('请按下快捷键组合...');

  useEffect(() => {
    if (!isCapturing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const parts: string[] = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      if (event.metaKey) parts.push('Win');

      const keyName = event.key;

      if (keyName === 'Escape') {
        setIsCapturing(false);
        return;
      }

      const isModifier = ['Control', 'Alt', 'Shift', 'Meta'].includes(keyName);

      if (isModifier) {
        if (parts.length > 0) {
          setCaptureDisplay(`${parts.join(' + ')} + ...`);
        } else {
          setCaptureDisplay('请按下快捷键组合...');
        }
        return;
      }

      let formattedKey = keyName;
      if (formattedKey === ' ') {
        formattedKey = 'Space';
      } else if (formattedKey.length === 1) {
        formattedKey = formattedKey.toUpperCase();
      } else if (formattedKey.startsWith('Arrow')) {
        formattedKey = formattedKey.slice(5);
      }

      if (formattedKey === 'CapsLock') formattedKey = 'Caps Lock';
      if (formattedKey === 'PageUp') formattedKey = 'Page Up';
      if (formattedKey === 'PageDown') formattedKey = 'Page Down';
      if (formattedKey === 'ScrollLock') formattedKey = 'Scroll Lock';
      if (formattedKey === 'NumLock') formattedKey = 'Num Lock';
      if (formattedKey === 'Insert') formattedKey = 'Insert';
      if (formattedKey === 'Delete') formattedKey = 'Delete';
      if (formattedKey === 'Home') formattedKey = 'Home';
      if (formattedKey === 'End') formattedKey = 'End';

      if (!parts.includes(formattedKey)) {
        parts.push(formattedKey);
      }

      const finalShortcut = parts.join(' + ');
      onUpdate('triggerKey', finalShortcut);
      setIsCapturing(false);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isCapturing) return;
      event.preventDefault();
      event.stopPropagation();

      const parts: string[] = [];
      if (event.ctrlKey) parts.push('Ctrl');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      if (event.metaKey) parts.push('Win');

      if (parts.length > 0) {
        setCaptureDisplay(`${parts.join(' + ')} + ...`);
      } else {
        setCaptureDisplay('请按下快捷键组合...');
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [isCapturing, onUpdate]);

  const addWordbookEntry = () => {
    const target = newTarget.trim();
    if (!target) return;
    const variants = newVariants.split(',').map((v) => v.trim()).filter(Boolean);
    const entry: WordbookEntry = {
      id: `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      target,
      variants
    };
    onUpdate('wordbook', [...(settings.wordbook ?? []), entry]);
    setNewTarget('');
    setNewVariants('');
  };

  const removeWordbookEntry = (id: string) => {
    onUpdate('wordbook', (settings.wordbook ?? []).filter((e) => e.id !== id));
  };

  const updateVariants = (id: string, value: string) => {
    onUpdate('wordbook', (settings.wordbook ?? []).map((e) =>
      e.id === id ? { ...e, variants: value.split(',').map((v) => v.trim()).filter(Boolean) } : e
    ));
  };

  const learnWordbook = async () => {
    setLearnStatus('学习中…');
    const result = await getFacade().learnWordbook?.();
    if (result?.ok) {
      if (result.wordbook) {
        onUpdate('wordbook', result.wordbook);
      }
      const total = (result.wordbook ?? settings.wordbook ?? []).length;
      setLearnStatus(`完成：新增 ${result.added} 条，更新 ${result.updated} 条（词库共 ${total} 条）`);
    } else {
      setLearnStatus('学习失败');
    }
  };

  return (
    <div className="view-stack settings-view">
      <h1>设置</h1>
      <div className="scroll-content-container">
      <section className="panel settings-card">
        <h2>外观</h2>
        <AppearanceSelector current={props.appearance} onChange={props.onAppearanceChange} />
      </section>
      <section className="panel settings-card">
        <h2>快捷键</h2>
        <div className="shortcut-layout-grid">
          {/* 左栏：键盘快捷键 */}
          <div className="shortcut-config" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)' }}>键盘快捷键</span>
            <div
              className={`shortcut-capture ${isCapturing ? 'active' : ''}`}
              onClick={() => {
                setIsCapturing(true);
                setCaptureDisplay('请按下快捷键组合...');
              }}
              style={{ width: '100%', boxSizing: 'border-box' }}
            >
              <span>{isCapturing ? captureDisplay : settings.triggerKey}</span>
            </div>
            <div className="shortcut-help" style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center' }}>
              {isCapturing ? '正在录制中，请按下快捷键组合（支持多键组合或单键，Esc 键取消）' : '点击上方卡片开始自定义录制快捷键'}
            </div>
            <input
              type="text"
              aria-label="键盘快捷键"
              value={settings.triggerKey}
              readOnly
              style={{
                position: 'absolute',
                width: '1px',
                height: '1px',
                padding: '0',
                margin: '-1px',
                overflow: 'hidden',
                clip: 'rect(0, 0, 0, 0)',
                border: '0',
              }}
            />
          </div>

          {/* 右栏：鼠标快捷键 */}
          <div className="shortcut-config" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)' }}>鼠标快捷键</span>
            <select
              className="mouse-select-card"
              aria-label="鼠标快捷键"
              onChange={(event) => onUpdate('mouseTrigger', event.target.value)}
              value={settings.mouseTrigger}
            >
              <option value="Mouse Middle">鼠标中键</option>
              <option value="Mouse Side 1">鼠标侧键 1</option>
              <option value="Mouse Side 2">鼠标侧键 2</option>
            </select>
            <div className="shortcut-help" style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              支持配合鼠标中键或侧边功能按键快速启动/停止语音转写
            </div>
          </div>
        </div>
      </section>

      <section className="panel settings-card">
        <h2>触发手势</h2>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', padding: '16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-control)', border: '1px solid var(--border-subtle)', transition: 'border-color 150ms ease' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>👆</span> 智能轻敲 (短按)
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
              快速敲击快捷键即可开始录音，再次敲击即刻结束。适合长篇大论、双手脱离鼠标时使用。
            </p>
          </div>
          <div style={{ flex: '1 1 200px', padding: '16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-control)', border: '1px solid var(--border-subtle)', transition: 'border-color 150ms ease' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🎯</span> 持续按住 (长按)
            </h3>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
              持续按住快捷键说话，松开手指即结束录音并输出。适合微信聊天式碎片化高频输入。
            </p>
          </div>
        </div>
        <input
          type="text"
          aria-label="短按动作"
          value={settings.shortPressAction}
          readOnly
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: '0',
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            border: '0',
          }}
        />
        <input
          type="text"
          aria-label="长按动作"
          value={settings.longPressAction}
          readOnly
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: '0',
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            border: '0',
          }}
        />
      </section>

      <section className="panel settings-card">
        <h2>输出与数据</h2>
        <div className="form-grid">
          <label>
            输出模式
            <select onChange={(event) => onUpdate('outputMode', event.target.value)} value={settings.outputMode}>
              <option>粘贴到当前光标</option>
              <option>复制到剪贴板</option>
              <option>仅保存记录</option>
            </select>
          </label>
          <label className="wide">
            数据目录
            <input onChange={(event) => onUpdate('dataDir', event.target.value)} value={settings.dataDir} />
          </label>
        </div>
      </section>

      <section className="panel settings-card">
        <h2>
          <BookOpen size={18} />
          自定义词库
        </h2>
        <p className="wordbook-desc">词库用于矫正 ASR 识别错误。目标词是正确写法，发音变体是 ASR 可能识别出的错误形式（逗号分隔）。</p>
        {(settings.wordbook ?? []).length > 0 && (
          <div className="table-wrap wordbook-table-wrap">
            <table className="wordbook-table">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>目标词</th>
                  <th>发音变体（逗号分隔）</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {(settings.wordbook ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td className="wordbook-target">{entry.target}</td>
                    <td>
                      <input
                        aria-label={`${entry.target} 的发音变体`}
                        className="wordbook-variants-input"
                        onBlur={(e) => updateVariants(entry.id, e.target.value)}
                        onChange={(e) => updateVariants(entry.id, e.target.value)}
                        value={entry.variants.join(', ')}
                      />
                    </td>
                    <td>
                      <button
                        aria-label={`删除 ${entry.target}`}
                        className="wordbook-delete"
                        onClick={() => removeWordbookEntry(entry.id)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="wordbook-add-row">
          <input
            aria-label="新词库目标词"
            onChange={(e) => setNewTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addWordbookEntry(); }}
            placeholder="目标词，如 Codex"
            value={newTarget}
          />
          <input
            aria-label="新词库发音变体"
            onChange={(e) => setNewVariants(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addWordbookEntry(); }}
            placeholder="变体，如 code x, codec"
            value={newVariants}
          />
          <button onClick={addWordbookEntry} type="button">添加</button>
        </div>
        <div className="field-action learn-action">
          <button onClick={() => void learnWordbook()} type="button">
            <BookOpen size={16} />
            从修正记录中学习
          </button>
          {learnStatus && <span className="test-status">{learnStatus}</span>}
        </div>
      </section>
      </div>
    </div>
  );
}

function AppearanceSelector(props: { current: Appearance; onChange: (appearance: Appearance) => void }) {
  return (
    <div aria-label="界面风格" className="appearance-selector" role="radiogroup">
      {APPEARANCES.map((appearance) => (
        <button
          aria-checked={props.current === appearance.id}
          className={props.current === appearance.id ? 'appearance-option active' : 'appearance-option'}
          key={appearance.id}
          onClick={() => props.onChange(appearance.id)}
          role="radio"
          type="button"
        >
          {appearance.label}
        </button>
      ))}
    </div>
  );
}
