import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './styles.css';

export type FloatingState = 'recording' | 'recognizing' | 'rewriting' | 'done' | 'failed';

type FloatingPayload = {
  visible?: boolean;
  recording?: boolean;
  status?: FloatingState;
};

declare global {
  interface Window {
    snapsayFloating?: {
      onState?: (callback: (state: FloatingPayload) => void) => () => void;
    };
  }
}

const stateLabel: Record<FloatingState, string> = {
  recording: '录音中',
  recognizing: '文本提取',
  rewriting: '文本整理',
  done: '已输入',
  failed: '失败'
};

export function FloatingWindow({ state = 'recognizing' }: { state?: FloatingState }) {
  const showWave = state === 'recording';

  return (
    <div aria-label="语音输入状态" className={`floating-capsule state-${state}`} role="status">
      <span className="floating-label">{stateLabel[state]}</span>
      <div className="waveform" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <span
            className={showWave ? '' : 'paused'}
            data-testid="wave-bar"
            key={index}
            style={{ animationDelay: `${index * 80}ms` }}
          />
        ))}
      </div>
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
    return window.snapsayFloating?.onState?.((payload) => {
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
