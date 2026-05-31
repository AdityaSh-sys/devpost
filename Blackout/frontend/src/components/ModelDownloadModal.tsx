'use client';

import { useState } from 'react';

interface ModelDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ModelDownloadModal({ isOpen, onClose }: ModelDownloadModalProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedModel, setSelectedModel] = useState('knowledge-base');

  const models = [
    {
      id: 'knowledge-base',
      name: 'Blackout Knowledge Base',
      size: '2.4 MB',
      description: 'Cached emergency, medical, and survival knowledge for instant offline answers.',
      status: 'ready' as const,
    },
    {
      id: 'gemma-2b',
      name: 'Gemma 2B (Quantized)',
      size: '1.3 GB',
      description: 'Full local language model for general-purpose offline AI. Requires WebGPU.',
      status: 'available' as const,
    },
    {
      id: 'phi-3-mini',
      name: 'Phi-3 Mini (ONNX)',
      size: '2.1 GB',
      description: 'Microsoft Phi-3 Mini for advanced offline reasoning. Best for complex queries.',
      status: 'available' as const,
    },
  ];

  const handleDownload = async () => {
    setIsDownloading(true);
    // Simulate download progress
    for (let i = 0; i <= 100; i += 2) {
      await new Promise((r) => setTimeout(r, 50));
      setProgress(i);
    }
    setIsDownloading(false);
    setProgress(0);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content model-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>📦 Offline Models</h2>
            <p>Download models for offline AI capabilities</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="model-list">
          {models.map((model) => (
            <div
              key={model.id}
              className={`model-card ${selectedModel === model.id ? 'selected' : ''}`}
              onClick={() => setSelectedModel(model.id)}
            >
              <div className="model-info">
                <div className="model-name-row">
                  <h3>{model.name}</h3>
                  <span className={`model-status ${model.status}`}>
                    {model.status === 'ready' ? '✓ Ready' : '↓ Available'}
                  </span>
                </div>
                <p>{model.description}</p>
                <span className="model-size">{model.size}</span>
              </div>
              {selectedModel === model.id && model.status !== 'ready' && (
                <div className="model-actions">
                  {isDownloading ? (
                    <div className="download-progress">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                      <span>{progress}%</span>
                    </div>
                  ) : (
                    <button className="download-btn" onClick={handleDownload}>
                      Download Model
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <div className="storage-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" />
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" />
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span>Storage used: 2.4 MB / 5 GB available</span>
          </div>
        </div>
      </div>
    </div>
  );
}
