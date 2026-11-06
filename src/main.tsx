import React from 'react';
import ReactDOM from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

registerSW({ onNeedRefresh() { window.dispatchEvent(new Event('oweme-update')); } });

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string}> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    if (this.state.error) return <main className="fatal card"><h1>Let’s get your notebook open.</h1><p>OweMe couldn’t read this device’s storage. Your saved records have not been cleared.</p><p className="error">{this.state.error}</p><button className="button primary" onClick={() => location.reload()}>Try again</button><p>Use a regular browser tab with storage enabled. Private browsing may limit persistence.</p></main>;
    return this.props.children;
  }
}
const router = createHashRouter([{ path: '*', element: <App /> }]);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><RouterProvider router={router}/></ErrorBoundary></React.StrictMode>);
