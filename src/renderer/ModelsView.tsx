import { useState, type ReactNode } from 'react';
import { Brain, Server, PlugZap, X, Sparkles, MessageSquareText, Cpu, Smile } from 'lucide-react';
import { parseMultiPrompt } from './App';

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
  const activeLlmProvider = settings.llmProviders.find((provider) => provider.key === settings.activeLlmProviderKey) ?? settings.llmProviders[0];
  const [cloudTestStatus, setCloudTestStatus] = useState('');
  const [providerTestStatus, setProviderTestStatus] = useState<Record<string, string>>({});
  const [configAsrProfileId, setConfigAsrProfileId] = useState<string | null>(null);
  const [configProviderKey, setConfigProviderKey] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [editingStyle, setEditingStyle] = useState<'default' | 'engineer' | 'charm'>('default');
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

  const multiPrompt = parseMultiPrompt(settings.prompt);

  const handlePromptChange = (newVal: string) => {
    const updatedPrompts = {
      ...multiPrompt.prompts,
      [editingStyle]: newVal
    };
    const updated = {
      ...multiPrompt,
      prompts: updatedPrompts
    };
    onUpdate('prompt', JSON.stringify(updated));
  };

  const handleActiveStyleChange = (style: 'default' | 'engineer' | 'charm') => {
    const updated = {
      ...multiPrompt,
      activeStyle: style
    };
    onUpdate('prompt', JSON.stringify(updated));
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
              <select
                style={{ flex: 1 }}
                onChange={(event) => selectAsrProfile(event.target.value)}
                value={settings.activeAsrProfileId}
              >
                {settings.asrProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.displayName}</option>
                ))}
              </select>
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
              <select onChange={(event) => onUpdate('asrAcceleration', event.target.value)} value={settings.asrAcceleration}>
                <option>GPU 优先</option>
                <option>CPU</option>
              </select>
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
        <h2>
          <Brain size={18} />
          文案整理（LLM）
        </h2>
        <div className="form-grid" style={{ alignItems: 'end', marginBottom: '16px' }}>
          <label style={{ gridColumn: '1 / -1' }}>
            当前大模型引擎
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                style={{ flex: 1 }}
                onChange={(event) => selectLlmProvider(event.target.value)}
                value={settings.activeLlmProviderKey}
              >
                {settings.llmProviders.map((provider) => (
                  <option key={provider.key} value={provider.key}>{provider.displayName}</option>
                ))}
              </select>
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
        <label className="setting-row smart-mouse-row" style={{ marginBottom: '16px' }}>
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

        <div className="provider-card-grid" style={{ marginBottom: '16px' }}>
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

        <div className="prompt-editor-card">
          <div className="prompt-editor-header">
            <div className="prompt-editor-tabs">
              <button
                className={`prompt-tab ${editingStyle === 'default' ? 'active' : ''}`}
                onClick={() => setEditingStyle('default')}
                type="button"
              >
                <MessageSquareText size={14} />
                默认整理
                {multiPrompt.activeStyle === 'default' ? (
                  <span className="prompt-tab-badge" title="当前生效风格">生效中</span>
                ) : (
                  <span
                    className="prompt-tab-badge-inactive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleActiveStyleChange('default');
                    }}
                    title="点击设为生效风格"
                  >
                    设为生效
                  </span>
                )}
              </button>
              <button
                className={`prompt-tab ${editingStyle === 'engineer' ? 'active' : ''}`}
                onClick={() => setEditingStyle('engineer')}
                type="button"
              >
                <Cpu size={14} />
                理智工科
                {multiPrompt.activeStyle === 'engineer' ? (
                  <span className="prompt-tab-badge" title="当前生效风格">生效中</span>
                ) : (
                  <span
                    className="prompt-tab-badge-inactive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleActiveStyleChange('engineer');
                    }}
                    title="点击设为生效风格"
                  >
                    设为生效
                  </span>
                )}
              </button>
              <button
                className={`prompt-tab ${editingStyle === 'charm' ? 'active' : ''}`}
                onClick={() => setEditingStyle('charm')}
                type="button"
              >
                <Smile size={14} />
                高情商夸夸
                {multiPrompt.activeStyle === 'charm' ? (
                  <span className="prompt-tab-badge" title="当前生效风格">生效中</span>
                ) : (
                  <span
                    className="prompt-tab-badge-inactive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleActiveStyleChange('charm');
                    }}
                    title="点击设为生效风格"
                  >
                    设为生效
                  </span>
                )}
              </button>
            </div>
          </div>
          
          <div className="prompt-editor-body">
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>
              编辑 {editingStyle === 'default' ? '默认整理' : editingStyle === 'engineer' ? '理智工科' : '高情商夸夸'} 的 Prompt 模板
              <textarea
                onChange={(event) => handlePromptChange(event.target.value)}
                value={multiPrompt.prompts[editingStyle]}
                placeholder="请输入 Prompt 模板内容..."
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </label>
            <div className="prompt-editor-actions">
              <span>* 此处的修改将实时保存，并在大模型整理中生效。</span>
              <span>当前生效风格：<strong>{multiPrompt.activeStyle === 'default' ? '默认整理' : multiPrompt.activeStyle === 'engineer' ? '理智工科' : '高情商夸夸'}</strong></span>
            </div>
          </div>
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
