// 应用入口：挂载 React 根组件（路由表见 App.tsx，设计 §7.1）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('未找到 #root 挂载点');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
