import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/renderer/App';

describe('TailKall main renderer', () => {
  it('renders the dashboard with trigger, ASR, rewrite API, and recent records', async () => {
    render(<App />);

    expect(screen.getByRole('banner', { name: 'TailKall 窗口栏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化或还原' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '仪表盘' })).toBeInTheDocument();
    expect(screen.getByText('当前触发键')).toBeInTheDocument();
    expect(screen.getByText('Ctrl + Alt + Space')).toBeInTheDocument();
    expect(screen.getByText('ASR')).toBeInTheDocument();
    expect(screen.getByText('whisper.cpp')).toBeInTheDocument();
    expect(screen.getByText('文案整理 API')).toBeInTheDocument();
    expect(screen.getByText('OpenAI Compatible / gpt-4.1-mini')).toBeInTheDocument();

    const recent = screen.getByRole('region', { name: '最近记录' });
    expect(within(recent).getByText('今天 09:18')).toBeInTheDocument();
    expect(within(recent).getByTitle(/请帮我整理今天会议关于登录体验/)).toBeInTheDocument();
  });

  it('switches to settings and exposes editable voice input configuration', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ctrl \+ Alt \+ Space/ })).toBeInTheDocument();
    expect(screen.getByText('点击上方按钮修改')).toBeInTheDocument();
    expect(screen.getByLabelText('短按动作')).toHaveValue('语音输入');
    expect(screen.getByText('按一下开始说话，再按一下结束')).toBeInTheDocument();
    expect(screen.getByLabelText('长按动作')).toHaveValue('语音助手');
    expect(screen.getByText('按住说话，松开结束')).toBeInTheDocument();
    expect(screen.getByLabelText('智能鼠标模式')).toBeInTheDocument();
    expect(screen.getByLabelText('ASR 引擎')).toHaveValue('whisper.cpp');
    expect(screen.getByLabelText('加速策略')).toHaveValue('GPU 优先');
    expect(screen.getByLabelText('本地模型目录')).toHaveValue('D:\\Antigravity\\tailkall\\models');
    expect(screen.getByLabelText('whisper.cpp 程序')).toHaveValue('D:\\Antigravity\\tailkall\\models\\whisper\\Release\\whisper-cli.exe');
    expect(screen.getByLabelText('whisper 模型文件')).toHaveValue('D:\\Antigravity\\tailkall\\models\\whisper\\ggml-small.bin');
    expect(screen.getByLabelText('ffmpeg 程序')).toHaveValue('D:\\Antigravity\\tailkall\\models\\whisper\\ffmpeg.exe');
    expect(screen.getByLabelText('faster-whisper 模型目录')).toHaveValue('D:\\Antigravity\\tailkall\\models\\faster-whisper\\small');
    expect(screen.getByLabelText('SenseVoice 模型目录')).toHaveValue('D:\\Antigravity\\tailkall\\models\\sensevoice\\SenseVoiceSmall');
    expect(screen.getByLabelText('Python 运行时')).toHaveValue('D:\\Antigravity\\tailkall\\.venv\\Scripts\\python.exe');
    expect(screen.getByLabelText('Provider')).toHaveValue('OpenAI Compatible');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.example.com/v1');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-4.1-mini');
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Prompt 模板')).toHaveValue('请整理语音输入文本，修正错别字和标点，直接返回整理后的文本。');
    expect(screen.getByRole('button', { name: /测试连接/ })).toBeInTheDocument();
    expect(screen.getByLabelText('输出模式')).toHaveValue('粘贴到当前光标');
    expect(screen.getByLabelText('数据目录')).toHaveValue('D:\\Antigravity\\tailkall\\data');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('captures the next keyboard or mouse trigger in the settings page', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: /Ctrl \+ Alt \+ Space/ }));

    expect(screen.getByText('按下键盘按键、组合键或鼠标中键/侧键')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'F9', code: 'F9' });
    expect(screen.getByRole('button', { name: /F9/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /F9/ }));
    fireEvent.mouseDown(window, { button: 1 });
    expect(screen.getByRole('button', { name: /Mouse Middle/ })).toBeInTheDocument();
  });

  it('captures modifier-only keyboard combinations such as Ctrl plus Win', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: /Ctrl \+ Alt \+ Space/ }));

    fireEvent.keyDown(window, { key: 'Meta', ctrlKey: true, metaKey: true });

    expect(screen.getByRole('button', { name: /Ctrl \+ Win/ })).toBeInTheDocument();
  });

  it('shows records with clipped long text, hover titles, inline editing, and actions', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: '语音记录' }));

    expect(screen.getByRole('heading', { name: '语音记录' })).toBeInTheDocument();

    const original = screen.getByTitle(/请帮我整理今天会议关于登录体验/);
    expect(original).toHaveClass('truncate-cell');
    fireEvent.click(original);
    expect(screen.getByDisplayValue(/请帮我整理今天会议关于登录体验/)).toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: '复制原文' })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '复制整理' })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '重新整理' })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '再次粘贴' })[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '删除' })[0]).toBeInTheDocument();
  });
});
