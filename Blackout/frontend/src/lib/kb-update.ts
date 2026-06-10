// KB Update Engine
// Checks for, downloads, and applies offline knowledge base updates

import { db, type KnowledgeSnippet } from './db';

export interface KBVersionInfo {
  version: number;
  entry_count: number;
  generated_at: string;
  available: boolean;
}

export interface KBExport {
  version: number;
  generated_at: string;
  entries: Omit<KnowledgeSnippet, 'id'>[];
}

const KB_VERSION_KEY = 'blackout_kb_version';

function getLocalVersion(): number {
  if (typeof window === 'undefined') return 0;
  try {
    return parseInt(localStorage.getItem(KB_VERSION_KEY) || '0', 10);
  } catch {
    return 0;
  }
}

function setLocalVersion(version: number) {
  try {
    localStorage.setItem(KB_VERSION_KEY, String(version));
  } catch {}
}

export async function checkKBUpdate(): Promise<KBVersionInfo | null> {
  try {
    const response = await fetch('/api/kb/version');
    if (!response.ok) return null;
    const data: KBVersionInfo = await response.json();
    return data;
  } catch {
    return null;
  }
}

export async function downloadKBUpdate(): Promise<KBExport | null> {
  try {
    const response = await fetch('/api/kb/export');
    if (!response.ok) return null;
    const data: KBExport = await response.json();
    return data;
  } catch {
    return null;
  }
}

export async function applyKBUpdate(exportData: KBExport): Promise<number> {
  let imported = 0;

  const existing = await db.knowledgeSnippets.toArray();
  const existingQuestions = new Set(existing.map((s) => s.question.toLowerCase().trim()));

  for (const entry of exportData.entries) {
    const questionLower = (entry.question || '').toLowerCase().trim();
    if (!questionLower || existingQuestions.has(questionLower)) continue;

    await db.knowledgeSnippets.add({
      question: entry.question,
      answer: entry.answer,
      embedding: entry.embedding || [],
      category: entry.category || 'general',
      offlineSummary: entry.offlineSummary || entry.answer.slice(0, 100),
    });

    existingQuestions.add(questionLower);
    imported++;
  }

  if (imported > 0) {
    setLocalVersion(exportData.version);
  }

  return imported;
}

export async function checkAndApplyUpdate(): Promise<{
  checked: boolean;
  updated: boolean;
  imported: number;
  currentVersion: number;
}> {
  const localVersion = getLocalVersion();
  const remote = await checkKBUpdate();

  if (!remote || !remote.available) {
    return { checked: true, updated: false, imported: 0, currentVersion: localVersion };
  }

  if (remote.version <= localVersion) {
    return { checked: true, updated: false, imported: 0, currentVersion: localVersion };
  }

  const exportData = await downloadKBUpdate();
  if (!exportData || !exportData.entries || exportData.entries.length === 0) {
    return { checked: true, updated: false, imported: 0, currentVersion: localVersion };
  }

  const imported = await applyKBUpdate(exportData);
  return {
    checked: true,
    updated: imported > 0,
    imported,
    currentVersion: exportData.version,
  };
}

export function getKBStatus(): { localVersion: number } {
  return { localVersion: getLocalVersion() };
}

// Trigger a KB update check on demand (e.g., when coming back online)
export async function checkKBUpdateNow(): Promise<{ updated: boolean; imported: number; currentVersion: number }> {
  try {
    const result = await checkAndApplyUpdate();
    if (result.updated) {
      console.log(`KB auto-update on reconnect: ${result.imported} new entries (v${result.currentVersion})`);
    }
    return result;
  } catch {
    return { updated: false, imported: 0, currentVersion: 0 };
  }
}
