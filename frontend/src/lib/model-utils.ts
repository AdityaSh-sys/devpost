/**
 * Model name masking utility.
 * Replaces real AI model names with the branded "Blackout 0.1" name
 * so end users never see the underlying model provider.
 */

const MODEL_MASK_MAP: Record<string, string> = {
  'gemini-2.5-flash-lite': 'Blackout 0.1',
  'gemini 2.5 flash lite': 'Blackout 0.1',
  'gemini 2.5 flash': 'Blackout 0.1',
  'gemini': 'Blackout 0.1',
  'gemma 2 2b': 'Blackout 0.1 Local',
  'gemma2:2b': 'Blackout 0.1 Local',
  'gemma': 'Blackout 0.1 Local',
  'ollama': 'Blackout 0.1 Local',
  'offline ai': 'Blackout 0.1 Local',
  'none (queued)': 'Blackout 0.1 (Queued)',
  'error': 'Blackout 0.1',
};

export function maskModelName(modelName: string): string {
  if (!modelName) return 'Blackout 0.1';

  const lower = modelName.toLowerCase().trim();

  // Direct match
  if (MODEL_MASK_MAP[lower]) {
    return MODEL_MASK_MAP[lower];
  }

  // Partial match
  for (const [key, value] of Object.entries(MODEL_MASK_MAP)) {
    if (lower.includes(key)) {
      return value;
    }
  }

  // If it contains "offline" anywhere, it's the local model
  if (lower.includes('offline')) {
    return 'Blackout 0.1 Local';
  }

  // Default: brand everything as Blackout
  return 'Blackout 0.1';
}

/**
 * Returns the display name for a connectivity mode
 */
export function getModelDisplayName(isOnline: boolean): string {
  return 'Blackout 0.1';
}
