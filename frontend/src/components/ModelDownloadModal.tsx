'use client';

import { useState, useEffect, useCallback } from 'react';
import { checkKBUpdate, downloadKBUpdate, applyKBUpdate, getKBStatus, type KBVersionInfo } from '@/lib/kb-update';
import { checkLocalModel, resetModelCheck } from '@/lib/offline-ai';
import { getConnectivityEngine } from '@/lib/connectivity';

interface ModelDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  setupMode?: boolean;
}

type SetupStep = 'ollama' | 'download' | 'ready';

async function detectLocalOllama(): Promise<{ ollama: boolean; available: boolean }> {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return { ollama: false, available: false };
    const data = await resp.json();
    const models: { name: string }[] = data.models || [];
    return { ollama: true, available: models.some((m) => m.name === 'gemma2:2b') };
  } catch {
    try {
      const resp = await fetch('http://localhost:11434/api/tags', { mode: 'no-cors', signal: AbortSignal.timeout(2000) });
      return { ollama: resp.type === 'opaque' || resp.ok, available: false };
    } catch {
      return { ollama: false, available: false };
    }
  }
}

const LOCAL_OLLAMA_KEY = 'blackout_ollama_confirmed';

export default function ModelDownloadModal({ isOpen, onClose, setupMode = false }: ModelDownloadModalProps) {
  const [kbInfo, setKbInfo] = useState<KBVersionInfo | null>(null);
  const [localVersion, setLocalVersion] = useState(0);
  const [isKbDownloading, setIsKbDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'importing' | 'done' | 'error'>('idle');
  const [importCount, setImportCount] = useState(0);

  const [modelAvailable, setModelAvailable] = useState(false);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [modelDownloadStatus, setModelDownloadStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
  const [modelError, setModelError] = useState('');
  const [isBackendReachable, setIsBackendReachable] = useState(false);
  const [currentStep, setCurrentStep] = useState<SetupStep>('ollama');
  const [checking, setChecking] = useState(false);

  const checkModelStatus = useCallback(async () => {
    setChecking(true);
    let available = false;
    let ollama = false;

    const stored = localStorage.getItem(LOCAL_OLLAMA_KEY);
    if (stored === 'true') {
      ollama = true;
    }

    try {
      const resp = await fetch('/api/chat/model/status');
      const data = await resp.json();
      available = data.available;
      ollama = ollama || data.ollama_connected;
    } catch {
    }

    if (!ollama) {
      const local = await detectLocalOllama();
      ollama = local.ollama;
      available = available || local.available;
    }

    setModelAvailable(available);
    setOllamaConnected(ollama);
    setChecking(false);
    return { available, ollama };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    checkModelStatus();
    const interval = setInterval(checkModelStatus, 30000);
    return () => clearInterval(interval);
  }, [isOpen, checkModelStatus]);

  useEffect(() => {
    if (!isOpen) return;
    if (setupMode) {
      if (modelAvailable) setCurrentStep('ready');
      else if (ollamaConnected) setCurrentStep('download');
      else setCurrentStep('ollama');
    }
  }, [setupMode, modelAvailable, ollamaConnected, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const engine = getConnectivityEngine();
    const state = engine.getState();
    setIsBackendReachable(state.backendReachable);
    const unsub = engine.subscribe((s) => setIsBackendReachable(s.backendReachable));
    return () => unsub();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setStatus('checking');
    setLocalVersion(getKBStatus().localVersion);
    checkKBUpdate().then((info) => {
      if (info && info.available && info.version > getKBStatus().localVersion) {
        setKbInfo(info);
        setStatus('available');
      } else {
        setKbInfo(info);
        setStatus('idle');
      }
    }).catch(() => {
      setStatus('idle');
    });
  }, [isOpen]);

  const handleConfirmOllama = () => {
    localStorage.setItem(LOCAL_OLLAMA_KEY, 'true');
    setOllamaConnected(true);
  };

  const handleDownloadUpdate = async () => {
    setIsKbDownloading(true);
    setStatus('downloading');
    setProgress(0);

    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 10, 90));
    }, 200);

    try {
      const exportData = await downloadKBUpdate();
      clearInterval(interval);
      setProgress(95);

      if (exportData && exportData.entries) {
        setStatus('importing');
        const count = await applyKBUpdate(exportData);
        setImportCount(count);
        setLocalVersion(exportData.version);
        setProgress(100);
        setStatus('done');
      } else {
        setStatus('error');
      }
    } catch {
      clearInterval(interval);
      setStatus('error');
    }

    setIsKbDownloading(false);
  };

  const handleDownloadModel = async () => {
    const local = await checkModelStatus();
    if (local.available) {
      setModelDownloadStatus('done');
      return;
    }

    setModelDownloadStatus('downloading');
    setModelError('');

    const pollInterval = setInterval(async () => {
      const result = await checkModelStatus();
      if (result.available) {
        clearInterval(pollInterval);
        setModelDownloadStatus('done');
      }
    }, 5000);

    try {
      const response = await fetch('/api/chat/model/download', { method: 'POST' });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Download failed');
      }
      clearInterval(pollInterval);
      setModelDownloadStatus('done');
      await resetModelCheck();
      await checkModelStatus();
    } catch (e: any) {
      clearInterval(pollInterval);
      setModelDownloadStatus('error');
      setModelError(
        local.ollama
          ? 'Model is installed locally but backend download failed. Run: ollama pull gemma2:2b'
          : (e.message || 'Download failed. Ensure Ollama is installed and running.')
      );
    }
  };

  const handleCheckOllamaAgain = async () => {
    localStorage.removeItem(LOCAL_OLLAMA_KEY);
    await checkModelStatus();
  };

  const handleFinishSetup = () => {
    localStorage.setItem('blackout_setup_shown', 'true');
    onClose();
  };

  if (!isOpen) return null;

  const stepLabels = ['Install Ollama', 'Download Model', 'Ready'];
  const stepIndex = currentStep === 'ollama' ? 0 : currentStep === 'download' ? 1 : 2;

  const ServerDownAlert = () => (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-400 text-[20px]">info</span>
        <div>
          <p className="text-body-sm font-body-sm text-amber-300 mb-2">
            Ollama couldn&apos;t be auto-detected (browser security blocks localhost requests from HTTPS sites).
          </p>
          <p className="text-body-sm font-body-sm text-on-surface-variant">
            If you have Ollama installed, click the button below to confirm.
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-60 flex items-center justify-center backdrop-blur-sm" onClick={setupMode ? handleFinishSetup : onClose}>
      <div
        className="bg-surface-container-low border border-glass-border rounded-xl w-[90%] max-w-[600px] max-h-[80vh] overflow-y-auto flex flex-col shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {setupMode ? (
          <>
            <div className="p-6 border-b border-glass-border">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">Set Up Offline AI</h2>
                  <p className="text-body-sm font-body-sm text-on-surface-variant mt-0.5">
                    Install a local AI model so Blackout works even without internet.
                  </p>
                </div>
                <button className="p-2 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-colors" onClick={handleFinishSetup}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                {stepLabels.map((label, i) => (
                  <div key={label} className="flex items-center gap-2 flex-1">
                    <div className={`flex items-center gap-2 ${i > 0 ? 'ml-0' : ''}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-label-caps font-label-caps font-bold ${
                        i < stepIndex
                          ? 'bg-status-success text-white'
                          : i === stepIndex
                            ? 'bg-on-tertiary-container text-white'
                            : 'bg-surface-variant text-on-surface-variant'
                      }`}>
                        {i < stepIndex ? (
                          <span className="material-symbols-outlined text-[16px]">check</span>
                        ) : (
                          i + 1
                        )}
                      </div>
                      <span className={`text-label-caps font-label-caps ${
                        i === stepIndex ? 'text-on-surface font-semibold' : 'text-on-surface-variant'
                      }`}>
                        {label}
                      </span>
                    </div>
                    {i < stepLabels.length - 1 && (
                      <div className={`flex-1 h-px mx-2 ${i < stepIndex ? 'bg-status-success' : 'bg-surface-variant'}`} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6">
              {currentStep === 'ollama' && (
                <div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-on-tertiary-container/10 flex items-center justify-center text-on-tertiary-container">
                      <span className="material-symbols-outlined text-[28px]">download</span>
                    </div>
                    <div>
                      <h3 className="text-body-md font-body-md font-semibold text-on-surface">Install Ollama Engine</h3>
                      <p className="text-body-sm font-body-sm text-on-surface-variant">
                        Ollama runs the local AI model on your machine.
                      </p>
                    </div>
                  </div>

                  <ServerDownAlert />

                  <ol className="space-y-3 mb-6">
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center text-label-caps font-label-caps font-bold shrink-0">1</span>
                      <div>
                        <p className="text-body-sm font-body-sm text-on-surface font-medium">Download Ollama</p>
                        <p className="text-body-sm font-body-sm text-on-surface-variant">Visit ollama.com/download and install the version for your OS.</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center text-label-caps font-label-caps font-bold shrink-0">2</span>
                      <div>
                        <p className="text-body-sm font-body-sm text-on-surface font-medium">Launch Ollama</p>
                        <p className="text-body-sm font-body-sm text-on-surface-variant">Open the Ollama application — it runs in your menu bar.</p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <span className="w-6 h-6 rounded-full bg-on-tertiary-container/10 text-on-tertiary-container flex items-center justify-center text-label-caps font-label-caps font-bold shrink-0">3</span>
                      <div>
                        <p className="text-body-sm font-body-sm text-on-surface font-medium">Confirm installation below</p>
                        <p className="text-body-sm font-body-sm text-on-surface-variant">Click &ldquo;I have Ollama&rdquo; to let Blackout know.</p>
                      </div>
                    </li>
                  </ol>

                  <div className="flex flex-col gap-3">
                    <button
                      className="inline-flex items-center justify-center gap-2 bg-on-tertiary-container text-white px-5 py-2.5 rounded-lg text-body-md font-body-md font-semibold hover:bg-secondary-container transition-colors"
                      onClick={handleConfirmOllama}
                    >
                      <span className="material-symbols-outlined text-[20px]">check</span>
                      I have Ollama installed
                    </button>
                    <div className="flex items-center gap-3">
                      <a
                        href="https://ollama.com/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 inline-flex items-center justify-center gap-2 bg-surface-container border border-glass-border text-on-surface px-5 py-2.5 rounded-lg text-body-md font-body-md font-semibold hover:bg-on-surface/5 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[20px]">open_in_new</span>
                        Download Ollama
                      </a>
                      <button
                        className="inline-flex items-center justify-center gap-2 bg-surface-container border border-glass-border text-on-surface px-5 py-2.5 rounded-lg text-body-md font-body-md font-semibold hover:bg-on-surface/5 transition-colors disabled:opacity-40"
                        onClick={handleCheckOllamaAgain}
                        disabled={checking}
                      >
                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                        {checking ? 'Checking...' : 'Check Again'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 'download' && (
                <div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-on-tertiary-container/10 flex items-center justify-center text-on-tertiary-container">
                      <span className="material-symbols-outlined text-[28px]">neurology</span>
                    </div>
                    <div>
                      <h3 className="text-body-md font-body-md font-semibold text-on-surface">Download Offline AI Model</h3>
                      <p className="text-body-sm font-body-sm text-on-surface-variant">
                        Install <span className="font-mono-status text-on-surface">gemma2:2b</span> (~1.6 GB) for AI answers without internet.
                      </p>
                    </div>
                  </div>

                  <div className="bg-surface-container border border-glass-border rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded bg-on-tertiary-container/10 flex items-center justify-center text-on-tertiary-container">
                          <span className="material-symbols-outlined">neurology</span>
                        </div>
                        <div>
                          <h4 className="text-body-md font-body-md font-semibold text-on-surface">Gemma 2 2B</h4>
                          <p className="text-body-sm font-body-sm text-on-surface-variant">via Ollama — Offline AI</p>
                        </div>
                      </div>
                      <span className="px-2 py-1 rounded text-label-caps font-label-caps border bg-amber-500/10 text-amber-400 border-amber-500/20">
                        Not Installed
                      </span>
                    </div>
                  </div>

                  {modelDownloadStatus === 'idle' && (
                    <button
                      className="w-full inline-flex items-center justify-center gap-2 bg-on-tertiary-container text-white px-5 py-3 rounded-lg text-body-md font-body-md font-semibold hover:bg-secondary-container transition-colors"
                      onClick={handleDownloadModel}
                    >
                      <span className="material-symbols-outlined text-[20px]">download</span>
                      Download gemma2:2b
                    </button>
                  )}

                  {modelDownloadStatus === 'downloading' && (
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded bg-secondary/10 flex items-center justify-center text-secondary">
                          <span className="material-symbols-outlined animate-spin">sync</span>
                        </div>
                        <div>
                          <h4 className="text-body-md font-body-md font-semibold text-on-surface">Downloading gemma2:2b...</h4>
                          <p className="text-body-sm font-body-sm text-on-surface-variant">
                            This may take a few minutes depending on your connection. The model will be ready once downloaded.
                          </p>
                        </div>
                      </div>
                      <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                        <div className="bg-secondary h-full rounded-full progress-shimmer animate-pulse" style={{ width: '60%' }} />
                      </div>
                    </div>
                  )}

                  {modelDownloadStatus === 'done' && (
                    <div className="px-4 py-3 rounded-lg bg-status-success/10 text-status-success text-body-sm font-body-sm border border-status-success/20 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      Model installed successfully! You can now use offline AI answers.
                    </div>
                  )}

                  {modelDownloadStatus === 'error' && (
                    <div>
                      <div className="px-4 py-3 rounded-lg bg-status-error/10 text-status-error text-body-sm font-body-sm border border-status-error/20 mb-3">
                        {modelError || 'Download failed. Ensure Ollama is running and try again.'}
                      </div>
                      <button
                        className="w-full inline-flex items-center justify-center gap-2 bg-on-tertiary-container text-white px-5 py-3 rounded-lg text-body-md font-body-md font-semibold hover:bg-secondary-container transition-colors"
                        onClick={handleDownloadModel}
                      >
                        <span className="material-symbols-outlined text-[20px]">refresh</span>
                        Retry Download
                      </button>
                    </div>
                  )}
                </div>
              )}

              {currentStep === 'ready' && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 rounded-full bg-status-success/10 flex items-center justify-center mx-auto mb-4">
                    <span className="material-symbols-outlined text-[36px] text-status-success">check_circle</span>
                  </div>
                  <h3 className="text-headline-lg-mobile font-headline-lg-mobile font-bold text-on-surface mb-2">All Set!</h3>
                  <p className="text-body-sm font-body-sm text-on-surface-variant mb-6 max-w-sm mx-auto">
                    Your offline AI model is installed and ready. Blackout will automatically use it when you&apos;re offline.
                  </p>
                  <button
                    className="inline-flex items-center gap-2 bg-on-tertiary-container text-white px-6 py-3 rounded-lg text-body-md font-body-md font-semibold hover:bg-secondary-container transition-colors"
                    onClick={handleFinishSetup}
                  >
                    <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                    Start Using Blackout
                  </button>
                </div>
              )}
            </div>

            <div className="px-6 pb-6">
              <button
                className="w-full text-center text-body-sm font-body-sm text-on-surface-variant hover:text-on-surface transition-colors py-2"
                onClick={handleFinishSetup}
              >
                Skip setup — I&apos;ll do this later
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-glass-border">
              <div>
                <h2 className="text-headline-lg-mobile font-headline-lg-mobile text-on-surface">Intelligence Hub</h2>
                <p className="text-body-sm font-body-sm text-on-surface-variant mt-0.5">Manage local models and knowledge base context.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="bg-secondary-container text-white px-4 py-2 rounded-lg text-body-md font-body-md font-semibold hover:bg-on-secondary-fixed-variant transition-colors flex items-center gap-2 justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                  onClick={handleDownloadUpdate}
                  disabled={isKbDownloading || status !== 'available'}
                >
                  <span className="material-symbols-outlined text-[20px]">add_box</span>
                  Generate Snapshot
                </button>
                <button className="p-2 rounded-lg text-on-surface-variant hover:bg-on-surface/5 transition-colors" onClick={onClose}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>

            <div className="p-6 border-b border-glass-border">
              <h3 className="text-body-md font-body-md font-semibold text-on-surface mb-3">Active Model</h3>
              <div className="bg-surface-container border border-glass-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded bg-on-tertiary-container/10 flex items-center justify-center text-on-tertiary-container">
                      <span className="material-symbols-outlined">neurology</span>
                    </div>
                    <div>
                      <h4 className="text-body-md font-body-md font-semibold text-on-surface">Blackout 0.1</h4>
                      <p className="text-body-sm font-body-sm text-on-surface-variant">
                        Online & Offline AI Engine
                      </p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded text-label-caps font-label-caps border ${
                    isBackendReachable
                      ? 'bg-status-success/10 text-status-success border-status-success/20'
                      : 'bg-status-error/10 text-status-error border-status-error/20'
                  }`}>
                    {isBackendReachable ? 'Active' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6 border-b border-glass-border">
              <h3 className="text-body-md font-body-md font-semibold text-on-surface mb-3">Local AI Model</h3>
              <p className="text-body-sm font-body-sm text-on-surface-variant mb-4">
                Install <span className="font-mono-status text-on-surface">gemma2:2b</span> via Ollama for offline AI answers. (~1.6 GB download)
              </p>

              <div className="bg-surface-container border border-glass-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded bg-on-tertiary-container/10 flex items-center justify-center text-on-tertiary-container">
                      <span className="material-symbols-outlined">download</span>
                    </div>
                    <div>
                      <h4 className="text-body-md font-body-md font-semibold text-on-surface">
                        {ollamaConnected
                          ? (modelAvailable ? 'Gemma 2 2B' : 'gemma2:2b')
                          : 'Ollama Engine'}
                      </h4>
                      <p className="text-body-sm font-body-sm text-on-surface-variant">
                        {!ollamaConnected && 'Ollama not detected'}
                        {ollamaConnected && !modelAvailable && 'Not installed — click to download'}
                        {ollamaConnected && modelAvailable && 'Installed and ready'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-label-caps font-label-caps border ${
                      !ollamaConnected
                        ? 'bg-status-error/10 text-status-error border-status-error/20'
                        : modelAvailable
                          ? 'bg-status-success/10 text-status-success border-status-success/20'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {!ollamaConnected && 'Unavailable'}
                      {ollamaConnected && modelAvailable && 'Ready'}
                      {ollamaConnected && !modelAvailable && 'Not Installed'}
                    </span>
                  </div>
                </div>

                {!ollamaConnected && (
                  <div className="mt-4 pt-4 border-t border-glass-border/50 space-y-3">
                    <ServerDownAlert />
                    <button
                      className="inline-flex items-center gap-2 bg-on-tertiary-container text-white px-4 py-2 rounded-lg text-body-md font-body-md font-semibold hover:bg-secondary-container transition-colors"
                      onClick={handleConfirmOllama}
                    >
                      <span className="material-symbols-outlined text-[20px]">check</span>
                      I have Ollama installed
                    </button>
                    <a
                      href="https://ollama.com/download"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 bg-surface-container border border-glass-border text-on-surface px-4 py-2 rounded-lg text-body-md font-body-md font-semibold hover:bg-on-surface/5 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]">open_in_new</span>
                      Download Ollama
                    </a>
                  </div>
                )}

                {ollamaConnected && !modelAvailable && modelDownloadStatus === 'idle' && (
                  <div className="mt-4 pt-4 border-t border-glass-border/50">
                    <button
                      className="inline-flex items-center gap-2 bg-on-tertiary-container text-white px-4 py-2 rounded-lg text-body-md font-body-md font-semibold hover:bg-secondary-container transition-colors"
                      onClick={handleDownloadModel}
                    >
                      <span className="material-symbols-outlined text-[20px]">download</span>
                      Download gemma2:2b
                    </button>
                  </div>
                )}

                {modelDownloadStatus === 'downloading' && (
                  <div className="mt-4 pt-4 border-t border-glass-border/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded bg-secondary/10 flex items-center justify-center text-secondary">
                        <span className="material-symbols-outlined animate-spin">sync</span>
                      </div>
                      <div>
                        <h4 className="text-body-md font-body-md font-semibold text-on-surface">Downloading gemma2:2b...</h4>
                        <p className="text-body-sm font-body-sm text-on-surface-variant">
                          This may take a few minutes (~1.6 GB). The model will be available once downloaded.
                        </p>
                      </div>
                    </div>
                    <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden mt-3">
                      <div className="bg-secondary h-full rounded-full progress-shimmer animate-pulse" style={{ width: '60%' }} />
                    </div>
                  </div>
                )}

                {modelDownloadStatus === 'done' && (
                  <div className="mt-4 pt-4 border-t border-glass-border/50">
                    <div className="px-4 py-3 rounded-lg bg-status-success/10 text-status-success text-body-sm font-body-sm border border-status-success/20 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      Model installed successfully! You can now use offline AI answers.
                    </div>
                  </div>
                )}

                {modelDownloadStatus === 'error' && (
                  <div className="mt-4 pt-4 border-t border-glass-border/50">
                    <div className="px-4 py-3 rounded-lg bg-status-error/10 text-status-error text-body-sm font-body-sm border border-status-error/20">
                      {modelError || 'Download failed. Ensure Ollama is running and try again.'}
                    </div>
                    <button
                      className="mt-2 inline-flex items-center gap-2 bg-on-tertiary-container text-white px-4 py-2 rounded-lg text-body-md font-body-md font-semibold hover:bg-secondary-container transition-colors"
                      onClick={handleDownloadModel}
                    >
                      <span className="material-symbols-outlined text-[20px]">refresh</span>
                      Retry Download
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6">
              <h3 className="text-body-md font-body-md font-semibold text-on-surface mb-3">Knowledge Base Engine</h3>
              <p className="text-body-sm font-body-sm text-on-surface-variant mb-4">
                {isBackendReachable ? 'Compile documents into local vector space.' : 'Backend unavailable — KB version info cannot be fetched.'}
              </p>

              <div className="grid grid-cols-12 gap-2 pb-2 border-b border-glass-border text-on-surface-variant text-label-caps font-label-caps">
                <div className="col-span-5">Version ID</div>
                <div className="col-span-4">Compiled Date</div>
                <div className="col-span-3 text-right">Status</div>
              </div>

              <div className="grid grid-cols-12 gap-2 py-3 border-b border-glass-border/50 items-center text-body-sm font-body-sm">
                <div className="col-span-5 text-on-surface font-mono-status">
                  {localVersion > 0 ? `v.${localVersion}` : 'v.1.0.0'}
                </div>
                <div className="col-span-4 text-on-surface-variant">
                  {localVersion > 0 ? new Date().toLocaleDateString() : 'No local data'}
                </div>
                <div className="col-span-3 text-right flex justify-end">
                  <span className={`px-2 py-1 rounded text-label-caps font-label-caps border ${
                    status === 'done'
                      ? 'bg-status-success/10 text-status-success border-status-success/20'
                      : status === 'downloading' || status === 'importing'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-surface-variant text-on-surface-variant border-glass-border'
                  }`}>
                    {status === 'done' ? 'Updated' : status === 'downloading' || status === 'importing' ? 'Syncing' : localVersion > 0 ? 'Active' : 'Empty'}
                  </span>
                </div>
              </div>

              {kbInfo && kbInfo.available && kbInfo.version > localVersion && (
                <div className="grid grid-cols-12 gap-2 py-3 border-b border-glass-border/50 items-center text-body-sm font-body-sm">
                  <div className="col-span-5 text-online-glow font-mono-status">v.{kbInfo.version}</div>
                  <div className="col-span-4 text-on-surface-variant">{kbInfo.generated_at ? new Date(kbInfo.generated_at).toLocaleDateString() : 'Remote'}</div>
                  <div className="col-span-3 text-right flex justify-end">
                    <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 text-label-caps font-label-caps border border-amber-500/20">Available</span>
                  </div>
                </div>
              )}

              <div className="mt-4 bg-surface-container border border-glass-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded bg-on-tertiary-container/10 flex items-center justify-center text-on-tertiary-container">
                      <span className="material-symbols-outlined">database</span>
                    </div>
                    <div>
                      <h4 className="text-body-md font-body-md font-semibold text-on-surface">Blackout Knowledge Base</h4>
                      <p className="text-body-sm font-body-sm text-on-surface-variant">
                        Local v{localVersion || '1.0.0'}
                        {kbInfo && kbInfo.available && kbInfo.version > localVersion && (
                          <span className="text-amber-400 ml-2">(v{kbInfo.version} available)</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {(status === 'checking' || status === 'downloading' || status === 'importing') && (
                <div className="mt-3 bg-surface-container border border-glass-border rounded-lg p-4 relative overflow-hidden">
                  {status === 'downloading' && (
                    <div className="absolute -inset-1 bg-gradient-to-r from-transparent via-online-glow/10 to-transparent blur-xl pointer-events-none" />
                  )}
                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded bg-secondary/10 flex items-center justify-center text-secondary">
                        <span className="material-symbols-outlined animate-spin">sync</span>
                      </div>
                      <div>
                        <h4 className="text-body-md font-body-md font-semibold text-on-surface">
                          {status === 'checking' && 'Checking for updates...'}
                          {status === 'downloading' && 'Downloading update...'}
                          {status === 'importing' && 'Applying update...'}
                        </h4>
                        <p className="text-body-sm font-body-sm text-on-surface-variant">
                          {status === 'downloading' && `${progress}%`}
                          {status === 'importing' && 'Integrating into local knowledge base...'}
                        </p>
                      </div>
                    </div>
                    {status === 'downloading' && (
                      <span className="text-mono-status font-mono-status text-secondary">{progress}%</span>
                    )}
                  </div>
                  {status !== 'checking' && (
                    <div className="w-full bg-surface-container-highest h-2 rounded-full relative z-10 overflow-hidden mt-3">
                      <div
                        className="bg-secondary h-full rounded-full relative progress-shimmer transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {status === 'done' && (
                <div className="mt-3 px-4 py-3 rounded-lg bg-status-success/10 text-status-success text-body-sm font-body-sm border border-status-success/20">
                  Update applied! {importCount} new entries added (v{localVersion})
                </div>
              )}

              {status === 'error' && (
                <div className="mt-3 px-4 py-3 rounded-lg bg-status-error/10 text-status-error text-body-sm font-body-sm border border-status-error/20">
                  Update failed. The backend may be unavailable.
                </div>
              )}

              {status === 'idle' && kbInfo && (
                <div className="mt-3 px-4 py-3 rounded-lg bg-status-success/10 text-status-success text-body-sm font-body-sm border border-status-success/20">
                  Knowledge Base is up to date (v{kbInfo.version})
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
