'use client';

import { useState, useEffect } from 'react';
import { db, seedKnowledgeBase, type KnowledgeSnippet } from '@/lib/db';

interface ModelDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ModelDownloadModal({ isOpen, onClose }: ModelDownloadModalProps) {
  const [snippets, setSnippets] = useState<KnowledgeSnippet[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newTags, setNewTags] = useState('');

  useEffect(() => {
    if (isOpen) loadSnippets();
  }, [isOpen]);

  const loadSnippets = async () => {
    await seedKnowledgeBase();
    const all = await db.knowledgeSnippets.toArray();
    setSnippets(all);
  };

  const handleAdd = async () => {
    if (!newTitle.trim() || !newAnswer.trim()) return;
    const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
    const text = `${newTitle} ${newAnswer} ${tags.join(' ')}`;
    const embedding = computeEmbedding(text);
    await db.knowledgeSnippets.add({
      question: newTitle,
      answer: newAnswer,
      embedding,
      category: newCategory,
      offlineSummary: newAnswer.substring(0, 100),
    });
    setNewTitle('');
    setNewAnswer('');
    setNewTags('');
    setNewCategory('general');
    setShowAddForm(false);
    loadSnippets();
  };

  const handleDelete = async (id: string | undefined) => {
    if (!id || !confirm('Delete this entry?')) return;
    await db.knowledgeSnippets.delete(id);
    loadSnippets();
  };

  const totalSize = snippets.reduce((acc, s) => acc + s.answer.length + s.question.length, 0);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content model-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>📚 Offline Knowledge Base</h2>
            <p>Manage cached knowledge for offline AI responses</p>
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="kb-controls">
          <button className="kb-add-btn" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? '− Cancel' : '+ Add Entry'}
          </button>
        </div>

        {showAddForm && (
          <div className="kb-add-form">
            <input
              className="kb-input"
              placeholder="Title / Question"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <textarea
              className="kb-textarea"
              placeholder="Answer content"
              rows={4}
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
            />
            <div className="kb-form-row">
              <select
                className="kb-select"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              >
                <option value="medical">Medical</option>
                <option value="survival">Survival</option>
                <option value="emergency">Emergency</option>
                <option value="safety">Safety</option>
                <option value="general">General</option>
              </select>
              <input
                className="kb-input tags"
                placeholder="Tags (comma separated)"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
              />
              <button className="kb-save-btn" onClick={handleAdd}>Save</button>
            </div>
          </div>
        )}

        <div className="model-list kb-list">
          {snippets.map((s) => (
            <div key={s.id} className="model-card kb-card">
              <div className="model-info">
                <div className="model-name-row">
                  <h3>{s.question}</h3>
                  <span className={`kb-category ${s.category}`}>{s.category}</span>
                </div>
                <p className="kb-answer-preview">{s.offlineSummary}</p>
                <span className="model-size">{s.answer.length} chars</span>
              </div>
              <button className="kb-delete-btn" onClick={() => handleDelete(s.id)} title="Delete entry">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M3 6H5H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M8 6V4C8 3.44772 8.44772 3 9 3H15C15.5523 3 16 3.44772 16 4V6" stroke="currentColor" strokeWidth="2" />
                  <path d="M19 6V20C19 20.5523 18.5523 21 18 21H6C5.44772 21 5 20.5523 5 20V6" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
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
            <span>Storage used: {Math.round(totalSize / 1024)} KB of IndexedDB</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function computeEmbedding(text: string): number[] {
  const tokens = tokenize(text);
  const vocab = new Map<string, number>();
  tokens.forEach((token) => {
    if (!vocab.has(token)) vocab.set(token, vocab.size);
  });
  const vector = new Array(Math.max(vocab.size, 100)).fill(0);
  tokens.forEach((token) => {
    const idx = vocab.get(token)!;
    if (idx < vector.length) vector[idx] += 1;
  });
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) return vector.map((v) => v / magnitude);
  return vector;
}
