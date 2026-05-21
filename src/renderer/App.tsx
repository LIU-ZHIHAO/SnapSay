import { useEffect, useState, useRef, type ReactNode } from 'react';
import {
  BookOpen,
  Brain,
  ClipboardCopy,
  Eraser,
  Gauge,
  Home,
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
  Check,
  ChevronDown,
  Bug,
  Clock,
  FileText
} from 'lucide-react';
import ModelsView from './ModelsView';
import StylesView from './StylesView';
import './styles.css';
import logoUrl from './logo.png';
import { DEFAULT_CLEANUP_PROMPT, ENGINEER_CLEANUP_PROMPT, CHARM_CLEANUP_PROMPT } from '../shared/cleanupPolicy';

export interface StylePreset {
  id: string;
  name: string;
  prompt: string;
  isBuiltIn?: boolean;
}

export interface MultiPromptData {
  activeStyle: string;
  prompts: Record<string, string>;
  presets: StylePreset[];
}

export function parseMultiPrompt(promptStr: string): MultiPromptData {
  const defaultPresets: StylePreset[] = [
    { id: 'default', name: '默认整理', prompt: DEFAULT_CLEANUP_PROMPT, isBuiltIn: true },
    { id: 'engineer', name: '理智工科', prompt: ENGINEER_CLEANUP_PROMPT, isBuiltIn: true },
    { id: 'charm', name: '高情商夸夸', prompt: CHARM_CLEANUP_PROMPT, isBuiltIn: true }
  ];

  const makePromptsMap = (presets: StylePreset[]) => {
    const map: Record<string, string> = {};
    for (const p of presets) {
      map[p.id] = p.prompt;
    }
    return map;
  };

  if (!promptStr) {
    return {
      activeStyle: 'default',
      prompts: makePromptsMap(defaultPresets),
      presets: defaultPresets
    };
  }

  const trimmed = promptStr.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const activeStyle = parsed.activeStyle || 'default';

        // 如果存在 presets 数组，则为新结构
        if (Array.isArray(parsed.presets)) {
          const presets: StylePreset[] = parsed.presets.map((p: any) => ({
            id: String(p.id || ''),
            name: String(p.name || ''),
            prompt: String(p.prompt || ''),
            isBuiltIn: Boolean(p.isBuiltIn)
          })).filter((p: any) => p.id && p.name);

          // 补全缺失的内置预设，防止数据丢失
          for (const dp of defaultPresets) {
            if (!presets.some(p => p.id === dp.id)) {
              presets.unshift(dp);
            }
          }

          return {
            activeStyle,
            prompts: makePromptsMap(presets),
            presets
          };
        }

        // 如果是老版包含 prompts 字典的结构
        if (parsed.prompts && typeof parsed.prompts === 'object') {
          const oldPrompts = parsed.prompts;
          const presets: StylePreset[] = [
            { id: 'default', name: '默认整理', prompt: typeof oldPrompts.default === 'string' ? oldPrompts.default : DEFAULT_CLEANUP_PROMPT, isBuiltIn: true },
            { id: 'engineer', name: '理智工科', prompt: typeof oldPrompts.engineer === 'string' ? oldPrompts.engineer : ENGINEER_CLEANUP_PROMPT, isBuiltIn: true },
            { id: 'charm', name: '高情商夸夸', prompt: typeof oldPrompts.charm === 'string' ? oldPrompts.charm : CHARM_CLEANUP_PROMPT, isBuiltIn: true }
          ];

          // 处理老结构中可能存在的其他自定义 prompt
          for (const key of Object.keys(oldPrompts)) {
            if (key !== 'default' && key !== 'engineer' && key !== 'charm') {
              presets.push({
                id: key,
                name: key.startsWith('custom-') ? `自定义风格-${key.substring(7, 11)}` : key,
                prompt: String(oldPrompts[key]),
                isBuiltIn: false
              });
            }
          }

          return {
            activeStyle,
            prompts: makePromptsMap(presets),
            presets
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // 纯文本格式兼容：将其封装为 default 预设
  const presets: StylePreset[] = [
    { id: 'default', name: '默认整理', prompt: promptStr, isBuiltIn: true },
    { id: 'engineer', name: '理智工科', prompt: ENGINEER_CLEANUP_PROMPT, isBuiltIn: true },
    { id: 'charm', name: '高情商夸夸', prompt: CHARM_CLEANUP_PROMPT, isBuiltIn: true }
  ];

  return {
    activeStyle: 'default',
    prompts: makePromptsMap(presets),
    presets
  };
}

type View = 'dashboard' | 'models' | 'styles' | 'settings';
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
  cleanupStatus?: 'success' | 'failed';
  durationMs?: number;
  asrDurationMs?: number;
  cleanupDurationMs?: number;
  pasteSucceeded?: boolean;
  error?: string;
};

type MicrophoneDevice = {
  deviceId: string;
  label: string;
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
  microphoneDeviceId: string;
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
  clearDiagnosticLogs?: () => Promise<{ ok: boolean; records?: RecordItem[] }>;
  testRewriteApi?: (settings: SettingsState) => Promise<{ ok: boolean; message: string; durationMs?: number }>;
  saveCorrection?: (id: string, text: string) => Promise<void>;
  saveWordbook?: (wordbook: WordbookEntry[]) => Promise<{ ok: boolean }>;
  extractWordPairs?: (id: string) => Promise<{ ok: boolean; pairs: { from: string; to: string }[] }>;
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
  microphoneDeviceId: '',
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
  const [microphoneDevices, setMicrophoneDevices] = useState<MicrophoneDevice[]>([]);
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
    let disposed = false;
    const enumerateMicrophones = async () => {
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices?.();
        if (!devices || disposed) {
          return;
        }
        const microphones = devices
          .filter((device) => device.kind === 'audioinput')
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `麦克风 ${index + 1}`
          }));
        setMicrophoneDevices(microphones);
      } catch {
        if (!disposed) {
          setMicrophoneDevices([]);
        }
      }
    };
    void enumerateMicrophones();
    return () => {
      disposed = true;
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
  }, [mediaRecorder, settings.microphoneDeviceId]);

  const startBrowserRecording = async () => {
    const audioConstraint = settings.microphoneDeviceId
      ? { deviceId: { exact: settings.microphoneDeviceId } }
      : true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
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
      if (key === 'wordbook') {
        void getFacade().saveWordbook?.(value as WordbookEntry[]).catch(() => undefined);
      } else {
        void getFacade().saveSettings?.(next).catch(() => undefined);
      }
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

  const clearDiagnosticLogs = async () => {
    const result = await getFacade().clearDiagnosticLogs?.();
    if (result?.records) {
      setRecords(result.records);
      return;
    }
    setRecords((current) => current.map((record) => ({ ...record, error: undefined })));
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
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '0px', marginBottom: '24px' }}>
            <img src={logoUrl} alt="Logo" width="24" height="24" style={{ flexShrink: 0, transform: 'translateY(-3px)' }} />
            <span style={{ fontSize: '20px', fontWeight: '850', color: 'var(--text-primary)', letterSpacing: '-0.8px', marginLeft: '0px' }}>
              napSay
            </span>
          </div>
          <NavButton active={view === 'dashboard'} icon={<Home size={18} />} label="主页" onClick={() => setView('dashboard')} />
          <NavButton active={view === 'models'} icon={<Brain size={18} />} label="模型" onClick={() => setView('models')} />
          <NavButton active={view === 'styles'} icon={<Sparkles size={18} />} label="风格" onClick={() => setView('styles')} />
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
                onUpdateWordbook={(wb) => updateSetting('wordbook', wb)}
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
            {view === 'styles' && (
              <StylesView
                settings={settings}
                onUpdate={updateSetting}
              />
            )}
            {view === 'settings' && (
              <SettingsView
                appearance={appearance}
                settings={settings}
                microphoneDevices={microphoneDevices}
                records={records}
                onClearDiagnosticLogs={clearDiagnosticLogs}
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
  onUpdateWordbook?: (wordbook: WordbookEntry[]) => void;
}) {
  const multiPrompt = parseMultiPrompt(props.settings.prompt);
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  useEffect(() => {
    if (!isMoreOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.style-preset-more-container')) {
        setIsMoreOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [isMoreOpen]);

  const handleStyleChange = (style: string) => {
    const updated = {
      ...multiPrompt,
      activeStyle: style
    };
    props.onUpdatePrompt?.(JSON.stringify(updated));
    setIsMoreOpen(false);
  };

  // Limit presets shown on home screen (max 5 items)
  const allPresets = multiPrompt.presets;
  const activeId = multiPrompt.activeStyle;

  let mainPresets: typeof allPresets = [];
  let morePresets: typeof allPresets = [];

  if (allPresets.length <= 5) {
    mainPresets = allPresets;
  } else {
    const activeIndex = allPresets.findIndex(p => p.id === activeId);
    if (activeIndex !== -1 && activeIndex < 5) {
      mainPresets = allPresets.slice(0, 5);
      morePresets = allPresets.slice(5);
    } else {
      const firstFour = allPresets.slice(0, 4);
      const activePreset = allPresets.find(p => p.id === activeId) || allPresets[0];
      mainPresets = [...firstFour, activePreset];
      morePresets = allPresets.filter(p => !mainPresets.some(mp => mp.id === p.id));
    }
  }

  // Calculate recording statistics
  const totalDurationMs = props.records.reduce((acc, r) => acc + (r.durationMs || 0), 0);
  const totalChars = props.records.reduce((acc, r) => acc + (r.original || '').length, 0);
  const avgSpeechRate = totalDurationMs > 0 ? Math.round((totalChars * 60000) / totalDurationMs) : 0;

  // Format statistics
  let durationStr = '0秒';
  if (totalDurationMs > 0) {
    if (totalDurationMs < 60000) {
      durationStr = `${Math.round(totalDurationMs / 1000)}秒`;
    } else {
      const minutes = Math.floor(totalDurationMs / 60000);
      const seconds = Math.round((totalDurationMs % 60000) / 1000);
      durationStr = seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
    }
  }

  const charsStr = `${totalChars.toLocaleString()} 字`;
  const speechRateStr = `${avgSpeechRate} 字/分钟`;
  const activePreset = allPresets.find((preset) => preset.id === activeId) ?? allPresets[0];

  return (
    <div className="view-stack dashboard-view">
      <h1>主页</h1>
      <section aria-label="主页概览" className="dashboard-overview">
        <CompactMetric icon={<Keyboard size={15} />} label="触发键" value={props.settings.triggerKey} />
        <CompactMetric icon={<Mic size={15} />} label="语音模型" value={shortenAsrLabel(props.settings.asr)} title={props.settings.asr} />
        <CompactMetric
          icon={<PlugZap size={15} />}
          label="整理模型"
          value={shortenModelLabel(props.settings.model)}
          title={`${props.settings.provider} / ${props.settings.model}`}
        />
        <div aria-label="录音统计" className="overview-stats">
          <OverviewStat icon={<Clock size={13} />} label="时长" value={durationStr} type="duration" />
          <OverviewStat icon={<FileText size={13} />} label="字数" value={charsStr} type="chars" />
          <OverviewStat icon={<Gauge size={13} />} label="语速" value={speechRateStr} type="speed" />
        </div>
        <div className="overview-style">
          <div className="overview-style-label" title="风格">
            <span className="overview-style-icon"><Sparkles size={13} /></span>
            <span className="overview-style-text-single">风格</span>
          </div>
          <div className="style-preset-options compact">
            {mainPresets.map((preset) => (
              <button
                key={preset.id}
                className={`style-preset-btn ${multiPrompt.activeStyle === preset.id ? 'active' : ''}`}
                onClick={() => handleStyleChange(preset.id)}
                type="button"
                title={preset.name}
              >
                {preset.id === 'default' ? <MessageSquareText size={14} /> :
                 preset.id === 'engineer' ? <Cpu size={14} /> :
                 preset.id === 'charm' ? <Smile size={14} /> :
                 <Sparkles size={14} />}
                {preset.name}
              </button>
            ))}

            {morePresets.length > 0 && (
              <div className="style-preset-more-container" style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  className={`style-preset-btn ${isMoreOpen ? 'active' : ''}`}
                  onClick={() => setIsMoreOpen(!isMoreOpen)}
                  type="button"
                  style={{ paddingRight: '8px' }}
                  aria-label="更多整理风格"
                >
                  <Sparkles size={14} />
                  更多
                  <ChevronDown size={12} style={{ transition: 'transform 0.2s', transform: isMoreOpen ? 'rotate(180deg)' : 'none' }} />
                </button>

                {isMoreOpen && (
                  <div className="style-preset-dropdown">
                    {morePresets.map((preset) => (
                      <button
                        key={preset.id}
                        className="style-preset-dropdown-item"
                        onClick={() => handleStyleChange(preset.id)}
                        type="button"
                      >
                        {preset.id === 'default' ? <MessageSquareText size={13} /> :
                         preset.id === 'engineer' ? <Cpu size={13} /> :
                         preset.id === 'charm' ? <Smile size={13} /> :
                         <Sparkles size={13} />}
                        <span style={{ flexGrow: 1, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{preset.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="panel dashboard-panel" aria-label="最近记录">
        <div className="panel-header">
          <h2>最近记录</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {props.records.length > 0 && (
              <button className="clear-all-btn" onClick={props.onClearAll} type="button">
                <Eraser size={14} />
                清空
              </button>
            )}
          </div>
        </div>
        <FullRecordList {...props} />
      </section>
    </div>
  );
}

function CompactMetric({ icon, label, value, title }: { icon: ReactNode; label: string; value: string; title?: string }) {
  return (
    <div className="compact-metric" title={title ?? value}>
      <div className="compact-metric-icon">{icon}</div>
      <div className="compact-metric-text">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function OverviewStat({ icon, label, value, type }: { icon: ReactNode; label: string; value: string; type?: string }) {
  return (
    <div className={`overview-stat${type ? ` stat-${type}` : ''}`} title={`${label} ${value}`}>
      <span className="overview-stat-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function shortenAsrLabel(value: string): string {
  const label = value.trim();
  if (/sensevoice/i.test(label)) return 'SenseVoice';
  if (/faster[-\s]?whisper/i.test(label)) return 'faster-whisper';
  if (/whisper\.cpp/i.test(label)) return 'whisper.cpp';
  if (/whisper/i.test(label)) return 'Whisper';
  if (/cloud|云端|api/i.test(label)) return '云端 ASR';
  return label.replace(/^本地\s*/i, '').split(/[\/｜|]/)[0]?.trim() || label;
}

function shortenModelLabel(value: string): string {
  const model = value.trim();
  const normalized = model.toLowerCase();
  if (normalized.includes('deepseek')) {
    if (/r1/i.test(model)) return 'DeepSeek R1';
    if (/v3|chat/i.test(model)) return 'DeepSeek V3';
    return 'DeepSeek';
  }
  const gpt = /^gpt[-_]?([0-9]+(?:\.[0-9]+)?)/i.exec(model);
  if (gpt) return `GPT-${gpt[1]}`;
  const qwen = /^qwen[-_]?([0-9]+(?:\.[0-9]+)?)/i.exec(model);
  if (qwen) return `Qwen ${qwen[1]}`;
  return model
    .replace(/[-_](?:\d{6,}|\d{4}-\d{2}-\d{2}).*$/i, '')
    .replace(/[-_](?:preview|latest|instruct|chat|pro|mini)$/i, '')
    .trim();
}

/* ─── Full card list ──────────────────────────────────────────────────── */
function FullRecordList(props: {
  settings: SettingsState;
  records: RecordItem[];
  editingRecordId?: string | null;
  onCopyRefined?: (record: RecordItem) => void;
  onCopyOriginal?: (record: RecordItem) => void;
  onDelete?: (record: RecordItem) => void;
  onEdit?: (record: RecordItem) => void;
  onSaveCorrection?: (id: string, text: string) => void;
  onUpdateOriginal?: (record: RecordItem, value: string) => void;
  onUpdateWordbook?: (wordbook: WordbookEntry[]) => void;
}) {
  const [expandedCorrectionId, setExpandedCorrectionId] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState('');
  const [correctionStatus, setCorrectionStatus] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [quickAddRecordId, setQuickAddRecordId] = useState<string | null>(null);
  const [quickAddPairs, setQuickAddPairs] = useState<{ from: string; to: string; selected: boolean }[]>([]);

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
    setCorrectionStatus('');
  };

  const commitCorrection = async (record: RecordItem) => {
    if (correctionDraft.trim()) {
      setCorrectionStatus('正在检测词库候选…');
      await props.onSaveCorrection?.(record.id, correctionDraft.trim());

      // Extract word pairs from the correction record
      try {
        const res = await window.tailkall?.extractWordPairs?.(record.id);
        if (res && res.ok && res.pairs && res.pairs.length > 0) {
          setQuickAddPairs(res.pairs.map((p) => ({ ...p, selected: true })));
          setQuickAddRecordId(record.id);
          setCorrectionStatus('');
        } else {
          setQuickAddRecordId(null);
          setQuickAddPairs([]);
          setCorrectionStatus('未检测到可加入词库的纠正词');
        }
      } catch (err) {
        console.error('Failed to extract word pairs', err);
        setCorrectionStatus('词库候选检测失败，请稍后重试');
      }
    }
  };

  const handleConfirmQuickAdd = () => {
    const selected = quickAddPairs.filter((p) => p.selected);
    if (selected.length === 0) {
      setQuickAddRecordId(null);
      setQuickAddPairs([]);
      return;
    }

    const currentWordbook = [...(props.settings.wordbook ?? [])];

    for (const pair of selected) {
      const targetWord = pair.to.trim();
      const variantWord = pair.from.trim();
      if (!targetWord || !variantWord) continue;

      // Find existing entry with case-insensitive comparison
      const existingIdx = currentWordbook.findIndex(
        (e) => e.target.toLowerCase() === targetWord.toLowerCase()
      );

      if (existingIdx !== -1) {
        const existing = currentWordbook[existingIdx];
        const hasVariant = existing.variants.some(
          (v) => v.toLowerCase() === variantWord.toLowerCase()
        );
        const isSameAsTarget = existing.target.toLowerCase() === variantWord.toLowerCase();
        
        if (!hasVariant && !isSameAsTarget) {
          currentWordbook[existingIdx] = {
            ...existing,
            variants: [...existing.variants, variantWord]
          };
        }
      } else {
        const isSameAsTarget = targetWord.toLowerCase() === variantWord.toLowerCase();
        currentWordbook.push({
          id: `wb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          target: targetWord,
          variants: isSameAsTarget ? [] : [variantWord]
        });
      }
    }

    props.onUpdateWordbook?.(currentWordbook);
    setQuickAddRecordId(null);
    setQuickAddPairs([]);
  };

  const statusClass = (s: string) => s === '已输入' ? 'ok' : s === '整理中' ? 'busy' : 'fail';

  return (
    <div className="record-list">
      {props.records.map((record) => {
        const cleanupDisplay = getCleanupDisplay(record);

        return (
          <div className={`record-card ${record.status === '失败' ? 'failed-card' : ''}`} key={record.id}>
            <div className="record-row">
              <div className="record-content">
                <div className="record-meta">
                  <span>{record.time}</span>
                  <span className={`record-status ${statusClass(record.status)}`}>{record.status}</span>
                  {record.asrDurationMs != null && (
                    <span className="record-duration">提取 {(record.asrDurationMs / 1000).toFixed(1)}s</span>
                  )}
                  {cleanupDisplay && (
                    <span className={`record-duration ${cleanupDisplay.className}`} title={cleanupDisplay.title}>
                      {cleanupDisplay.label}
                    </span>
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
                    onChange={(e) => setCorrectionDraft(e.target.value)}
                    placeholder="粘贴修正后的文本…"
                    value={correctionDraft}
                  />
                  <div className="correction-actions">
                    <button onClick={() => void commitCorrection(record)} type="button">
                      提交并检测词库
                    </button>
                    {correctionStatus && <span className="test-status">{correctionStatus}</span>}
                  </div>
                </div>
              )}

              {quickAddRecordId === record.id && quickAddPairs.length > 0 && (
                <div className="quick-add-wordbook-panel">
                  <div className="quick-add-header">
                    <span style={{ fontSize: '15px' }}>💡</span>
                    <h4>检测到拼写纠正，是否一键加入自定义词库？</h4>
                  </div>
                  <div className="quick-add-pairs-list">
                    {quickAddPairs.map((pair, idx) => (
                      <div key={idx} className="quick-add-pair-item">
                        <label>
                          <input
                            type="checkbox"
                            checked={pair.selected}
                            onChange={(e) => {
                              setQuickAddPairs(current => current.map((p, i) => i === idx ? { ...p, selected: e.target.checked } : p));
                            }}
                          />
                          <span className="quick-add-wrong">{pair.from}</span>
                          <span className="quick-add-arrow">→</span>
                          <span className="quick-add-correct">{pair.to}</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  <div className="quick-add-actions">
                    <button
                      className="quick-add-btn-confirm"
                      onClick={() => handleConfirmQuickAdd()}
                      type="button"
                    >
                      确认加入
                    </button>
                    <button
                      className="quick-add-btn-cancel"
                      onClick={() => {
                        setQuickAddRecordId(null);
                        setQuickAddPairs([]);
                      }}
                      type="button"
                    >
                      忽略
                    </button>
                  </div>
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
        );
      })}
    </div>
  );
}

function getCleanupDisplay(record: RecordItem): { label: string; title?: string; className: string } | undefined {
  if (record.cleanupDurationMs == null) return undefined;

  const cleanupFailed =
    record.cleanupStatus === 'failed' ||
    (record.error != null && !record.cleanup && record.refined === record.original);

  if (cleanupFailed) {
    return {
      label: '整理失败',
      title: record.error ? `整理失败：${record.error}` : '整理失败，已保留并输出原始转写文本',
      className: 'error'
    };
  }

  return {
    label: `整理 ${(record.cleanupDurationMs / 1000).toFixed(1)}s`,
    title: '整理成功',
    className: ''
  };
}

function WordbookEntryRow({
  entry,
  onUpdateEntry,
  onRemove
}: {
  entry: WordbookEntry;
  onUpdateEntry: (entry: WordbookEntry) => void;
  onRemove: () => void;
}) {
  const [isEditingTarget, setIsEditingTarget] = useState(false);
  const [targetVal, setTargetVal] = useState(entry.target);
  const [newChipVal, setNewChipVal] = useState('');

  useEffect(() => {
    setTargetVal(entry.target);
  }, [entry.target]);

  const handleTargetBlur = () => {
    setIsEditingTarget(false);
    if (targetVal.trim() && targetVal.trim() !== entry.target) {
      onUpdateEntry({ ...entry, target: targetVal.trim() });
    } else {
      setTargetVal(entry.target);
    }
  };

  const handleRemoveChip = (chipIndex: number) => {
    const updatedVariants = entry.variants.filter((_, idx) => idx !== chipIndex);
    onUpdateEntry({ ...entry, variants: updatedVariants });
  };

  const handleAddChip = () => {
    const trimmed = newChipVal.trim();
    if (trimmed) {
      const parts = trimmed.split(/[,，]/).map(v => v.trim()).filter(Boolean);
      const newVariants = [...entry.variants];
      for (const p of parts) {
        if (!newVariants.some(v => v.toLowerCase() === p.toLowerCase()) && p.toLowerCase() !== entry.target.toLowerCase()) {
          newVariants.push(p);
        }
      }
      onUpdateEntry({ ...entry, variants: newVariants });
    }
    setNewChipVal('');
  };

  return (
    <div className="wordbook-entry-card">
      <div className="wordbook-target-editor">
        {isEditingTarget ? (
          <input
            aria-label="编辑目标词"
            className="wordbook-target-input"
            value={targetVal}
            onChange={(e) => setTargetVal(e.target.value)}
            onBlur={handleTargetBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTargetBlur();
              if (e.key === 'Escape') {
                setTargetVal(entry.target);
                setIsEditingTarget(false);
              }
            }}
            autoFocus
          />
        ) : (
          <div
            className="wordbook-target-text"
            onClick={() => setIsEditingTarget(true)}
            title="点击修改目标词"
          >
            {entry.target}
          </div>
        )}
      </div>

      <div className="wordbook-chips">
        {entry.variants.map((variant, idx) => (
          <span key={idx} className="wordbook-chip">
            {variant}
            <button
              className="wordbook-chip-remove"
              onClick={() => handleRemoveChip(idx)}
              type="button"
              title="删除变体"
            >
              ×
            </button>
          </span>
        ))}
        <input
          aria-label="添加发音变体"
          className="wordbook-chip-input"
          placeholder="+ 添加变体"
          value={newChipVal}
          onChange={(e) => setNewChipVal(e.target.value)}
          onBlur={handleAddChip}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAddChip();
          }}
        />
      </div>

      <button
        aria-label={`删除词条 ${entry.target}`}
        className="wordbook-delete"
        onClick={onRemove}
        type="button"
        title="删除整条记录"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function SettingsView(props: {
  appearance: Appearance;
  settings: SettingsState;
  microphoneDevices: MicrophoneDevice[];
  records: RecordItem[];
  onClearDiagnosticLogs: () => void;
  onAppearanceChange: (appearance: Appearance) => void;
  onUpdate: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
}) {
  const { settings, onUpdate } = props;
  const diagnosticRecords = props.records.filter((record) => record.error);
  const diagnosticKind = (record: RecordItem) => {
    const text = `${record.cleanup ?? ''} ${record.error ?? ''}`;
    if (/cleanup|llm|chat\/completions|api key|insufficient|balance|quota|大模型|接口/i.test(text)) {
      return '大模型 / 接口错误';
    }
    if (/asr|whisper|transcri|speech|语音|识别/i.test(text)) {
      return '语音识别错误';
    }
    if (/paste|clipboard|剪贴板|粘贴/i.test(text)) {
      return '粘贴输出错误';
    }
    return '运行错误';
  };
  const [newTarget, setNewTarget] = useState('');
  const [newVariants, setNewVariants] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureDisplay, setCaptureDisplay] = useState('请按下快捷键组合...');
  const [isCapturingMouse, setIsCapturingMouse] = useState(false);
  const [mouseCaptureDisplay, setMouseCaptureDisplay] = useState('请按下鼠标按键');
  const microphoneOptions = [
    { value: '', label: '系统默认麦克风' },
    ...props.microphoneDevices.map((device) => ({ value: device.deviceId, label: device.label }))
  ];
  if (
    settings.microphoneDeviceId &&
    !microphoneOptions.some((option) => option.value === settings.microphoneDeviceId)
  ) {
    microphoneOptions.push({ value: settings.microphoneDeviceId, label: '已保存的麦克风' });
  }

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

  useEffect(() => {
    if (!isCapturingMouse) return;

    const handleMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const nextTrigger = mouseButtonToTriggerLabel(event.button);
      if (!nextTrigger) {
        setMouseCaptureDisplay('暂不支持该鼠标按键');
        return;
      }

      onUpdate('mouseTrigger', nextTrigger);
      setMouseCaptureDisplay(mouseTriggerDisplay(nextTrigger));
      setIsCapturingMouse(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setIsCapturingMouse(false);
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('contextmenu', preventCaptureContextMenu, true);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('contextmenu', preventCaptureContextMenu, true);
    };
  }, [isCapturingMouse, onUpdate]);

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
            <button
              aria-label="鼠标快捷键"
              className={`shortcut-capture mouse-capture ${isCapturingMouse ? 'active' : ''}`}
              onClick={() => {
                setIsCapturingMouse(true);
                setMouseCaptureDisplay('请按下鼠标按键');
              }}
              style={{ width: '100%', boxSizing: 'border-box' }}
              type="button"
            >
              <span>{isCapturingMouse ? mouseCaptureDisplay : mouseTriggerDisplay(settings.mouseTrigger)}</span>
            </button>
            <div className="shortcut-help" style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              {isCapturingMouse ? '正在录制中，请点击鼠标按键（Esc 键取消）' : '点击上方卡片开始识别鼠标按键'}
            </div>
            <input
              type="text"
              aria-label="鼠标快捷键值"
              value={settings.mouseTrigger}
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
            麦克风
            <CustomSelect
              ariaLabel="麦克风"
              onChange={(val) => onUpdate('microphoneDeviceId', val)}
              options={microphoneOptions}
              value={settings.microphoneDeviceId}
            />
          </label>
          <label>
            输出模式
            <CustomSelect
              onChange={(val) => onUpdate('outputMode', val)}
              options={[
                { value: '粘贴到当前光标', label: '粘贴到当前光标' },
                { value: '复制到剪贴板', label: '复制到剪贴板' },
                { value: '仅保存记录', label: '仅保存记录' }
              ]}
              value={settings.outputMode}
            />
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
        <p className="wordbook-desc">
          词库用于纠正 ASR 识别出的错误读音或相近词汇。在下方添加您的专有名词或高频词汇（如英文词、电商词），系统将在 ASR 识别后自动替换，或提供给 AI 整理。支持点击目标词就地修改，通过标签查看、添加或删除错误变体。
        </p>
        {(settings.wordbook ?? []).length > 0 && (
          <div className="wordbook-list">
            {(settings.wordbook ?? []).map((entry) => (
              <WordbookEntryRow
                key={entry.id}
                entry={entry}
                onUpdateEntry={(updatedEntry) => {
                  const newWb = (settings.wordbook ?? []).map((e) => e.id === entry.id ? updatedEntry : e);
                  onUpdate('wordbook', newWb);
                }}
                onRemove={() => removeWordbookEntry(entry.id)}
              />
            ))}
          </div>
        )}
        <div className="wordbook-add-row" style={{ marginTop: '16px' }}>
          <input
            aria-label="新词库目标词"
            onChange={(e) => setNewTarget(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addWordbookEntry(); }}
            placeholder="新目标词，如 Codex"
            value={newTarget}
          />
          <input
            aria-label="新词库发音变体"
            onChange={(e) => setNewVariants(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addWordbookEntry(); }}
            placeholder="变体（可选，逗号分隔，如 code x, codecs）"
            value={newVariants}
          />
          <button onClick={addWordbookEntry} type="button">添加</button>
        </div>
      </section>

      <section aria-label="诊断日志" className="panel settings-card diagnostic-log-section">
        <div className="diagnostic-log-header">
          <h2>
            <Bug size={18} />
            诊断日志
          </h2>
          {diagnosticRecords.length > 0 && (
            <button className="diagnostic-log-clear" onClick={props.onClearDiagnosticLogs} type="button">
              清空诊断日志
            </button>
          )}
        </div>
        {diagnosticRecords.length > 0 ? (
          <div className="diagnostic-log-list">
            {diagnosticRecords.map((record) => (
              <article className="diagnostic-log-entry" key={record.id} title={record.error}>
                <div className="diagnostic-log-meta">
                  <span>{record.time}</span>
                  <span>{diagnosticKind(record)}</span>
                  {record.cleanup && <span>{record.cleanup}</span>}
                </div>
                <div className="diagnostic-log-body">{record.error}</div>
              </article>
            ))}
          </div>
        ) : (
          <p className="diagnostic-log-empty">暂无诊断日志</p>
        )}
      </section>
      </div>
    </div>
  );
}

function preventCaptureContextMenu(event: Event): void {
  event.preventDefault();
}

function mouseButtonToTriggerLabel(button: number): string | undefined {
  switch (button) {
    case 0:
      return 'Mouse Left';
    case 1:
      return 'Mouse Middle';
    case 2:
      return 'Mouse Right';
    case 3:
      return 'Mouse Side 1';
    case 4:
      return 'Mouse Side 2';
    default:
      return undefined;
  }
}

function mouseTriggerDisplay(value: string): string {
  switch (value) {
    case 'Mouse Left':
      return '鼠标左键';
    case 'Mouse Right':
      return '鼠标右键';
    case 'Mouse Middle':
      return '鼠标中键';
    case 'Mouse Side 1':
      return '鼠标侧键 1';
    case 'Mouse Side 2':
      return '鼠标侧键 2';
    default:
      return value || '未设置';
  }
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

export interface CustomSelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  options: CustomSelectOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  isLargeCard?: boolean;
}

export function CustomSelect({
  options,
  value,
  onChange,
  className = '',
  style,
  ariaLabel,
  isLargeCard = false
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const selectedOption = options.find(opt => opt.value === value) || options[0];

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${isLargeCard ? 'large-card' : ''} ${className}`}
      style={style}
    >
      <button
        type="button"
        className={`custom-select-trigger ${isLargeCard ? 'mouse-select-card' : ''} ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        style={isLargeCard ? { position: 'relative' } : undefined}
      >
        <span style={isLargeCard ? { margin: '0 auto' } : undefined}>
          {selectedOption ? selectedOption.label : ''}
        </span>
        <ChevronDown
          size={isLargeCard ? 20 : 14}
          className="select-chevron"
          style={{
            transition: 'transform 0.15s ease',
            transform: isOpen ? 'rotate(180deg)' : 'none',
            position: isLargeCard ? 'absolute' : 'static',
            right: isLargeCard ? '24px' : 'auto',
            marginLeft: isLargeCard ? '0' : 'auto'
          }}
        />
      </button>

      {isOpen && (
        <div className="custom-select-dropdown">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`custom-select-dropdown-item ${opt.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

