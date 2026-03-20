import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import LiveSession from './pages/LiveSession';
import Replay from './pages/Replay';
import Analysis from './pages/Analysis';

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(
    () => localStorage.getItem('gemini_api_key')
  );

  const handleApiKeyChange = (key: string) => {
    if (key) {
      localStorage.setItem('gemini_api_key', key);
    } else {
      localStorage.removeItem('gemini_api_key');
    }
    setApiKey(key || null);
  };

  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/*" element={
            <>
              <Navbar apiKey={apiKey} onApiKeyChange={handleApiKeyChange} />
              <main className="main-content">
                <Routes>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/live" element={<LiveSession apiKey={apiKey} />} />
                  <Route path="/replay" element={<Replay apiKey={apiKey} />} />
                  <Route path="/analysis" element={<Analysis />} />
                </Routes>
              </main>
            </>
          } />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
