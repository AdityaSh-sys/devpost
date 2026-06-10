'use client';

import { useState, useEffect } from 'react';
import { checkKBUpdate, downloadKBUpdate, applyKBUpdate, getKBStatus, type KBVersionInfo } from '@/lib/kb-update';

interface ModelDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ModelDownloadModal({ isOpen, onClose }: ModelDownloadModalProps) {
  const [kbInfo, setKbInfo] = useState<KBVersionInfo | null>(null);
  const [localVersion, setLocalVersion] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'importing' | 'done' | 'error'>('idle');
  const [importCount, setImportCount] = useState(0);

  useEffect(() => {
    if (isOpen) {
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
      });
    }
  }, [isOpen]);

  const handleDownloadUpdate = async () => {
    setIsDownloading(true);
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

    setIsDownloading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content model-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>📦 Offline Knowledge Base</h2>
            <p>Manage offline AI capabilities</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="model-list">
          <div className="model-card selected">
            <div className="model-info">
              <div className="model-name-row">
                <h3>Blackout Knowledge Base</h3>
                <span className="model-status ready">✓ Ready</span>
              </div>
              <p>Cached emergency, medical, and survival knowledge for instant offline answers.</p>
              <span className="model-size">Local version: v{localVersion}</span>
            </div>
          </div>

          <div className="update-section">
            <h4>🔄 KB Updates</h4>
            {status === 'checking' && (
              <div className="update-status">
                <span className="update-spinner" />
                Checking for updates...
              </div>
            )}

            {status === 'idle' && kbInfo && (
              <div className="update-status idle">
                ✓ Knowledge Base is up to date (v{kbInfo.version})
              </div>
            )}

            {status === 'idle' && !kbInfo && (
              <div className="update-status idle">
                ✓ No updates available
              </div>
            )}

            {status === 'available' && kbInfo && (
              <div className="update-available">
                <div className="update-info">
                  <span className="update-badge">NEW</span>
                  <span>Version {kbInfo.version} available</span>
                  <span className="update-entries">({kbInfo.entry_count} entries)</span>
                </div>
                <button
                  className="download-btn"
                  onClick={handleDownloadUpdate}
                  disabled={isDownloading}
                >
                  Download Update
                </button>
              </div>
            )}

            {status === 'downloading' && (
              <div className="download-progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <span>Downloading update... {progress}%</span>
              </div>
            )}

            {status === 'importing' && (
              <div className="download-progress">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <span>Applying update to local knowledge base...</span>
              </div>
            )}

            {status === 'done' && (
              <div className="update-status done">
                ✓ Update applied! {importCount} new entries added (v{localVersion})
              </div>
            )}

            {status === 'error' && (
              <div className="update-status error">
                ⚠️ Update failed. The backend may be unavailable.
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <div className="storage-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" />
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" />
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span>Knowledge Base v{localVersion}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
