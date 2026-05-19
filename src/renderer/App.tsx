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
  Trash2
} from 'lucide-react';
import ModelsView from './ModelsView';
import './styles.css';
import { DEFAULT_CLEANUP_PROMPT } from '../shared/cleanupPolicy';

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
          <div className="brand">
            <Mic size={24} />
            <span>TailKall</span>
          </div>
          <NavButton active={view === 'dashboard'} icon={<Gauge size={18} />} label="主页" onClick={() => setView('dashboard')} />
          <NavButton active={view === 'models'} icon={<Brain size={18} />} label="模型" onClick={() => setView('models')} />
          <NavButton active={view === 'settings'} icon={<Settings size={18} />} label="设置" onClick={() => setView('settings')} />
        </aside>

        <WindowControls />
        <section className="content">
          {view === 'dashboard' && (
            <Dashboard
              settings={settings}
              editingRecordId={editingRecordId}
              records={records}
              onClearAll={clearAllRecords}
              onCopyRefined={(record) => copyText(record.refined)}
              onDelete={(record) => deleteRecord(record.id)}
              onEdit={(record) => setEditingRecordId(record.id)}
              onSaveCorrection={saveCorrection}
              onUpdateOriginal={(record, value) => {
                setRecords((current) => current.map((item) => (item.id === record.id ? { ...item, original: value } : item)));
              }}
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
        <span aria-hidden="true">-</span>
      </button>
      <button aria-label="最大化或还原" onClick={() => control('toggle-maximize')} type="button">
        <span aria-hidden="true">□</span>
      </button>
      <button aria-label="关闭" className="close" onClick={() => control('close')} type="button">
        <span aria-hidden="true">×</span>
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
  onDelete?: (record: RecordItem) => void;
  onEdit?: (record: RecordItem) => void;
  onSaveCorrection?: (id: string, text: string) => void;
  onUpdateOriginal?: (record: RecordItem, value: string) => void;
}) {
  return (
    <div className="view-stack">
      <h1>主页</h1>
      <div className="metric-grid">
        <Metric icon={<Keyboard />} label="当前触发键" value={props.settings.triggerKey} />
        <Metric icon={<Mic />} label="ASR" value={props.settings.asr} />
        <Metric icon={<PlugZap />} label="文案整理 API" value={`${props.settings.provider} / ${props.settings.model}`} />
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

  const handleCopy = (record: RecordItem) => {
    props.onCopyRefined?.(record);
    setCopiedId(record.id);
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
              {copiedId === record.id ? (
                <span className="copy-feedback">已复制</span>
              ) : (
                <button className="record-action-btn" data-tooltip="复制" aria-label="复制" onClick={() => handleCopy(record)} type="button">
                  <ClipboardCopy size={13} />
                </button>
              )}
              <button className="record-action-btn danger" data-tooltip="删除" aria-label="删除" onClick={() => props.onDelete?.(record)} type="button">
                <Trash2 size={13} />
              </button>
              <button
                className={`record-action-btn${record.userCorrection ? ' has-correction' : ''}`}
                data-tooltip={record.userCorrection ? '修正已提交' : '提交修正'}
                onClick={() => openCorrection(record)}
                type="button"
              >
                <PenLine size={13} />
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
      <section className="panel settings-card">
        <h2>外观</h2>
        <AppearanceSelector current={props.appearance} onChange={props.onAppearanceChange} />
      </section>
      <section className="panel settings-card">
        <h2>快捷键</h2>
        <div className="form-grid">
          <label>
            键盘快捷键
            <select
              aria-label="键盘快捷键"
              onChange={(event) => onUpdate('triggerKey', event.target.value)}
              value={settings.triggerKey}
            >
              <option value="F5">F5</option>
              <option value="F6">F6</option>
              <option value="F7">F7</option>
              <option value="F8">F8</option>
              <option value="F9">F9</option>
              <option value="F10">F10</option>
              <option value="F11">F11</option>
              <option value="F12">F12</option>
              <option value="Ctrl + Alt + Space">Ctrl + Alt + Space</option>
              <option value="Ctrl + Alt + F9">Ctrl + Alt + F9</option>
              <option value="Ctrl + Alt + F10">Ctrl + Alt + F10</option>
              <option value="Ctrl + Shift + Space">Ctrl + Shift + Space</option>
              <option value="Ctrl + Shift + F9">Ctrl + Shift + F9</option>
            </select>
          </label>
          <label>
            鼠标快捷键
            <select
              aria-label="鼠标快捷键"
              onChange={(event) => onUpdate('mouseTrigger', event.target.value)}
              value={settings.mouseTrigger}
            >
              <option value="Mouse Middle">鼠标中键</option>
              <option value="Mouse Side 1">鼠标侧键 1</option>
              <option value="Mouse Side 2">鼠标侧键 2</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel settings-card">
        <h2>触发行为</h2>
        <div className="form-grid">
          <label>
            短按动作
            <select
              aria-label="短按动作"
              onChange={(event) => onUpdate('shortPressAction', event.target.value)}
              value={settings.shortPressAction}
            >
              <option>语音输入</option>
              <option>语音助手</option>
            </select>
          </label>
          <label>
            长按动作
            <select
              aria-label="长按动作"
              onChange={(event) => onUpdate('longPressAction', event.target.value)}
              value={settings.longPressAction}
            >
              <option>语音助手</option>
              <option>语音输入</option>
            </select>
          </label>
        </div>
        <p className="setting-hint">短按：按一下开始，再按一下结束。长按：按住说话，松开结束。</p>
        <label className="setting-row smart-mouse-row">
          <span>
            <strong>智能鼠标模式</strong>
            <small>鼠标中键将同步应用上述短按与长按逻辑</small>
          </span>
          <span className="switch-control">
            <input
              aria-label="智能鼠标模式"
              checked={settings.smartMouseMode}
              onChange={(event) => onUpdate('smartMouseMode', event.target.checked)}
              type="checkbox"
            />
            <span aria-hidden="true" />
          </span>
        </label>
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
