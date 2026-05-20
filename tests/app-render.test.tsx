import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/renderer/App';
import { DEFAULT_CLEANUP_PROMPT } from '../src/shared/cleanupPolicy';

describe('TailKall main renderer', () => {
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
    expect(screen.getByText('当前触发键')).toBeInTheDocument();
    expect(screen.getByText('Ctrl + Alt + Space')).toBeInTheDocument();
    expect(screen.getByText('ASR')).toBeInTheDocument();
    expect(screen.getByText('whisper.cpp')).toBeInTheDocument();
    expect(screen.getByText('文案整理 API')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Compatible / gpt-4.1-mini')).toBeInTheDocument();

    const recent = screen.getByRole('region', { name: '最近记录' });
    expect(within(recent).getByText('2026/05/19 09:18')).toBeInTheDocument();
    expect(within(recent).getByText('会议结论：优化登录体验与首屏性能，排查快捷键冲突。负责人分别跟进，下次例会同步结果。')).toBeInTheDocument();
  });

  it('switches to settings and shows shortcut and behavior config', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByLabelText('键盘快捷键')).toHaveValue('Ctrl + Alt + Space');
    expect(screen.getByLabelText('鼠标快捷键')).toHaveValue('Mouse Middle');
    expect(screen.getByLabelText('短按动作')).toHaveValue('语音输入');
    expect(screen.getByLabelText('长按动作')).toHaveValue('语音助手');
    expect(screen.getByLabelText('输出模式')).toHaveValue('粘贴到当前光标');
    expect(screen.getByLabelText('数据目录')).toHaveValue('D:\\Antigravity\\tailkall\\data');
    expect(screen.getByRole('radiogroup', { name: '界面风格' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '浅色' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('switches to models and shows ASR and LLM configuration', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '模型' }));

    expect(screen.getByRole('heading', { name: '模型' })).toBeInTheDocument();
    expect(screen.getByLabelText('当前 ASR 档案')).toHaveValue('local-whisper-cpp');
    expect(screen.getAllByText('本地 SenseVoice / FunASR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('云端上传转写 API').length).toBeGreaterThan(0);
    expect(screen.getAllByText('云端流式转写 API').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('ASR 引擎')).toHaveValue('whisper.cpp');
    expect(screen.getByLabelText('加速策略')).toHaveValue('GPU 优先');
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
    expect(screen.getByLabelText('编辑 默认整理 的 Prompt 模板')).toHaveValue(DEFAULT_CLEANUP_PROMPT);

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
    expect(screen.getAllByRole('button', { name: '复制' })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '删除' })[0]).toBeInTheDocument();
  });
});
