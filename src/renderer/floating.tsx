import { createRoot } from 'react-dom/client';
import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, LoaderCircle, Mic, XCircle } from 'lucide-react';
import './styles.css';

export type FloatingState = 'recording' | 'recognizing' | 'rewriting' | 'done' | 'failed';

type FloatingPayload = {
  visible?: boolean;
  recording?: boolean;
  status?: FloatingState;
};

declare global {
  interface Window {
    tailkallFloating?: {
      onState?: (callback: (state: FloatingPayload) => void) => () => void;
    };
  }
}

type StateMeta = { label: string; icon: ReactNode; showWave?: boolean };

const stateMeta: Record<FloatingState, StateMeta> = {
  recording: { label: '录音中', icon: <Mic size={14} />, showWave: true },
  recognizing: { label: '转写', icon: <LoaderCircle className="spin" size={14} /> },
  rewriting: { label: '转写', icon: <LoaderCircle className="spin" size={14} /> },
  done: { label: '已输入', icon: <CheckCircle2 size={14} /> },
  failed: { label: '失败', icon: <XCircle size={14} /> }
};

export function FloatingWindow({ state = 'recognizing' }: { state?: FloatingState }) {
  const meta = stateMeta[state];

  return (
    <div aria-label="语音输入状态" className={`floating-capsule state-${state}`} role="status">
      <div className="floating-icon">{meta.icon}</div>
      <span className="floating-label">{meta.label}</span>
      {meta.showWave && (
        <div className="waveform" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <span data-testid="wave-bar" key={index} style={{ animationDelay: `${index * 80}ms` }} />
          ))}
        </div>
      )}
    </div>
  );
}

function FloatingRoot() {
  const [state, setState] = useState<FloatingState>('recognizing');

  useEffect(() => {
    document.documentElement.classList.add('floating-page');
    document.body.classList.add('floating-page');
    return () => {
      document.documentElement.classList.remove('floating-page');
      document.body.classList.remove('floating-page');
    };
  }, []);

  useEffect(() => {
    return window.tailkallFloating?.onState?.((payload) => {
      if (payload.status) {
        setState(payload.status);
        return;
      }
      if (payload.recording) {
        setState('recording');
      }
    });
  }, []);

  return <FloatingWindow state={state} />;
}

const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(<FloatingRoot />);
}
