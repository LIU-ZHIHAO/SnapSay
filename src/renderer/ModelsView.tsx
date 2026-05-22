import { useState, type ReactNode } from 'react';
import { Brain, Server, PlugZap, X, Cpu, Globe, Zap } from 'lucide-react';
import { CustomSelect } from './App';

/* ─── Provider Brand Icons (inline SVG) ─── */
function getProviderIcon(key: string): ReactNode {
  const size = 28;
  switch (key) {
    case 'openai':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#10a37f" />
          <path d="M18.1 10.8c.3-1-.1-2.1-.8-2.9a3.2 3.2 0 0 0-3.4-1.2 3.2 3.2 0 0 0-2.4-1.1c-1.3 0-2.4.7-3 1.8a3.2 3.2 0 0 0-2.1 1.6c-.7 1.1-.5 2.5.2 3.5-.3 1 .1 2.1.8 2.9.8.9 2 1.3 3.2 1.2.6.7 1.5 1.1 2.4 1.1 1.3 0 2.4-.7 3-1.8 1.2-.2 2.2-1 2.6-2.1.5-1.1.4-2.3-.5-3z" fill="#fff" fillOpacity="0.9"/>
        </svg>
      );
    case 'deepseek':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#4D6BFE" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="Inter, sans-serif">DS</text>
        </svg>
      );
    case 'openrouter':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#6366f1" />
          <path d="M8 8l4 4-4 4M13 16h3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'siliconflow':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#7C3AED" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="800" fontFamily="Inter, sans-serif">SF</text>
        </svg>
      );
    case 'volcengine-ark':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#3370ff" />
          <path d="M7 16l5-10 5 10" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <line x1="9" y1="13" x2="15" y2="13" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      );
    case 'dashscope':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#ff6a00" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="800" fontFamily="Inter, sans-serif">阿里</text>
        </svg>
      );
    case 'moonshot':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#1a1a2e" />
          <path d="M14 7a5 5 0 1 0 0 10 5 5 0 0 1 0-10z" fill="#fbbf24"/>
          <circle cx="9" cy="9" r="1" fill="#fbbf24" opacity="0.6"/>
          <circle cx="7" cy="13" r="0.6" fill="#fbbf24" opacity="0.4"/>
        </svg>
      );
    case 'zhipu':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#2563eb" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="800" fontFamily="Inter, sans-serif">智谱</text>
        </svg>
      );
    case 'tencent-hunyuan':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#00a4ff" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="800" fontFamily="Inter, sans-serif">混元</text>
        </svg>
      );
    case 'gemini-compatible':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#1a73e8" />
          <path d="M12 6c-3.3 0-6 2.7-6 6s2.7 6 6 6c1.7 0 3.2-.7 4.2-1.8L12 12V6z" fill="#8ab4f8"/>
          <path d="M12 6v6l4.2 4.2A6 6 0 0 0 12 6z" fill="#fff" fillOpacity="0.7"/>
        </svg>
      );
    case 'ollama':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#333" />
          <text x="12" y="16" textAnchor="middle" fill="#fff" fontSize="9" fontWeight="700" fontFamily="Inter, sans-serif">🦙</text>
        </svg>
      );
    case 'custom-openai':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#64748b" />
          <path d="M12 7v4M12 13v4M7 12h4M13 12h4" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="12" fill="#94a3b8" />
          <circle cx="12" cy="12" r="4" fill="#fff" fillOpacity="0.8"/>
        </svg>
      );
  }
}

function getAsrIcon(profile: { kind: string; engine?: string }): ReactNode {
  if (profile.kind === 'local') {
    return <Cpu size={22} style={{ color: '#10b981' }} />;
  }
  if (profile.kind === 'cloud-streaming') {
    return <Zap size={22} style={{ color: '#f59e0b' }} />;
  }
  return <Globe size={22} style={{ color: '#3b82f6' }} />;
}

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

function getFacade() {
  return window.tailkall ?? {};
}

export default function ModelsView(props: {
  settings: SettingsState;
  testStatus: string;
  onTestRewriteApi: () => void;
  onUpdate: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
}) {
  const { settings, onUpdate } = props;
  const activeAsrProfile = settings.asrProfiles.find((profile) => profile.id === settings.activeAsrProfileId) ?? settings.asrProfiles[0];
  const isCloudAsr = activeAsrProfile?.kind === 'cloud-upload' || activeAsrProfile?.kind === 'cloud-streaming';
  const activeLlmProvider = settings.llmProviders.find((provider) => provider.key === settings.activeLlmProviderKey) ?? settings.llmProviders[0];
  const [cloudTestStatus, setCloudTestStatus] = useState('');
  const [providerTestStatus, setProviderTestStatus] = useState<Record<string, string>>({});
  const [configAsrProfileId, setConfigAsrProfileId] = useState<string | null>(null);
  const [configProviderKey, setConfigProviderKey] = useState<string | null>(null);

  const configAsrProfile = settings.asrProfiles.find((profile) => profile.id === configAsrProfileId);
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

  const selectLlmProvider = (key: string) => {
    const next = settings.llmProviders.find((provider) => provider.key === key);
    if (next) {
      onUpdate('activeLlmProviderKey', key);
      onUpdate('provider', next.displayName);
      onUpdate('baseURL', next.baseUrl);
      onUpdate('model', next.model);
      onUpdate('apiKey', next.apiKey);
    }
  };

  const testCloudAsr = async (profile?: AsrProfileConfig) => {
    setCloudTestStatus('测试中…');
    try {
      const facade = getFacade();
      const result = await facade.testRewriteApi?.({
        ...settings,
        provider: 'cloud-asr',
        baseURL: profile?.baseUrl ?? settings.cloudAsrBaseUrl,
        apiKey: profile?.apiKey ?? settings.cloudAsrApiKey,
        model: profile?.model ?? settings.cloudAsrModel
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
      <div className="scroll-content-container">

      {/* ─── ASR Panel ─── */}
      <section className="panel settings-card">
        <h2>
          <Server size={18} />
          语音识别（ASR）
        </h2>
        <div className="form-grid" style={{ alignItems: 'end', marginBottom: '16px' }}>
          <label style={{ gridColumn: isCloudAsr ? '1 / -1' : 'auto' }}>
            当前 ASR 档案
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <CustomSelect
                ariaLabel="当前 ASR 档案"
                style={{ flex: 1 }}
                onChange={(val) => selectAsrProfile(val)}
                options={settings.asrProfiles.map((profile) => ({
                  value: profile.id,
                  label: profile.displayName
                }))}
                value={settings.activeAsrProfileId}
              />
              {activeAsrProfile?.kind !== 'local' && (
                <button
                  onClick={() => void testCloudAsr(activeAsrProfile)}
                  type="button"
                  style={{
                    flex: '0 0 auto',
                    minHeight: '38px',
                    padding: '0 16px',
                    background: 'var(--accent-soft)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-control)',
                    color: 'var(--accent-strong)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '700',
                    transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgb(18 132 216 / 15%)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--accent-soft)';
                  }}
                >
                  测试
                </button>
              )}
              {activeAsrProfile?.kind !== 'local' && cloudTestStatus && (
                <span className={`test-status${cloudTestStatus.includes('成功') ? ' success' : ''}`} style={{ fontSize: '12px', fontWeight: 'bold' }}>
                  {cloudTestStatus}
                </span>
              )}
            </div>
          </label>
          {!isCloudAsr && (
            <label>
              加速策略
              <CustomSelect
                ariaLabel="加速策略"
                onChange={(val) => onUpdate('asrAcceleration', val)}
                options={[
                  { value: 'GPU 优先', label: 'GPU 优先' },
                  { value: 'CPU', label: 'CPU' }
                ]}
                value={settings.asrAcceleration}
              />
            </label>
          )}
        </div>
        <input
          type="text"
          aria-label="ASR 引擎"
          value={settings.asr}
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

        <div className="provider-card-grid asr-card-grid">
          {settings.asrProfiles.filter((profile) => profile.kind !== 'local').map((profile) => (
            <article className={profile.id === settings.activeAsrProfileId ? 'provider-card active' : 'provider-card'} key={profile.id}>
              <div className="provider-card-header">
                <div className="provider-icon-container">
                  {getAsrIcon(profile)}
                </div>
                <div>
                  <h3>{profile.displayName}</h3>
                  <span>{profile.kind === 'cloud-upload' ? '云端上传' : '云端流式'}</span>
                  <small>{profile.model ? `默认模型：${profile.model}` : '未选择模型'}</small>
                </div>
                <span aria-label={profile.id === settings.activeAsrProfileId ? '当前默认' : '未启用'} className={profile.id === settings.activeAsrProfileId ? 'provider-status active' : 'provider-status'} />
              </div>
              <button
                aria-label={`点击配置 ${profile.displayName}`}
                className="provider-config-link"
                onClick={() => setConfigAsrProfileId(profile.id)}
                type="button"
              >
                点击配置
              </button>
            </article>
          ))}
        </div>
      </section>

      {/* ─── LLM Panel ─── */}
      <section className="panel settings-card">
        <div className="panel-header">
          <h2>
            <Brain size={18} />
            文案整理（LLM）
          </h2>
          <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>
              启用文案整理
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
        </div>
        <div className="form-grid" style={{ alignItems: 'end', marginBottom: '16px' }}>
          <label style={{ gridColumn: '1 / -1' }}>
            当前大模型引擎
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <CustomSelect
                style={{ flex: 1 }}
                onChange={(val) => selectLlmProvider(val)}
                options={settings.llmProviders.map((provider) => ({
                  value: provider.key,
                  label: provider.displayName
                }))}
                value={settings.activeLlmProviderKey}
              />
              <button
                onClick={() => void testLlmProvider(activeLlmProvider)}
                type="button"
                style={{
                  flex: '0 0 auto',
                  minHeight: '38px',
                  padding: '0 16px',
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-control)',
                  color: 'var(--accent-strong)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '700',
                  transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgb(18 132 216 / 15%)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--accent-soft)';
                }}
              >
                测试
              </button>
              {providerTestStatus[activeLlmProvider.key] && (
                <span className={`test-status${providerTestStatus[activeLlmProvider.key].includes('成功') ? ' success' : ''}`} style={{ fontSize: '12px', fontWeight: 'bold' }}>
                  {providerTestStatus[activeLlmProvider.key]}
                </span>
              )}
            </div>
          </label>
        </div>

        <div className="provider-card-grid" style={{ marginBottom: '16px' }}>
          {settings.llmProviders.map((provider) => (
            <article className={provider.key === settings.activeLlmProviderKey ? 'provider-card active' : 'provider-card'} key={provider.key}>
              <div className="provider-card-header">
                <div className="provider-icon-container">
                  {getProviderIcon(provider.key)}
                </div>
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


      </section>
      </div>

      {configAsrProfile && (
        <div className="modal-backdrop" role="presentation">
          <section aria-modal="true" aria-label={`${configAsrProfile.displayName} 设置`} className="provider-modal" role="dialog">
            <div className="provider-modal-header">
              <div>
                <h2>{configAsrProfile.displayName} 设置</h2>
                <span>{configAsrProfile.kind === 'cloud-upload' ? '云端上传转写' : '云端流式转写'}</span>
              </div>
              <div className="provider-modal-actions">
                <button
                  className={configAsrProfile.id === settings.activeAsrProfileId ? 'provider-enable active' : 'provider-enable'}
                  onClick={() => selectAsrProfile(configAsrProfile.id)}
                  type="button"
                >
                  {configAsrProfile.id === settings.activeAsrProfileId ? '已启用' : '设为当前 ASR'}
                </button>
                <button aria-label="关闭配置" className="modal-close" onClick={() => setConfigAsrProfileId(null)} type="button">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="provider-modal-body">
              <label>
                {configAsrProfile.displayName} Base URL
                <input onChange={(event) => updateAsrProfile(configAsrProfile.id, 'baseUrl', event.target.value)} value={configAsrProfile.baseUrl ?? ''} />
              </label>
              <label>
                {configAsrProfile.displayName} Model
                <input onChange={(event) => updateAsrProfile(configAsrProfile.id, 'model', event.target.value)} value={configAsrProfile.model ?? ''} />
              </label>
              <label>
                {configAsrProfile.displayName} API Key
                <input onChange={(event) => updateAsrProfile(configAsrProfile.id, 'apiKey', event.target.value)} type="password" value={configAsrProfile.apiKey ?? ''} />
              </label>
              <div className="field-action">
                <button onClick={() => void testCloudAsr(configAsrProfile)} type="button">
                  <PlugZap size={16} />
                  测试连接
                </button>
                {cloudTestStatus && <span className={`test-status${cloudTestStatus.includes('成功') ? ' success' : ''}`}>{cloudTestStatus}</span>}
              </div>
            </div>
          </section>
        </div>
      )}
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
