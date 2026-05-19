import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FloatingWindow } from '../src/renderer/floating';

describe('TailKall floating renderer', () => {
  it('renders a voice capsule with waveform animation', () => {
    render(<FloatingWindow />);

    const capsule = screen.getByRole('status', { name: '语音输入状态' });
    expect(capsule).toHaveClass('floating-capsule');
    expect(capsule).toHaveTextContent('转写中');

    const bars = screen.getAllByTestId('wave-bar');
    expect(bars).toHaveLength(6);
  });

  it('supports all floating voice states', () => {
    const states = [
      ['recording', '录音中'],
      ['recognizing', '转写中'],
      ['rewriting', '转写中'],
      ['done', '已输入'],
      ['failed', '失败']
    ] as const;

    for (const [state, label] of states) {
      const { unmount } = render(<FloatingWindow state={state} />);
      expect(screen.getByRole('status', { name: '语音输入状态' })).toHaveTextContent(label);
      unmount();
    }
  });

  it('does not duplicate the title and recording state label', () => {
    render(<FloatingWindow state="recording" />);

    expect(screen.getByText('录音中')).toBeInTheDocument();
    expect(screen.queryByText('语音输入')).not.toBeInTheDocument();
  });
});
