import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/renderer/App';
import { DEFAULT_CLEANUP_PROMPT } from '../src/shared/cleanupPolicy';

function demoDashboardSettings() {
  return {
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
    llmProviders: [],
    activeLlmProviderKey: 'deepseek',
    prompt: DEFAULT_CLEANUP_PROMPT,
    outputMode: '粘贴到当前光标',
    dataDir: 'D:\\Antigravity\\tailkall\\data',
    shortPressAction: '语音输入',
    longPressAction: '语音助手',
    smartMouseMode: true,
    mouseTrigger: 'Mouse Middle',
    microphoneDeviceId: '',
    wordbook: [],
    cloudAsrType: 'openai-whisper',
    cloudAsrBaseUrl: '',
    cloudAsrApiKey: '',
    cloudAsrModel: 'whisper-1',
    asrProfiles: [],
    activeAsrProfileId: 'local-whisper-cpp'
  };
}

describe('TailKall main renderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
    delete window.tailkall;
  });

  it('renders the dashboard with trigger, ASR, rewrite API, and recent records', async () => {
    render(<App />);

    expect(screen.queryByRole('banner', { name: 'TailKall 窗口栏' })).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: '窗口控制' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化或还原' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '主页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '主页' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.queryByLabelText('切换主题')).not.toBeInTheDocument();
    expect(screen.getByText('触发键')).toBeInTheDocument();
    expect(screen.getByText('Ctrl + Alt + Space')).toBeInTheDocument();
    expect(screen.getByText('语音模型')).toBeInTheDocument();
    expect(screen.getByText('whisper.cpp')).toBeInTheDocument();
    expect(screen.getByText('整理模型')).toBeInTheDocument();
    expect(screen.getByText('GPT-4.1')).toBeInTheDocument();

    expect(screen.getByText('时长')).toBeInTheDocument();
    expect(screen.getByText('8秒')).toBeInTheDocument();
    expect(screen.getByText('字数')).toBeInTheDocument();
    expect(screen.getByText('77 字')).toBeInTheDocument();
    expect(screen.getByText('语速')).toBeInTheDocument();
    expect(screen.getByText('563 字/分钟')).toBeInTheDocument();

    const recent = screen.getByRole('region', { name: '最近记录' });
    expect(within(recent).getByText('2026/05/19 09:18')).toBeInTheDocument();
    expect(within(recent).getByText('会议结论：优化登录体验与首屏性能，排查快捷键冲突。负责人分别跟进，下次例会同步结果。')).toBeInTheDocument();
  });

  it('renders a compact dashboard summary with shortened ASR and model labels', async () => {
    window.tailkall = {
      getDashboard: async () => ({
        settings: {
          ...demoDashboardSettings(),
          asr: 'SenseVoice / FunASR',
          provider: '火山方舟',
          model: 'deepseek-v3-2-251201'
        },
        records: [
          {
            id: 'rec-compact',
            time: '2026/05/21 09:18',
            original: '这是一段需要统计字数的测试文本',
            refined: '这是一段需要统计字数的测试文本',
            status: '已输入',
            durationMs: 9200
          }
        ]
      })
    };

    render(<App />);

    const overview = await screen.findByRole('region', { name: '主页概览' });
    expect(within(overview).getByText('SenseVoice')).toBeInTheDocument();
    expect(within(overview).getByText('DeepSeek V3')).toBeInTheDocument();
    expect(within(overview).queryByText(/火山方舟/)).not.toBeInTheDocument();
    expect(within(overview).queryByText(/251201/)).not.toBeInTheDocument();
    expect(within(overview).getByText('9秒')).toBeInTheDocument();
    expect(within(overview).getByText('15 字')).toBeInTheDocument();
    expect(within(overview).getByText('98 字/分钟')).toBeInTheDocument();
    expect(within(overview).getAllByText('默认整理').length).toBeGreaterThan(0);
  });

  it('switches to settings and shows shortcut and behavior config', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByLabelText('键盘快捷键')).toHaveValue('Ctrl + Alt + Space');
    expect(screen.getByRole('button', { name: '鼠标快捷键' })).toHaveTextContent('鼠标中键');
    expect(screen.getByLabelText('短按动作')).toHaveValue('语音输入');
    expect(screen.getByLabelText('长按动作')).toHaveValue('语音助手');
    expect(screen.getByRole('button', { name: '输出模式' })).toHaveTextContent('粘贴到当前光标');
    expect(screen.getByLabelText('数据目录')).toHaveValue('D:\\Antigravity\\tailkall\\data');
    expect(screen.getByRole('radiogroup', { name: '界面风格' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '浅色' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('captures mouse trigger buttons instead of showing a fixed dropdown', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    window.tailkall = { saveSettings };

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    const mouseCapture = screen.getByRole('button', { name: '鼠标快捷键' });
    fireEvent.click(mouseCapture);
    expect(mouseCapture).toHaveTextContent('请按下鼠标按键');
    expect(screen.queryByRole('button', { name: '鼠标侧键 1' })).not.toBeInTheDocument();

    fireEvent.mouseDown(window, { button: 3 });

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ mouseTrigger: 'Mouse Side 1' }));
    });
    expect(screen.getByLabelText('鼠标快捷键值')).toHaveValue('Mouse Side 1');
  });

  it('lists microphones in settings and saves the selected device', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'audioinput', deviceId: 'mic-1', label: '笔记本麦克风' },
          { kind: 'audioinput', deviceId: 'mic-2', label: 'USB 麦克风' },
          { kind: 'videoinput', deviceId: 'camera-1', label: 'Camera' }
        ])
      }
    });
    window.tailkall = { saveSettings };

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    const microphoneSelect = await screen.findByRole('button', { name: '麦克风' });
    expect(microphoneSelect).toHaveTextContent('系统默认麦克风');

    fireEvent.click(microphoneSelect);
    expect(screen.getByRole('button', { name: '笔记本麦克风' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'USB 麦克风' }));

    await waitFor(() => {
      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ microphoneDeviceId: 'mic-2' }));
    });
  });

  it('records with the selected microphone device id', async () => {
    let startRecording: (() => void) | undefined;
    let stopRecording: (() => void) | undefined;
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }]
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'audioinput', deviceId: 'mic-2', label: 'USB 麦克风' }
        ]),
        getUserMedia
      }
    });
    class FakeMediaRecorder {
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(public stream: unknown) {}
      start() {
        this.ondataavailable?.({ data: new Blob(['audio']) });
      }
      stop() {
        this.onstop?.();
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const getDashboard = vi.fn().mockResolvedValue({
      settings: {
        ...demoDashboardSettings(),
        microphoneDeviceId: 'mic-2'
      },
      records: []
    });
    window.tailkall = {
      getDashboard,
      onRecordingStart: (callback) => {
        startRecording = callback;
        return () => undefined;
      },
      onRecordingStop: (callback) => {
        stopRecording = callback;
        return () => undefined;
      },
      submitRecording: vi.fn().mockResolvedValue({ ok: true })
    };

    render(<App />);
    await waitFor(() => expect(startRecording).toBeDefined());
    await waitFor(() => expect(getDashboard).toHaveBeenCalled());

    startRecording?.();
    await waitFor(() => {
      expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-2' } } });
    });
    stopRecording?.();
  });

  it('switches to models and shows ASR and LLM configuration', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '模型' }));

    expect(screen.getByRole('heading', { name: '模型' })).toBeInTheDocument();
    const asrProfileSelect = screen.getByRole('button', { name: '当前 ASR 档案' });
    expect(asrProfileSelect).toHaveTextContent('本地 whisper.cpp');
    fireEvent.click(asrProfileSelect);
    expect(screen.getAllByText('本地 SenseVoice / FunASR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('云端上传转写 API').length).toBeGreaterThan(0);
    expect(screen.getAllByText('云端流式转写 API').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('ASR 引擎')).toHaveValue('whisper.cpp');
    expect(screen.getByRole('button', { name: '加速策略' })).toHaveTextContent('GPU 优先');
    expect(screen.queryByLabelText('云端上传转写 API Base URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('云端上传转写 API Model')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('云端上传转写 API API Key')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('本地模型目录')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('whisper.cpp 程序')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('whisper 模型文件')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ffmpeg 程序')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Python 运行时')).not.toBeInTheDocument();
    expect(screen.getByLabelText('启用文案整理')).not.toBeChecked();
    expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DeepSeek').length).toBeGreaterThan(0);
    expect(screen.getAllByText('硅基流动').length).toBeGreaterThan(0);
    expect(screen.getByText('默认模型：deepseek-chat')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /点击配置/ }).length).toBeGreaterThan(1);
    expect(screen.queryByLabelText('OpenAI Base URL')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('OpenAI Model')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('OpenAI API Key')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /点击配置 OpenAI/ })[0]);

    const dialog = screen.getByRole('dialog', { name: 'OpenAI 设置' });
    expect(within(dialog).getByLabelText('OpenAI Base URL')).toHaveValue('https://api.openai.com/v1');
    expect(within(dialog).getByLabelText('OpenAI Model')).toHaveValue('gpt-4.1-mini');
    expect(within(dialog).getByLabelText('OpenAI API Key')).toHaveAttribute('type', 'password');
    expect(within(dialog).getByRole('button', { name: '设为默认模型' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /测试连接/ })).toBeInTheDocument();
  });

  it('keeps ASR provider card details inside a modal', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '模型' }));
    fireEvent.click(screen.getByRole('button', { name: /点击配置 云端上传转写 API/ }));

    const dialog = screen.getByRole('dialog', { name: '云端上传转写 API 设置' });
    expect(within(dialog).getByLabelText('云端上传转写 API Base URL')).toHaveValue('https://api.openai.com');
    expect(within(dialog).getByLabelText('云端上传转写 API Model')).toHaveValue('whisper-1');
    expect(within(dialog).getByLabelText('云端上传转写 API API Key')).toHaveAttribute('type', 'password');
    expect(within(dialog).getByRole('button', { name: /测试连接/ })).toBeInTheDocument();
  });

  it('shows records with refined text and actions on the dashboard', () => {
    render(<App />);

    expect(screen.getByText('会议结论：优化登录体验与首屏性能，排查快捷键冲突。负责人分别跟进，下次例会同步结果。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '复制整理文本' })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '复制原始文本' })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '删除' })[0]).toBeInTheDocument();
  });

  it('submits correction text, shows wordbook candidates, and saves selected pairs', async () => {
    const saveCorrection = vi.fn().mockResolvedValue(undefined);
    const extractWordPairs = vi.fn().mockResolvedValue({
      ok: true,
      pairs: [{ from: '报款逻辑', to: '爆款逻辑' }]
    });
    const saveWordbook = vi.fn().mockResolvedValue({ ok: true });
    window.tailkall = { saveCorrection, extractWordPairs, saveWordbook };

    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: '纠错' })[0]);
    fireEvent.change(screen.getByLabelText('修正文本'), {
      target: { value: '会议结论：优化爆款逻辑与首屏性能' }
    });
    fireEvent.click(screen.getByRole('button', { name: '提交并检测词库' }));

    expect(await screen.findByText('检测到拼写纠正，是否一键加入自定义词库？')).toBeInTheDocument();
    expect(screen.getByText('报款逻辑')).toBeInTheDocument();
    expect(screen.getByText('爆款逻辑')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认加入' }));

    expect(saveCorrection).toHaveBeenCalledWith('rec-1', '会议结论：优化爆款逻辑与首屏性能');
    expect(extractWordPairs).toHaveBeenCalledWith('rec-1');
    expect(saveWordbook).toHaveBeenCalledWith([
      expect.objectContaining({
        target: '爆款逻辑',
        variants: ['报款逻辑']
      })
    ]);
  });

  it('switches to styles and allows preset activation and customization', () => {
    render(<App />);

    const stylesBtn = screen.getByRole('button', { name: '风格' });
    expect(stylesBtn).toBeInTheDocument();
    fireEvent.click(stylesBtn);

    expect(screen.getByRole('heading', { name: 'AI 整理风格' })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: '默认整理' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '理智工科' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '高情商夸夸' })).toBeInTheDocument();

    expect(screen.getByText('生效中')).toBeInTheDocument();

    const setButtons = screen.getAllByRole('button', { name: '设为生效' });
    expect(setButtons.length).toBeGreaterThan(0);
  });

  it('allows adding, editing and deleting a custom style preset', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '风格' }));

    const addBtn = screen.getByRole('button', { name: '新增风格' });
    fireEvent.click(addBtn);

    expect(screen.getByRole('region', { name: '新增风格' })).toBeInTheDocument();

    const nameInput = screen.getByPlaceholderText('输入风格名称，例如：会议纪要提炼、微信回复助手');
    const promptInput = screen.getByPlaceholderText('请输入你的自定义整理提示词，例如：请把我说的杂乱无章的语音，提取并提炼成简明扼要的三句话要点...');

    fireEvent.change(nameInput, { target: { value: '我的自定义风格' } });
    fireEvent.change(promptInput, { target: { value: '这是自定义Prompt' } });

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(screen.queryByRole('region', { name: '新增风格' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '我的自定义风格' })).toBeInTheDocument();

    const editBtn = screen.getAllByRole('button', { name: '编辑参数' });
    fireEvent.click(editBtn[3]);

    expect(screen.getByRole('region', { name: '编辑风格' })).toBeInTheDocument();
    const editNameInput = screen.getByPlaceholderText('输入风格名称，例如：会议纪要提炼、微信回复助手');
    expect(editNameInput).toHaveValue('我的自定义风格');

    fireEvent.change(editNameInput, { target: { value: '我的修改风格' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(screen.getByRole('heading', { name: '我的修改风格' })).toBeInTheDocument();

    const deleteBtn = screen.getByTitle('删除此自定义风格');
    fireEvent.click(deleteBtn);

    expect(screen.queryByRole('heading', { name: '我的修改风格' })).not.toBeInTheDocument();
  });

  it('asks for confirmation before resetting a built-in style preset', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '风格' }));
    fireEvent.click(screen.getAllByRole('button', { name: '编辑参数' })[0]);
    fireEvent.change(screen.getByLabelText('大模型提示词 (Prompt) 模板'), {
      target: { value: '用户改过的默认提示词' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(screen.getByText('用户改过的默认提示词')).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle('重置为系统出厂配置')[0]);

    expect(confirmSpy).toHaveBeenCalledWith('确定要将“默认整理”恢复为官方出厂预设吗？当前修改将被覆盖。');
    expect(screen.getByText('用户改过的默认提示词')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getAllByTitle('重置为系统出厂配置')[0]);

    expect(screen.queryByText('用户改过的默认提示词')).not.toBeInTheDocument();
    expect(screen.getAllByText(/你是一个中文语音输入整理器/).length).toBeGreaterThan(0);
  });

  it('limits preset display to 5 on dashboard and shows the rest in a dropdown menu', () => {
    // 构造一个包含 6 个预设的 settings.prompt 序列化值
    const customPromptData = {
      activeStyle: 'default',
      presets: [
        { id: 'default', name: '默认整理', prompt: 'Prompt 1', isBuiltIn: true },
        { id: 'engineer', name: '理智工科', prompt: 'Prompt 2', isBuiltIn: true },
        { id: 'charm', name: '高情商夸夸', prompt: 'Prompt 3', isBuiltIn: true },
        { id: 'style4', name: '风格4', prompt: 'Prompt 4', isBuiltIn: false },
        { id: 'style5', name: '风格5', prompt: 'Prompt 5', isBuiltIn: false },
        { id: 'style6', name: '风格6', prompt: 'Prompt 6', isBuiltIn: false }
      ]
    };
    
    // 我们可以在渲染 App 前覆盖 localStorage 模拟 settings 状态，
    // 不过我们也可以直接模拟 settings 的加载或交互。
    // 在这里，我们可以通过在“风格”页面中新增 3 个自定义风格来让预设总数达到 6 个！
    render(<App />);

    // 先进风格页面
    fireEvent.click(screen.getByRole('button', { name: '风格' }));

    // 添加第 1 个自定义预设（总数达 4 个）
    fireEvent.click(screen.getByRole('button', { name: '新增风格' }));
    fireEvent.change(screen.getByPlaceholderText('输入风格名称，例如：会议纪要提炼、微信回复助手'), { target: { value: '风格4' } });
    fireEvent.change(screen.getByPlaceholderText('请输入你的自定义整理提示词，例如：请把我说的杂乱无章的语音，提取并提炼成简明扼要的三句话要点...'), { target: { value: 'Prompt 4' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    // 添加第 2 个自定义预设（总数达 5 个）
    fireEvent.click(screen.getByRole('button', { name: '新增风格' }));
    fireEvent.change(screen.getByPlaceholderText('输入风格名称，例如：会议纪要提炼、微信回复助手'), { target: { value: '风格5' } });
    fireEvent.change(screen.getByPlaceholderText('请输入你的自定义整理提示词，例如：请把我说的杂乱无章的语音，提取并提炼成简明扼要的三句话要点...'), { target: { value: 'Prompt 5' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    // 添加第 3 个自定义预设（总数达 6 个）
    fireEvent.click(screen.getByRole('button', { name: '新增风格' }));
    fireEvent.change(screen.getByPlaceholderText('输入风格名称，例如：会议纪要提炼、微信回复助手'), { target: { value: '风格6' } });
    fireEvent.change(screen.getByPlaceholderText('请输入你的自定义整理提示词，例如：请把我说的杂乱无章的语音，提取并提炼成简明扼要的三句话要点...'), { target: { value: 'Prompt 6' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    // 回到主页
    fireEvent.click(screen.getByRole('button', { name: '主页' }));

    // 检查主排显示的风格只有 5 个（即 默认整理、理智工科、高情商夸夸、风格4、风格6。因为风格6是新加的且被自动设为激活，故必在主排）
    expect(screen.getByRole('button', { name: '默认整理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '理智工科' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '高情商夸夸' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '风格4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '风格6' })).toBeInTheDocument();

    // 风格5 没有被激活且超出 5 个，因此它不应该在主排显示
    expect(screen.queryByRole('button', { name: '风格5' })).not.toBeInTheDocument();

    // 应该显示“更多风格”按钮
    const moreBtn = screen.getByRole('button', { name: '更多整理风格' });
    expect(moreBtn).toBeInTheDocument();

    // 点击“更多风格”按钮弹出下拉菜单
    fireEvent.click(moreBtn);

    // 下拉菜单中应该能找到被挤出的“风格5”
    expect(screen.getByRole('button', { name: '风格5' })).toBeInTheDocument();

    // 点击“风格5”使其生效
    fireEvent.click(screen.getByRole('button', { name: '风格5' }));

    // 此时“风格5”成为生效风格，根据重新排列逻辑，主排应该包含“风格5”（因为它被激活了），而“风格6”会被挤到下拉菜单中！
    expect(screen.getByRole('button', { name: '风格5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '风格6' })).not.toBeInTheDocument();

    // 点击“更多风格”按钮
    fireEvent.click(screen.getByRole('button', { name: '更多整理风格' }));
    // 下拉菜单中现在应该可以找到“风格6”
    expect(screen.getByRole('button', { name: '风格6' })).toBeInTheDocument();
  });

  it('renders diagnostic logs at the bottom of settings for failed records', async () => {
    // Mock the window.tailkall object with a failed transcription record
    window.tailkall = {
      getDashboard: async () => ({
        settings: {
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
          llmProviders: [],
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
          asrProfiles: [],
          activeAsrProfileId: 'local-whisper-cpp'
        },
        records: [
          {
            id: 'rec-failed-1',
            time: '2026/05/20 22:45',
            original: '',
            refined: '',
            status: '失败',
            error: 'Cleanup provider DeepSeek failed with HTTP 402: insufficient balance'
          },
          {
            id: 'rec-failed-2',
            time: '2026/05/20 22:46',
            original: '',
            refined: '',
            status: '失败',
            error: 'Cleanup provider DeepSeek failed with HTTP 402: insufficient balance'
          }
        ]
      })
    };

    render(<App />);

    // Wait for the mock dashboard record to load and render
    const failedStatuses = await screen.findAllByText('失败');
    expect(failedStatuses).toHaveLength(2);

    expect(screen.getByText('时长')).toBeInTheDocument();
    expect(screen.getByText('0秒')).toBeInTheDocument();
    expect(screen.getByText('字数')).toBeInTheDocument();
    expect(screen.getByText('0 字')).toBeInTheDocument();
    expect(screen.getByText('语速')).toBeInTheDocument();
    expect(screen.getByText('0 字/分钟')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: '显示诊断日志' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cleanup provider DeepSeek failed with HTTP 402: insufficient balance')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    const logRegion = screen.getByRole('region', { name: '诊断日志' });
    expect(within(logRegion).getAllByText('大模型 / 接口错误')).toHaveLength(2);
    expect(within(logRegion).getByText('2026/05/20 22:45')).toBeInTheDocument();
    expect(within(logRegion).getByText('2026/05/20 22:46')).toBeInTheDocument();
    expect(within(logRegion).getAllByText('Cleanup provider DeepSeek failed with HTTP 402: insufficient balance')).toHaveLength(2);

    // Clean up to prevent impacting other tests
    delete (window as any).tailkall;
  });

  it('clears diagnostic logs without clearing recent records', async () => {
    const clearDiagnosticLogs = vi.fn().mockResolvedValue({
      ok: true,
      records: [
        {
          id: 'rec-failed-1',
          time: '2026/05/20 22:45',
          original: '',
          refined: '',
          status: '失败'
        }
      ]
    });

    window.tailkall = {
      clearDiagnosticLogs,
      getDashboard: async () => ({
        settings: {
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
          llmProviders: [],
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
          asrProfiles: [],
          activeAsrProfileId: 'local-whisper-cpp'
        },
        records: [
          {
            id: 'rec-failed-1',
            time: '2026/05/20 22:45',
            original: '',
            refined: '',
            status: '失败',
            error: 'Cleanup provider DeepSeek failed with HTTP 402: insufficient balance'
          }
        ]
      })
    };

    render(<App />);
    expect(await screen.findByText('失败')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByText('Cleanup provider DeepSeek failed with HTTP 402: insufficient balance')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空诊断日志' }));

    expect(clearDiagnosticLogs).toHaveBeenCalledOnce();
    expect(await screen.findByText('暂无诊断日志')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '主页' }));
    expect(screen.getByText('失败')).toBeInTheDocument();
  });
});
