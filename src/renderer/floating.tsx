import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { CheckCircle2, LoaderCircle, Mic, WandSparkles, XCircle } from 'lucide-react';
import './styles.css';

export type FloatingState = 'recording' | 'recognizing' | 'rewriting' | 'done' | 'failed';

const stateMeta: Record<FloatingState, { label: string; icon: ReactNode }> = {
  recording: { label: '语音输入', icon: <Mic size={18} /> },
  recognizing: { label: '识别中', icon: <LoaderCircle className="spin" size={18} /> },
  rewriting: { label: '整理中', icon: <WandSparkles size={18} /> },
  done: { label: '已输入', icon: <CheckCircle2 size={18} /> },
  failed: { label: '失败', icon: <XCircle size={18} /> }
};

export function FloatingWindow({ state = 'recognizing' }: { state?: FloatingState }) {
  const meta = stateMeta[state];

  return (
    <div aria-label="TailKall 语音输入" className={`floating-capsule state-${state}`} role="status">
      <div className="floating-icon">{meta.icon}</div>
      <span className="floating-title">语音输入</span>
      <span className="floating-state">{meta.label}</span>
      <div className="waveform" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, index) => (
          <span data-testid="wave-bar" key={index} style={{ animationDelay: `${index * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(<FloatingWindow />);
}
