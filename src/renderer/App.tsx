import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ClipboardCopy,
  Gauge,
  Keyboard,
  Mic,
  PlugZap,
  RefreshCcw,
  Settings,
  Trash2,
  WandSparkles
} from 'lucide-react';
import './styles.css';

type View = 'dashboard' | 'records' | 'settings';

type RecordItem = {
  id: string;
  time: string;
  original: string;
  refined: string;
  status: '已输入' | '整理中' | '失败';
  asr?: string;
  cleanup?: string;
  durationMs?: number;
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
  provider: string;
  baseURL: string;
  model: string;
  apiKey: string;
  prompt: string;
  outputMode: string;
  dataDir: string;
  shortPressAction: string;
  longPressAction: string;
  smartMouseMode: boolean;
};

type TailKallFacade = {
  getDashboard?: () => Promise<{ settings: SettingsState; records: RecordItem[] }>;
  saveSettings?: (settings: SettingsState) => Promise<SettingsState>;
  submitRecording?: (audio: ArrayBuffer, durationMs: number) => Promise<{ ok: boolean }>;
  copyText?: (text: string) => Promise<void>;
  rewriteRecord?: (id: string) => Promise<void>;
  pasteRecord?: (id: string) => Promise<void>;
  deleteRecord?: (id: string) => Promise<void>;
  testRewriteApi?: (settings: SettingsState) => Promise<{ ok: boolean; message: string }>;
  windowControl?: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<boolean>;
  onRecordingStart?: (callback: () => void) => () => void;
  onRecordingStop?: (callback: () => void) => () => void;
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
  provider: 'OpenAI Compatible',
  baseURL: 'https://api.example.com/v1',
  model: 'gpt-4.1-mini',
  apiKey: 'demo-api-key',
  prompt: '请整理语音输入文本，修正错别字和标点，直接返回整理后的文本。',
  outputMode: '粘贴到当前光标',
  dataDir: 'D:\\Antigravity\\tailkall\\data',
  shortPressAction: '语音输入',
  longPressAction: '语音助手',
  smartMouseMode: true
};

const demoRecords: RecordItem[] = [
  {
    id: 'rec-1',
    time: '今天 09:18',
    original:
      '请帮我整理今天会议关于登录体验、首屏性能和快捷键冲突处理的讨论，保留结论、负责人和下次跟进时间。',
    refined: '会议结论：优化登录体验与首屏性能，排查快捷键冲突。负责人分别跟进，下次例会同步结果。',
    status: '已输入',
    asr: '本地 Whisper / small',
    cleanup: 'OpenAI Compatible / gpt-4.1-mini',
    durationMs: 8200,
    pasteSucceeded: true
  },
  {
    id: 'rec-2',
    time: '昨天 17:42',
    original: '把这段客户反馈整理成工单，强调语音识别延迟和偶发粘贴失败。',
    refined: '工单：语音识别存在延迟，偶发粘贴失败。请排查录音结束到文本输出链路。',
    status: '已输入'
  }
];

function getFacade(): TailKallFacade {
  return window.tailkall ?? {};
}

export default function App() {
  const [view, setView] = useState<View>('dashboard');
  const [settings, setSettings] = useState<SettingsState>(demoSettings);
  const [records, setRecords] = useState<RecordItem[]>(demoRecords);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState('未测试');
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isCapturingTrigger, setIsCapturingTrigger] = useState(false);

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

  useEffect(() => {
    if (!isCapturingTrigger) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const label = formatKeyboardTrigger(event);
      if (label) {
        updateSetting('triggerKey', label);
        setIsCapturingTrigger(false);
      }
    };
    const handleMouseDown = (event: MouseEvent) => {
      const label = formatMouseTrigger(event);
      if (!label) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      updateSetting('triggerKey', label);
      setIsCapturingTrigger(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [isCapturingTrigger, settings]);

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

  const recentRecords = useMemo(() => records.slice(0, 3), [records]);

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

  const captureTriggerKey = async () => {
    setIsCapturingTrigger(true);
  };

  const testRewriteApi = async () => {
    const result = await getFacade().testRewriteApi?.(settings);
    setTestStatus(result?.message || '连接成功');
  };

  return (
    <div className="window-shell">
      <WindowTitlebar />
      <main className="app-shell">
        <aside className="sidebar" aria-label="主导航">
          <div className="brand">
            <Mic size={24} />
            <span>TailKall</span>
          </div>
          <NavButton active={view === 'dashboard'} icon={<Gauge size={18} />} label="仪表盘" onClick={() => setView('dashboard')} />
          <NavButton active={view === 'records'} icon={<ClipboardCopy size={18} />} label="语音记录" onClick={() => setView('records')} />
          <NavButton active={view === 'settings'} icon={<Settings size={18} />} label="设置" onClick={() => setView('settings')} />
        </aside>

        <section className="content">
          {view === 'dashboard' && <Dashboard settings={settings} records={recentRecords} />}
          {view === 'records' && (
            <RecordsView
              editingRecordId={editingRecordId}
              records={records}
              onCopyOriginal={(record) => copyText(record.original)}
              onCopyRefined={(record) => copyText(record.refined)}
              onDelete={(record) => deleteRecord(record.id)}
              onEdit={(record) => setEditingRecordId(record.id)}
              onPaste={(record) => getFacade().pasteRecord?.(record.id)}
              onRewrite={(record) => getFacade().rewriteRecord?.(record.id)}
              onUpdateOriginal={(record, value) => {
                setRecords((current) => current.map((item) => (item.id === record.id ? { ...item, original: value } : item)));
              }}
            />
          )}
          {view === 'settings' && (
            <SettingsView
              settings={settings}
              testStatus={testStatus}
              onCaptureTriggerKey={captureTriggerKey}
              isCapturingTrigger={isCapturingTrigger}
              onTestRewriteApi={testRewriteApi}
              onUpdate={updateSetting}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function WindowTitlebar() {
  const control = (action: 'minimize' | 'toggle-maximize' | 'close') => {
    void getFacade().windowControl?.(action);
  };

  return (
    <header aria-label="TailKall 窗口栏" className="window-titlebar">
      <div className="window-title">
        <Mic size={15} />
        <span>TailKall</span>
      </div>
      <div className="window-controls">
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
    </header>
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

function Dashboard({ settings, records }: { settings: SettingsState; records: RecordItem[] }) {
  return (
    <div className="view-stack">
      <h1>仪表盘</h1>
      <div className="metric-grid">
        <Metric icon={<Keyboard />} label="当前触发键" value={settings.triggerKey} />
        <Metric icon={<Mic />} label="ASR" value={settings.asr} />
        <Metric icon={<PlugZap />} label="文案整理 API" value={`${settings.provider} / ${settings.model}`} />
      </div>
      <section className="panel" aria-label="最近记录">
        <h2>最近记录</h2>
        <RecordTable compact records={records} />
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

function RecordsView(props: {
  records: RecordItem[];
  editingRecordId: string | null;
  onCopyOriginal: (record: RecordItem) => void;
  onCopyRefined: (record: RecordItem) => void;
  onDelete: (record: RecordItem) => void;
  onEdit: (record: RecordItem) => void;
  onPaste: (record: RecordItem) => void;
  onRewrite: (record: RecordItem) => void;
  onUpdateOriginal: (record: RecordItem, value: string) => void;
}) {
  return (
    <div className="view-stack">
      <h1>语音记录</h1>
      <RecordTable {...props} />
    </div>
  );
}

function RecordTable(props: {
  records: RecordItem[];
  compact?: boolean;
  editingRecordId?: string | null;
  onCopyOriginal?: (record: RecordItem) => void;
  onCopyRefined?: (record: RecordItem) => void;
  onDelete?: (record: RecordItem) => void;
  onEdit?: (record: RecordItem) => void;
  onPaste?: (record: RecordItem) => void;
  onRewrite?: (record: RecordItem) => void;
  onUpdateOriginal?: (record: RecordItem, value: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>原文</th>
            <th>整理后</th>
            <th>状态</th>
            {!props.compact && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {props.records.map((record) => (
            <tr key={record.id}>
              <td className="time-cell">{record.time}</td>
              <td>
                {props.editingRecordId === record.id ? (
                  <input
                    aria-label="编辑原文"
                    className="inline-editor"
                    onBlur={() => props.onEdit?.({ ...record, id: '' })}
                    onChange={(event) => props.onUpdateOriginal?.(record, event.target.value)}
                    value={record.original}
                  />
                ) : (
                  <button className="truncate-cell cell-button" onClick={() => props.onEdit?.(record)} title={record.original} type="button">
                    {record.original}
                  </button>
                )}
              </td>
              <td>
                <span className="truncate-cell" title={record.refined}>
                  {record.refined}
                </span>
              </td>
              <td>{record.status}</td>
              {!props.compact && (
                <td>
                  <div className="row-actions">
                    <button onClick={() => props.onCopyOriginal?.(record)} type="button">
                      <ClipboardCopy size={14} />
                      复制原文
                    </button>
                    <button onClick={() => props.onCopyRefined?.(record)} type="button">
                      <ClipboardCopy size={14} />
                      复制整理
                    </button>
                    <button onClick={() => props.onRewrite?.(record)} type="button">
                      <RefreshCcw size={14} />
                      重新整理
                    </button>
                    <button onClick={() => props.onPaste?.(record)} type="button">
                      <WandSparkles size={14} />
                      再次粘贴
                    </button>
                    <button className="danger" onClick={() => props.onDelete?.(record)} type="button">
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsView(props: {
  settings: SettingsState;
  testStatus: string;
  isCapturingTrigger: boolean;
  onCaptureTriggerKey: () => void;
  onTestRewriteApi: () => void;
  onUpdate: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
}) {
  const { settings, onUpdate } = props;

  return (
    <div className="view-stack settings-view">
      <h1>设置</h1>
      <section className="panel">
        <h2>语音输入</h2>
        <div className="shortcut-config">
          <button
            className={props.isCapturingTrigger ? 'shortcut-capture active' : 'shortcut-capture'}
            onClick={props.onCaptureTriggerKey}
            type="button"
          >
            <Keyboard size={18} />
            <span>{settings.triggerKey}</span>
          </button>
          <span className="shortcut-help">{props.isCapturingTrigger ? '按下键盘按键、组合键或鼠标中键/侧键' : '点击上方按钮修改'}</span>
          <div className="press-mode-grid">
            <div className="press-card">
              <h3>短按</h3>
              <p>按一下开始说话，再按一下结束</p>
              <label>
                <span className="sr-only">短按动作</span>
                <select
                  aria-label="短按动作"
                  onChange={(event) => onUpdate('shortPressAction', event.target.value)}
                  value={settings.shortPressAction}
                >
                  <option>语音输入</option>
                  <option>语音助手</option>
                </select>
              </label>
            </div>
            <div className="press-card">
              <h3>长按</h3>
              <p>按住说话，松开结束</p>
              <label>
                <span className="sr-only">长按动作</span>
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
          </div>
          <label className="smart-mouse-row">
            <span>
              <strong>智能鼠标模式</strong>
              <small>鼠标中键将同步应用上述“短按”与“长按”逻辑</small>
            </span>
            <input
              aria-label="智能鼠标模式"
              checked={settings.smartMouseMode}
              onChange={(event) => onUpdate('smartMouseMode', event.target.checked)}
              type="checkbox"
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            ASR 引擎
            <select onChange={(event) => onUpdate('asr', event.target.value)} value={settings.asr}>
              <option>SenseVoice / FunASR</option>
              <option>faster-whisper</option>
              <option>whisper.cpp</option>
              <option>云端 ASR</option>
            </select>
          </label>
          <label>
            加速策略
            <select onChange={(event) => onUpdate('asrAcceleration', event.target.value)} value={settings.asrAcceleration}>
              <option>GPU 优先</option>
              <option>CPU</option>
            </select>
          </label>
          <label className="wide">
            本地模型目录
            <input onChange={(event) => onUpdate('localModelDir', event.target.value)} value={settings.localModelDir} />
          </label>
          <label className="wide">
            whisper.cpp 程序
            <input onChange={(event) => onUpdate('localAsrExePath', event.target.value)} value={settings.localAsrExePath} />
          </label>
          <label className="wide">
            whisper 模型文件
            <input onChange={(event) => onUpdate('localAsrModelPath', event.target.value)} value={settings.localAsrModelPath} />
          </label>
          <label className="wide">
            ffmpeg 程序
            <input onChange={(event) => onUpdate('ffmpegPath', event.target.value)} value={settings.ffmpegPath} />
          </label>
          <label className="wide">
            faster-whisper 模型目录
            <input onChange={(event) => onUpdate('fasterWhisperModelPath', event.target.value)} value={settings.fasterWhisperModelPath} />
          </label>
          <label className="wide">
            SenseVoice 模型目录
            <input onChange={(event) => onUpdate('senseVoiceModelPath', event.target.value)} value={settings.senseVoiceModelPath} />
          </label>
          <label className="wide">
            Python 运行时
            <input onChange={(event) => onUpdate('pythonPath', event.target.value)} value={settings.pythonPath} />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>文案整理 API</h2>
        <div className="form-grid">
          <label>
            Provider
            <input onChange={(event) => onUpdate('provider', event.target.value)} value={settings.provider} />
          </label>
          <label>
            Base URL
            <input onChange={(event) => onUpdate('baseURL', event.target.value)} value={settings.baseURL} />
          </label>
          <label>
            Model
            <input onChange={(event) => onUpdate('model', event.target.value)} value={settings.model} />
          </label>
          <label>
            API Key
            <input onChange={(event) => onUpdate('apiKey', event.target.value)} type="password" value={settings.apiKey} />
          </label>
          <label className="wide">
            Prompt 模板
            <textarea onChange={(event) => onUpdate('prompt', event.target.value)} value={settings.prompt} />
          </label>
          <div className="field-action">
            <button onClick={props.onTestRewriteApi} type="button">
              <PlugZap size={16} />
              测试连接
            </button>
            <span className="test-status">{props.testStatus}</span>
          </div>
        </div>
      </section>

      <section className="panel">
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
    </div>
  );
}

function formatKeyboardTrigger(event: KeyboardEvent): string {
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Win' : ''
  ].filter(Boolean);
  const key = normalizeKeyLabel(event.key);
  if (!key) {
    return '';
  }
  if (['Control', 'Alt', 'Shift', 'Win'].includes(key)) {
    return modifiers.length ? modifiers.join(' + ') : key;
  }
  return [...modifiers, key].join(' + ');
}

function normalizeKeyLabel(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'Meta') return 'Win';
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function formatMouseTrigger(event: MouseEvent): string {
  if (event.button === 1) return 'Mouse Middle';
  if (event.button === 3) return 'Mouse Side 1';
  if (event.button === 4) return 'Mouse Side 2';
  return '';
}
