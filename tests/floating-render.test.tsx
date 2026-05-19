import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FloatingWindow } from '../src/renderer/floating';

describe('TailKall floating renderer', () => {
  it('renders a fixed green bottom-centered voice capsule with waveform animation', () => {
    render(<FloatingWindow />);

    const capsule = screen.getByRole('status', { name: 'TailKall 语音输入' });
    expect(capsule).toHaveClass('floating-capsule');
    expect(capsule).toHaveTextContent('TailKall');
    expect(capsule).toHaveTextContent('识别中');

    const bars = screen.getAllByTestId('wave-bar');
    expect(bars).toHaveLength(5);
  });

  it('supports all floating voice states', () => {
    const states = [
      ['recording', '录音中'],
      ['recognizing', '识别中'],
      ['rewriting', '整理中'],
      ['done', '已输入'],
      ['failed', '失败']
    ] as const;

    for (const [state, label] of states) {
      const { unmount } = render(<FloatingWindow state={state} />);
      expect(screen.getByRole('status', { name: 'TailKall 语音输入' })).toHaveTextContent(label);
      unmount();
    }
  });

  it('does not duplicate the title and recording state label', () => {
    render(<FloatingWindow state="recording" />);

    expect(screen.getByText('TailKall')).toBeInTheDocument();
    expect(screen.getByText('录音中')).toBeInTheDocument();
    expect(screen.queryByText('语音输入')).not.toBeInTheDocument();
  });
});
