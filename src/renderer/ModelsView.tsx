import { useState, type ReactNode } from 'react';
import { Brain, Server, PlugZap, X } from 'lucide-react';

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
  const activeAsrProfile = settings.asrProfiles.find((profile) => profile.id === settings.activeAsrProfileId) ?? settings.asrProfiles[0];
  const isCloudAsr = activeAsrProfile?.kind === 'cloud-upload' || activeAsrProfile?.kind === 'cloud-streaming';
  const [cloudTestStatus, setCloudTestStatus] = useState('');
  const [providerTestStatus, setProviderTestStatus] = useState<Record<string, string>>({});
  const [configProviderKey, setConfigProviderKey] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const configProvider = settings.llmProviders.find((provider) => provider.key === configProviderKey);

  const updateAsrProfile = <K extends keyof AsrProfileConfig>(id: string, key: K, value: AsrProfileConfig[K]) => {
    onUpdate('asrProfiles', settings.asrProfiles.map((profile) => profile.id === id ? { ...profile, [key]: value } : profile));
  };

  const updateLlmProvider = <K extends keyof LlmProviderConfig>(keyName: string, key: K, value: LlmProviderConfig[K]) => {
    onUpdate('llmProviders', settings.llmProviders.map((provider) => provider.key === keyName ? { ...provider, [key]: value } : provider));
    if (keyName === settings.activeLlmProviderKey) {
      if (key === 'baseUrl') {
        onUpdate('baseURL', value as SettingsState['baseURL']);
      }
      if (key === 'model') {
        onUpdate('model', value as SettingsState['model']);
      }
      if (key === 'apiKey') {
        onUpdate('apiKey', value as SettingsState['apiKey']);
      }
    }
  };

  const selectAsrProfile = (id: string) => {
    const next = settings.asrProfiles.find((profile) => profile.id === id);
    onUpdate('activeAsrProfileId', id);
    if (next) {
      onUpdate('asr', next.kind === 'local' ? next.engine : '云端 ASR');
    }
  };

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

  const testLlmProvider = async (provider: LlmProviderConfig) => {
    setProviderTestStatus((current) => ({ ...current, [provider.key]: '测试中…' }));
    try {
      const result = await getFacade().testRewriteApi?.({
        ...settings,
        provider: provider.displayName,
        baseURL: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model
      });
      setProviderTestStatus((current) => ({ ...current, [provider.key]: result?.message || '连接成功' }));
    } catch {
      setProviderTestStatus((current) => ({ ...current, [provider.key]: '连接失败' }));
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
            当前 ASR 档案
            <select onChange={(event) => selectAsrProfile(event.target.value)} value={settings.activeAsrProfileId}>
              {settings.asrProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            ASR 引擎
            <select
              onChange={(event) => {
                if (activeAsrProfile) {
                  updateAsrProfile(activeAsrProfile.id, 'engine', event.target.value);
                }
                onUpdate('asr', event.target.value);
              }}
              value={activeAsrProfile?.kind === 'local' ? activeAsrProfile.engine : settings.asr}
            >
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

        <div className="provider-card-grid asr-card-grid">
          {settings.asrProfiles.map((profile) => (
            <article className={profile.id === settings.activeAsrProfileId ? 'provider-card active' : 'provider-card'} key={profile.id}>
              <div className="provider-card-header">
                <div>
                  <h3>{profile.displayName}</h3>
                  <span>{profile.kind === 'local' ? '本地模型' : profile.kind === 'cloud-upload' ? '云端上传' : '云端流式'}</span>
                </div>
                <button onClick={() => selectAsrProfile(profile.id)} type="button">选择</button>
              </div>
              {profile.kind !== 'local' && (
                <div className="provider-card-fields">
                  <label>
                    {profile.displayName} Base URL
                    <input onChange={(event) => updateAsrProfile(profile.id, 'baseUrl', event.target.value)} value={profile.baseUrl ?? ''} />
                  </label>
                  <label>
                    {profile.displayName} Model
                    <input onChange={(event) => updateAsrProfile(profile.id, 'model', event.target.value)} value={profile.model ?? ''} />
                  </label>
                  <label>
                    {profile.displayName} API Key
                    <input onChange={(event) => updateAsrProfile(profile.id, 'apiKey', event.target.value)} type="password" value={profile.apiKey ?? ''} />
                  </label>
                  <button onClick={testCloudAsr} type="button">
                    <PlugZap size={16} />
                    测试连接
                  </button>
                </div>
              )}
            </article>
          ))}
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
        <div className="provider-card-grid">
          {settings.llmProviders.map((provider) => (
            <article className={provider.key === settings.activeLlmProviderKey ? 'provider-card active' : 'provider-card'} key={provider.key}>
              <div className="provider-card-header">
                <div>
                  <h3>{provider.displayName}</h3>
                  <span>OpenAI-compatible</span>
                  <small>{provider.model ? `默认模型：${provider.model}` : '未选择模型'}</small>
                </div>
                <span aria-label={provider.key === settings.activeLlmProviderKey ? '当前默认' : '未启用'} className={provider.key === settings.activeLlmProviderKey ? 'provider-status active' : 'provider-status'} />
              </div>
              <button
                aria-label={`点击配置 ${provider.displayName}`}
                className="provider-config-link"
                onClick={() => setConfigProviderKey(provider.key)}
                type="button"
              >
                点击配置
              </button>
            </article>
          ))}
        </div>
        <div className="form-grid">
          <div className="wide prompt-config">
            <button
              aria-expanded={promptExpanded}
              className="prompt-config-toggle"
              onClick={() => setPromptExpanded((current) => !current)}
              type="button"
            >
              Prompt 模板
            </button>
            {promptExpanded && (
              <label>
                Prompt 模板
                <textarea onChange={(event) => onUpdate('prompt', event.target.value)} value={settings.prompt} />
              </label>
            )}
          </div>
          {props.testStatus && <span className={`test-status${props.testStatus.includes('成功') ? ' success' : ''}`}>{props.testStatus}</span>}
        </div>
      </section>
      {configProvider && (
        <div className="modal-backdrop" role="presentation">
          <section aria-modal="true" aria-label={`${configProvider.displayName} 设置`} className="provider-modal" role="dialog">
            <div className="provider-modal-header">
              <div>
                <h2>{configProvider.displayName} 设置</h2>
                <span>大模型服务商</span>
              </div>
              <div className="provider-modal-actions">
                <button
                  className={configProvider.key === settings.activeLlmProviderKey ? 'provider-enable active' : 'provider-enable'}
                  onClick={() => {
                    onUpdate('activeLlmProviderKey', configProvider.key);
                    onUpdate('provider', configProvider.displayName);
                    onUpdate('baseURL', configProvider.baseUrl);
                    onUpdate('model', configProvider.model);
                    onUpdate('apiKey', configProvider.apiKey);
                  }}
                  type="button"
                >
                  {configProvider.key === settings.activeLlmProviderKey ? '已启用' : '设为默认模型'}
                </button>
                <button aria-label="关闭配置" className="modal-close" onClick={() => setConfigProviderKey(null)} type="button">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="provider-modal-body">
              <label>
                {configProvider.displayName} API Key
                <input onChange={(event) => updateLlmProvider(configProvider.key, 'apiKey', event.target.value)} type="password" value={configProvider.apiKey} />
              </label>
              <label>
                {configProvider.displayName} Base URL
                <input onChange={(event) => updateLlmProvider(configProvider.key, 'baseUrl', event.target.value)} value={configProvider.baseUrl} />
              </label>
              <label>
                {configProvider.displayName} Model
                <input onChange={(event) => updateLlmProvider(configProvider.key, 'model', event.target.value)} value={configProvider.model} />
              </label>
              <div className="field-action">
                <button onClick={() => void testLlmProvider(configProvider)} type="button">
                  <PlugZap size={16} />
                  测试连接
                </button>
                {providerTestStatus[configProvider.key] && (
                  <span className={`test-status${providerTestStatus[configProvider.key].includes('成功') ? ' success' : ''}`}>
                    {providerTestStatus[configProvider.key]}
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
