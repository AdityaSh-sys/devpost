// Blackout - IndexedDB Schema using Dexie.js
// Local storage for conversations, knowledge base, offline queue, and model cache

import Dexie, { type Table } from 'dexie';

export interface Conversation {
  id?: string;
  query: string;
  response: string;
  connectivityState: 'online' | 'sms' | 'offline';
  modelUsed: string;
  timestamp: number;
  synced: boolean;
}

export interface KnowledgeSnippet {
  id?: string;
  question: string;
  answer: string;
  embedding: number[];
  category: string;
  offlineSummary: string;
}

export interface OfflineQueueItem {
  id?: number;
  query: string;
  timestamp: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  response?: string;
}

export interface SyncConflict {
  id?: string;
  offlineAnswer: string;
  onlineAnswer: string;
  similarityScore: number;
  resolutionStatus: 'pending' | 'resolved';
  resolvedAnswer?: string;
  conversationId: string;
}

export interface TelemetryEvent {
  id?: number;
  eventType: string;
  latency: number;
  usageData: Record<string, unknown>;
  errorList: string[];
  deviceInfo: string;
  timestamp: number;
  synced: boolean;
}

export interface CachedModel {
  id?: string;
  modelName: string;
  modelSize: number;
  downloadedAt: number;
  status: 'downloading' | 'ready' | 'error';
  progress: number;
}

export class BlackoutDB extends Dexie {
  conversations!: Table<Conversation>;
  knowledgeSnippets!: Table<KnowledgeSnippet>;
  offlineQueue!: Table<OfflineQueueItem>;
  syncConflicts!: Table<SyncConflict>;
  telemetry!: Table<TelemetryEvent>;
  cachedModels!: Table<CachedModel>;

  constructor() {
    super('BlackoutDB');
    this.version(1).stores({
      conversations: '++id, timestamp, connectivityState, synced',
      knowledgeSnippets: '++id, category',
      offlineQueue: '++id, status, timestamp',
      syncConflicts: '++id, resolutionStatus, conversationId',
      telemetry: '++id, eventType, timestamp, synced',
      cachedModels: '++id, modelName, status',
    });
  }
}

export const db = new BlackoutDB();

// Seed knowledge base with default entries for offline mode
export async function seedKnowledgeBase() {
  const count = await db.knowledgeSnippets.count();
  if (count > 0) return;

  const defaultSnippets: Omit<KnowledgeSnippet, 'id'>[] = [
    {
      question: 'What is first aid for a deep cut?',
      answer: 'Apply direct pressure with a clean cloth to stop bleeding. If bleeding doesn\'t stop after 10 minutes, seek medical help. Clean the wound with clean water, apply antibiotic ointment, and cover with a sterile bandage. Watch for signs of infection: redness, swelling, warmth, or pus.',
      embedding: [],
      category: 'medical',
      offlineSummary: 'First aid for cuts: pressure, clean, bandage, watch for infection.',
    },
    {
      question: 'How do I purify water in an emergency?',
      answer: 'Boiling: Bring water to a rolling boil for 1 minute (3 minutes above 6,500 feet). Chemical: Use 2 drops of unscented bleach per liter, wait 30 minutes. Solar: Fill clear bottles, place in direct sunlight for 6+ hours. Filter: Use cloth to remove large particles before treatment.',
      embedding: [],
      category: 'survival',
      offlineSummary: 'Water purification: boil, bleach drops, solar disinfection, or filter.',
    },
    {
      question: 'What should I do during an earthquake?',
      answer: 'Drop, Cover, and Hold On. If indoors: Get under a sturdy desk/table, cover your head. Stay away from windows, heavy objects, and exterior walls. If outdoors: Move to open area away from buildings, trees, power lines. If driving: Pull over, stop, set parking brake. After: Check for injuries, expect aftershocks, check gas/water lines.',
      embedding: [],
      category: 'emergency',
      offlineSummary: 'Earthquake safety: Drop, Cover, Hold On. Stay away from windows.',
    },
    {
      question: 'How do I perform CPR?',
      answer: 'Call emergency services first. Place heel of hand on center of chest. Push hard and fast (2 inches deep, 100-120 compressions/minute). Give 2 rescue breaths after every 30 compressions. Continue until help arrives or person breathes normally. For infants: Use 2 fingers, compress 1.5 inches.',
      embedding: [],
      category: 'medical',
      offlineSummary: 'CPR: 30 compressions (2" deep, 100-120/min), 2 breaths, repeat.',
    },
    {
      question: 'How to build a shelter in the wilderness?',
      answer: 'Find a location with natural windbreak (cliff, fallen tree). Debris hut: Create A-frame with ridgepole, layer branches and leaves thickly. Lean-to: Prop branches against a horizontal support. Insulate floor with dry leaves, pine needles. Face opening away from prevailing wind. Keep shelter small to retain body heat.',
      embedding: [],
      category: 'survival',
      offlineSummary: 'Shelter: A-frame or lean-to, insulate floor, face away from wind.',
    },
    {
      question: 'What are signs of a stroke?',
      answer: 'Remember FAST: Face drooping (one side), Arm weakness (one arm drifts down), Speech difficulty (slurred or strange), Time to call emergency. Also watch for: sudden numbness, confusion, vision problems, severe headache, trouble walking. Every minute counts — get help immediately.',
      embedding: [],
      category: 'medical',
      offlineSummary: 'Stroke signs: FAST - Face, Arm, Speech, Time. Call emergency immediately.',
    },
    {
      question: 'How to signal for rescue?',
      answer: 'Visual: 3 fires in triangle, mirror flash toward aircraft/ships. Audio: 3 whistle blasts repeated. Ground: Create large SOS or X with rocks/logs visible from air. Stay in open area. Wear bright colors. At night, use flashlight in groups of 3 flashes. Universal distress: anything in groups of three.',
      embedding: [],
      category: 'emergency',
      offlineSummary: 'Rescue signals: groups of 3 (fires, whistles, flashes), SOS on ground.',
    },
    {
      question: 'What is the treatment for dehydration?',
      answer: 'Mild: Drink small sips of water frequently. Add oral rehydration salts if available (or mix 6 tsp sugar + 1/2 tsp salt per liter water). Avoid caffeine and alcohol. Rest in shade. Severe symptoms (confusion, rapid heartbeat, no urination): This is a medical emergency — seek help immediately.',
      embedding: [],
      category: 'medical',
      offlineSummary: 'Dehydration: sip water, oral rehydration solution, rest in shade.',
    },
  ];

  await db.knowledgeSnippets.bulkAdd(defaultSnippets);
}
