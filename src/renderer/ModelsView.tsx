import { useState, type ReactNode } from 'react';
import { Brain, Server, PlugZap } from 'lucide-react';

type WordbookEntry = {
  id: string;
  target: string;
  variants: string[];
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
};

function getFacade() {
  return window.tailkall ?? {};
}

const LOCAL_ASR_ENGINES = ['SenseVoice / FunASR', 'faster-whisper', 'whisper.cpp'];

export default function ModelsView(props: {
  settings: SettingsState;
  testStatus: string;
  onTestRewriteApi: () => void;
  onUpdate: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
}) {
  const { settings, onUpdate } = props;
  const isCloudAsr = settings.asr === '云端 ASR';
  const [cloudTestStatus, setCloudTestStatus] = useState('');

  const testCloudAsr = async () => {
    setCloudTestStatus('测试中…');
    try {
      const facade = getFacade();
      const result = await facade.testRewriteApi?.({
        ...settings,
        provider: 'cloud-asr',
        baseURL: settings.cloudAsrBaseUrl,
        apiKey: settings.cloudAsrApiKey,
        model: settings.cloudAsrModel
      });
      setCloudTestStatus(result?.message || '连接成功');
    } catch {
      setCloudTestStatus('连接失败');
    }
  };

  return (
    <div className="view-stack settings-view">
      <h1>模型</h1>

      {/* ─── ASR Panel ─── */}
      <section className="panel settings-card">
        <h2>
          <Server size={18} />
          语音识别（ASR）
        </h2>
        <div className="form-grid">
          <label>
            ASR 引擎
            <select onChange={(event) => onUpdate('asr', event.target.value)} value={settings.asr}>
              {LOCAL_ASR_ENGINES.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
              <option value="云端 ASR">云端 ASR（在线 API）</option>
            </select>
          </label>
          {!isCloudAsr && (
            <label>
              加速策略
              <select onChange={(event) => onUpdate('asrAcceleration', event.target.value)} value={settings.asrAcceleration}>
                <option>GPU 优先</option>
                <option>CPU</option>
              </select>
            </label>
          )}
        </div>

        {/* Local ASR paths */}
        {!isCloudAsr && (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="wide">
              本地模型目录
              <input onChange={(event) => onUpdate('localModelDir', event.target.value)} value={settings.localModelDir} />
            </label>
            {/whisper\.cpp/i.test(settings.asr) && (
              <>
                <label className="wide">
                  whisper.cpp 程序
                  <input onChange={(event) => onUpdate('localAsrExePath', event.target.value)} value={settings.localAsrExePath} />
                </label>
                <label className="wide">
                  whisper 模型文件
                  <input onChange={(event) => onUpdate('localAsrModelPath', event.target.value)} value={settings.localAsrModelPath} />
                </label>
              </>
            )}
            <label className="wide">
              ffmpeg 程序
              <input onChange={(event) => onUpdate('ffmpegPath', event.target.value)} value={settings.ffmpegPath} />
            </label>
            {/faster-whisper/i.test(settings.asr) && (
              <label className="wide">
                faster-whisper 模型目录
                <input onChange={(event) => onUpdate('fasterWhisperModelPath', event.target.value)} value={settings.fasterWhisperModelPath} />
              </label>
            )}
            {/sensevoice|funasr/i.test(settings.asr) && (
              <label className="wide">
                SenseVoice 模型目录
                <input onChange={(event) => onUpdate('senseVoiceModelPath', event.target.value)} value={settings.senseVoiceModelPath} />
              </label>
            )}
            <label className="wide">
              Python 运行时
              <input onChange={(event) => onUpdate('pythonPath', event.target.value)} value={settings.pythonPath} />
            </label>
          </div>
        )}

        {/* Cloud ASR config */}
        {isCloudAsr && (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>
              API 类型
              <select onChange={(event) => onUpdate('cloudAsrType', event.target.value)} value={settings.cloudAsrType}>
                <option value="openai-whisper">OpenAI Whisper API</option>
                <option value="openai-compatible">OpenAI 兼容</option>
              </select>
            </label>
            <label className="wide">
              Base URL
              <input
                onChange={(event) => onUpdate('cloudAsrBaseUrl', event.target.value)}
                placeholder="https://api.openai.com/v1"
                value={settings.cloudAsrBaseUrl}
              />
            </label>
            <label>
              API Key
              <input
                onChange={(event) => onUpdate('cloudAsrApiKey', event.target.value)}
                type="password"
                value={settings.cloudAsrApiKey}
              />
            </label>
            <label>
              Model
              <input
                onChange={(event) => onUpdate('cloudAsrModel', event.target.value)}
                placeholder="whisper-1"
                value={settings.cloudAsrModel}
              />
            </label>
            <div className="field-action">
              <button onClick={testCloudAsr} type="button">
                <PlugZap size={16} />
                测试连接
              </button>
              {cloudTestStatus && <span className={`test-status${cloudTestStatus.includes('成功') ? ' success' : ''}`}>{cloudTestStatus}</span>}
            </div>
          </div>
        )}
      </section>

      {/* ─── LLM Panel ─── */}
      <section className="panel settings-card">
        <h2>
          <Brain size={18} />
          文案整理（LLM）
        </h2>
        <label className="setting-row smart-mouse-row">
          <span>
            <strong>启用文案整理</strong>
            <small>关闭后将跳过大模型整理，直接使用 ASR 识别结果</small>
          </span>
          <span className="switch-control">
            <input
              aria-label="启用文案整理"
              checked={settings.cleanupEnabled}
              onChange={(event) => onUpdate('cleanupEnabled', event.target.checked)}
              type="checkbox"
            />
            <span aria-hidden="true" />
          </span>
        </label>
        <div className="form-grid">
          <label>
            Provider
            <input onChange={(event) => onUpdate('provider', event.target.value)} value={settings.provider} />
          </label>
          <label className="wide">
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
            {props.testStatus && <span className={`test-status${props.testStatus.includes('成功') ? ' success' : ''}`}>{props.testStatus}</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
