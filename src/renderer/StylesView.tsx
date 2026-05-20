import { useState, type ReactNode } from 'react';
import {
  Sparkles,
  MessageSquareText,
  Cpu,
  Smile,
  Plus,
  Trash2,
  RotateCcw,
  Check,
  Save,
  HelpCircle,
  Sliders,
  FileSpreadsheet
} from 'lucide-react';
import { parseMultiPrompt, type StylePreset, type MultiPromptData } from './App';
import { DEFAULT_CLEANUP_PROMPT, ENGINEER_CLEANUP_PROMPT, CHARM_CLEANUP_PROMPT } from '../shared/cleanupPolicy';

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
  llmProviders: any[];
  activeLlmProviderKey: string;
  prompt: string;
  outputMode: string;
  dataDir: string;
  shortPressAction: string;
  longPressAction: string;
  smartMouseMode: boolean;
  mouseTrigger: string;
  wordbook: any[];
  cloudAsrType: string;
  cloudAsrBaseUrl: string;
  cloudAsrApiKey: string;
  cloudAsrModel: string;
  asrProfiles: any[];
  activeAsrProfileId: string;
};

export default function StylesView(props: {
  settings: SettingsState;
  onUpdate: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
}) {
  const { settings, onUpdate } = props;
  const multiPrompt = parseMultiPrompt(settings.prompt);

  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const [errorMsg, setErrorMsg] = useState('');

  // 辅助函数：将新 presets 写回 settings.prompt 序列化
  const savePresets = (presets: StylePreset[], activeId: string) => {
    const promptsMap: Record<string, string> = {};
    for (const p of presets) {
      promptsMap[p.id] = p.prompt;
    }
    const updated: MultiPromptData = {
      activeStyle: activeId,
      prompts: promptsMap,
      presets
    };
    onUpdate('prompt', JSON.stringify(updated));
  };

  const handleSelectPreset = (id: string) => {
    savePresets(multiPrompt.presets, id);
  };

  const startEdit = (preset: StylePreset) => {
    setEditingPresetId(preset.id);
    setEditName(preset.name);
    setEditPrompt(preset.prompt);
    setIsAdding(false);
    setErrorMsg('');
  };

  const cancelEdit = () => {
    setEditingPresetId(null);
    setErrorMsg('');
  };

  const handleSaveEdit = () => {
    if (!editName.trim()) {
      setErrorMsg('风格名称不能为空');
      return;
    }

    const currentPreset = multiPrompt.presets.find(p => p.id === editingPresetId);
    if (!currentPreset) return;

    // 如果修改了名称，且是自定义的，需要检查是否重复
    if (!currentPreset.isBuiltIn && editName.trim() !== currentPreset.name) {
      const exists = multiPrompt.presets.some(
        p => p.id !== editingPresetId && p.name.trim().toLowerCase() === editName.trim().toLowerCase()
      );
      if (exists) {
        setErrorMsg('风格名称已存在，请换一个名字');
        return;
      }
    }

    const updatedPresets = multiPrompt.presets.map(p => {
      if (p.id === editingPresetId) {
        return {
          ...p,
          name: p.isBuiltIn ? p.name : editName.trim(),
          prompt: editPrompt.trim()
        };
      }
      return p;
    });

    savePresets(updatedPresets, multiPrompt.activeStyle);
    setEditingPresetId(null);
    setErrorMsg('');
  };

  const handleResetPreset = (id: string) => {
    const preset = multiPrompt.presets.find(p => p.id === id);
    if (!preset) return;
    if (!window.confirm(`确定要将“${preset.name}”恢复为官方出厂预设吗？当前修改将被覆盖。`)) {
      return;
    }

    let originalPrompt = '';
    if (id === 'default') originalPrompt = DEFAULT_CLEANUP_PROMPT;
    else if (id === 'engineer') originalPrompt = ENGINEER_CLEANUP_PROMPT;
    else if (id === 'charm') originalPrompt = CHARM_CLEANUP_PROMPT;
    else return;

    const updatedPresets = multiPrompt.presets.map(p => {
      if (p.id === id) {
        return { ...p, prompt: originalPrompt };
      }
      return p;
    });

    savePresets(updatedPresets, multiPrompt.activeStyle);

    // 如果当前正在编辑被重置的内置预设，同步更新编辑器内容
    if (editingPresetId === id) {
      setEditPrompt(originalPrompt);
    }
  };

  const handleDeletePreset = (id: string) => {
    const updatedPresets = multiPrompt.presets.filter(p => p.id !== id);
    // 如果删除的是当前选中的风格，重置为 'default'
    let nextActive = multiPrompt.activeStyle;
    if (multiPrompt.activeStyle === id) {
      nextActive = 'default';
    }
    savePresets(updatedPresets, nextActive);

    if (editingPresetId === id) {
      setEditingPresetId(null);
    }
  };

  const startAdd = () => {
    setIsAdding(true);
    setNewName('');
    setNewPrompt('');
    setEditingPresetId(null);
    setErrorMsg('');
  };

  const cancelAdd = () => {
    setIsAdding(false);
    setErrorMsg('');
  };

  const handleSaveAdd = () => {
    if (!newName.trim()) {
      setErrorMsg('风格名称不能为空');
      return;
    }
    if (!newPrompt.trim()) {
      setErrorMsg('提示词内容不能为空');
      return;
    }

    const exists = multiPrompt.presets.some(
      p => p.name.trim().toLowerCase() === newName.trim().toLowerCase()
    );
    if (exists) {
      setErrorMsg('该风格名称已存在，请使用其他名称');
      return;
    }

    const newId = `custom-${Date.now()}`;
    const newPreset: StylePreset = {
      id: newId,
      name: newName.trim(),
      prompt: newPrompt.trim(),
      isBuiltIn: false
    };

    const updatedPresets = [...multiPrompt.presets, newPreset];
    // 新增后默认将其设为当前生效风格
    savePresets(updatedPresets, newId);
    setIsAdding(false);
    setErrorMsg('');
  };

  const getPresetIcon = (id: string) => {
    if (id === 'default') return <MessageSquareText size={18} />;
    if (id === 'engineer') return <Cpu size={18} />;
    if (id === 'charm') return <Smile size={18} />;
    return <Sparkles size={18} />;
  };

  return (
    <div className="view-stack styles-view-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>AI 整理风格</h1>
        {!isAdding && (
          <button className="add-preset-btn" onClick={startAdd} type="button">
            <Plus size={16} />
            新增风格
          </button>
        )}
      </div>

      <div className="scroll-content-container">
        {/* 新增或编辑风格的侧边表单/抽屉样式容器 */}
        {(isAdding || editingPresetId) && (
          <section className="panel preset-editor-panel wide" aria-label={isAdding ? '新增风格' : '编辑风格'}>
            <div className="editor-panel-header">
              <h2>
                <Sliders size={18} />
                {isAdding ? '新增 AI 整理风格' : `编辑风格：${editName}`}
              </h2>
              <span className="preset-editor-tips">* 通过定制合理的整理规则控制大模型转换口癖及行文语气</span>
            </div>

            <div className="editor-panel-body">
              {errorMsg && <div className="editor-error-alert">{errorMsg}</div>}
              
              <div className="form-grid">
                <label className="wide">
                  风格名称
                  <input
                    placeholder="输入风格名称，例如：会议纪要提炼、微信回复助手"
                    onChange={(e) => isAdding ? setNewName(e.target.value) : setEditName(e.target.value)}
                    value={isAdding ? newName : editName}
                    disabled={editingPresetId ? multiPrompt.presets.find(p => p.id === editingPresetId)?.isBuiltIn : false}
                    maxLength={24}
                  />
                  {editingPresetId && multiPrompt.presets.find(p => p.id === editingPresetId)?.isBuiltIn && (
                    <small style={{ color: 'var(--text-muted)', marginTop: '2px', fontWeight: 'normal' }}>
                      内置系统风格不支持修改名称
                    </small>
                  )}
                </label>

                <label className="wide">
                  大模型提示词 (Prompt) 模板
                  <textarea
                    placeholder="请输入你的自定义整理提示词，例如：请把我说的杂乱无章的语音，提取并提炼成简明扼要的三句话要点..."
                    onChange={(e) => isAdding ? setNewPrompt(e.target.value) : setEditPrompt(e.target.value)}
                    value={isAdding ? newPrompt : editPrompt}
                    style={{ minHeight: '140px' }}
                  />
                </label>
              </div>

              <div className="editor-panel-actions">
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="save-preset-confirm-btn"
                    onClick={isAdding ? handleSaveAdd : handleSaveEdit}
                    type="button"
                  >
                    <Save size={14} />
                    保存配置
                  </button>
                  <button
                    className="cancel-preset-btn"
                    onClick={isAdding ? cancelAdd : cancelEdit}
                    type="button"
                  >
                    取消
                  </button>
                </div>
                {editingPresetId && multiPrompt.presets.find(p => p.id === editingPresetId)?.isBuiltIn && (
                  <button
                    className="reset-preset-btn"
                    onClick={() => handleResetPreset(editingPresetId)}
                    type="button"
                    title="重置提示词为官方出厂预设"
                  >
                    <RotateCcw size={13} />
                    恢复官方默认
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 风格预设卡片网格列表 */}
        <div className="presets-grid">
          {multiPrompt.presets.map((preset) => {
            const isActive = multiPrompt.activeStyle === preset.id;
            const isEditing = editingPresetId === preset.id;

            return (
              <article
                className={`preset-card ${preset.id} ${isActive ? 'active' : ''} ${isEditing ? 'editing' : ''}`}
                key={preset.id}
              >
                <div className="preset-card-glow" />
                <div className="preset-card-header">
                  <div className="preset-card-icon-container">
                    {getPresetIcon(preset.id)}
                  </div>
                  <div className="preset-card-title-group">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <h3>{preset.name}</h3>
                      <span className={`preset-badge ${preset.isBuiltIn ? 'builtin' : 'custom'}`}>
                        {preset.isBuiltIn ? '内置' : '自定义'}
                      </span>
                    </div>
                    {isActive ? (
                      <span className="active-badge-status">
                        <Check size={10} />
                        生效中
                      </span>
                    ) : (
                      <button
                        className="set-active-trigger-btn"
                        onClick={() => handleSelectPreset(preset.id)}
                        type="button"
                        title="点击把该整理风格应用为当前默认"
                      >
                        设为生效
                      </button>
                    )}
                  </div>
                </div>

                <div className="preset-card-body">
                  <p className="preset-prompt-preview">{preset.prompt}</p>
                </div>

                <div className="preset-card-footer">
                  <button
                    className="preset-card-action-btn edit-btn"
                    onClick={() => startEdit(preset)}
                    type="button"
                  >
                    编辑参数
                  </button>
                  
                  {!preset.isBuiltIn && (
                    <button
                      className="preset-card-action-btn delete-btn"
                      onClick={() => handleDeletePreset(preset.id)}
                      type="button"
                      title="删除此自定义风格"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}

                  {preset.isBuiltIn && (
                    <button
                      className="preset-card-action-btn reset-btn"
                      onClick={() => handleResetPreset(preset.id)}
                      type="button"
                      title="重置为系统出厂配置"
                    >
                      <RotateCcw size={13} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <section className="panel style-help-panel" aria-label="帮助与使用贴士">
          <div className="help-header">
            <HelpCircle size={16} />
            <span>风格预设是如何工作的？</span>
          </div>
          <p>
            当您长按录音或触发语音整理时，软件会利用大模型（LLM）对 ASR 语音识别文本进行二次润色。
            这里每一种风格都代表了一个精心打磨的 <strong>System Prompt</strong>。您可以通过自定义增加新的整理风格，大模型在润色文案时会完全遵循您自己所写的提示词逻辑！
          </p>
        </section>
      </div>
    </div>
  );
}
