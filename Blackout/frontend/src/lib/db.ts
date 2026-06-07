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

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((t) => t.length > 2);
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

// Seed knowledge base with default entries for offline mode
export async function seedKnowledgeBase() {
  const count = await db.knowledgeSnippets.count();
  if (count > 0) return;

  const raw: Omit<KnowledgeSnippet, 'id'>[] = [
    // === MEDICAL (12 entries) ===
    {
      question: 'What is first aid for a deep cut?',
      answer: 'Apply direct pressure with a clean cloth to stop bleeding. If bleeding doesn\'t stop after 10 minutes, seek medical help. Clean the wound with clean water, apply antibiotic ointment, and cover with a sterile bandage. Watch for signs of infection: redness, swelling, warmth, or pus.',
      embedding: [], category: 'medical',
      offlineSummary: 'First aid for cuts: pressure, clean, bandage, watch for infection.',
    },
    {
      question: 'How do I perform CPR?',
      answer: 'Call emergency services first. Place heel of hand on center of chest. Push hard and fast (2 inches deep, 100-120 compressions per minute). Give 2 rescue breaths after every 30 compressions. Continue until help arrives or person breathes normally. For infants use 2 fingers compress 1.5 inches.',
      embedding: [], category: 'medical',
      offlineSummary: 'CPR: 30 compressions 2 inches deep 100-120 per minute 2 breaths repeat.',
    },
    {
      question: 'What are signs of a stroke?',
      answer: 'Remember FAST: Face drooping on one side, Arm weakness one arm drifts down, Speech difficulty slurred or strange, Time to call emergency. Also watch for sudden numbness, confusion, vision problems, severe headache, trouble walking. Every minute counts get help immediately.',
      embedding: [], category: 'medical',
      offlineSummary: 'Stroke signs FAST: Face Arm Speech Time. Call emergency immediately.',
    },
    {
      question: 'How to treat burns?',
      answer: 'Cool the burn under cool running water for at least 10 minutes. Do not use ice as it can damage tissue. Remove jewelry or tight items near the burn. Cover with a sterile gauze bandage. Do not pop blisters. Apply aloe vera or burn cream. Seek medical help for large or deep burns, or burns on face hands feet groin.',
      embedding: [], category: 'medical',
      offlineSummary: 'Burns: cool water 10 minutes, cover with gauze, no ice, no popping blisters.',
    },
    {
      question: 'How to treat a fracture or broken bone?',
      answer: 'Do not move the injured area. Immobilize the limb using a splint made from rigid materials like a board or rolled newspaper. Pad the splint with cloth. Apply ice wrapped in cloth to reduce swelling. Seek medical help immediately. If the bone is protruding do not try to push it back in. Cover with sterile dressing.',
      embedding: [], category: 'medical',
      offlineSummary: 'Fracture: immobilize with splint, apply ice, seek medical help immediately.',
    },
    {
      question: 'What to do if someone is choking?',
      answer: 'Ask if they can cough or speak. If they cannot, perform abdominal thrusts Heimlich maneuver. Stand behind them, wrap arms around their waist, make a fist above their navel, grasp with other hand and thrust inward and upward. Repeat until object is dislodged. For infants: give 5 back blows between shoulder blades then 5 chest thrusts.',
      embedding: [], category: 'medical',
      offlineSummary: 'Choking: abdominal thrusts Heimlich for adults, back blows and chest thrusts for infants.',
    },
    {
      question: 'What are symptoms of hypothermia?',
      answer: 'Shivering, confusion, drowsiness, slurred speech, slow breathing, weak pulse. Move person to warm area, remove wet clothing, wrap in blankets or dry clothes. Offer warm beverages if conscious. Do not rub extremities as this can cause cardiac arrest in severe cases. Seek medical help immediately.',
      embedding: [], category: 'medical',
      offlineSummary: 'Hypothermia: shivering confusion drowsiness. Warm gradually seek medical help.',
    },
    {
      question: 'What is treatment for heatstroke?',
      answer: 'Heatstroke is a life-threatening emergency. Call emergency services immediately. Move person to shade or cool area. Remove excess clothing. Cool rapidly with cold water or ice packs on neck armpits and groin. Fan them. If conscious give cool water. Do not give medications like ibuprofen for fever. Monitor breathing.',
      embedding: [], category: 'medical',
      offlineSummary: 'Heatstroke: emergency call 911, cool rapidly with water and ice, monitor breathing.',
    },
    {
      question: 'What to do in a poisoning emergency?',
      answer: 'Call poison control or emergency services immediately. Do not induce vomiting unless instructed. Identify the poison if possible bring container to hospital. If poison is on skin rinse with water for 15 minutes. If inhaled get to fresh air. If unconscious place on side recovery position. Do not give anything by mouth.',
      embedding: [], category: 'medical',
      offlineSummary: 'Poisoning: call poison control, do not induce vomiting, identify the substance.',
    },
    {
      question: 'How to treat an allergic reaction?',
      answer: 'Mild reactions: antihistamines like Benadryl, apply calamine lotion for rashes. Severe reactions anaphylaxis: use epinephrine auto-injector EpiPen if available, call emergency services immediately. Lie person flat raise legs. If breathing stops start CPR. Symptoms of anaphylaxis include swelling of throat, difficulty breathing, hives, rapid pulse.',
      embedding: [], category: 'medical',
      offlineSummary: 'Allergic reaction: antihistamines for mild, epinephrine EpiPen for severe anaphylaxis.',
    },
    {
      question: 'What is the treatment for dehydration?',
      answer: 'Mild: Drink small sips of water frequently. Add oral rehydration salts if available or mix 6 tsp sugar plus half tsp salt per liter water. Avoid caffeine and alcohol. Rest in shade. Severe symptoms confusion rapid heartbeat no urination: This is a medical emergency seek help immediately.',
      embedding: [], category: 'medical',
      offlineSummary: 'Dehydration: sip water, oral rehydration solution, rest in shade.',
    },
    {
      question: 'How to control severe bleeding?',
      answer: 'Apply firm direct pressure with a clean cloth or bandage. Do not remove the cloth if blood soaks through add more on top. Elevate the injured area above heart if possible. Apply pressure to the main artery supplying the area if bleeding continues. Use tourniquet only as last resort for limb bleeding. Call emergency services.',
      embedding: [], category: 'medical',
      offlineSummary: 'Severe bleeding: direct pressure, elevate, tourniquet only as last resort.',
    },
    // === SURVIVAL (10 entries) ===
    {
      question: 'How do I purify water in an emergency?',
      answer: 'Boiling: Bring water to a rolling boil for 1 minute 3 minutes above 6500 feet. Chemical: Use 2 drops of unscented bleach per liter wait 30 minutes. Solar: Fill clear bottles place in direct sunlight for 6 plus hours. Filter through cloth first to remove particles. Commercial filters remove bacteria and parasites.',
      embedding: [], category: 'survival',
      offlineSummary: 'Water purification: boil, bleach drops, solar disinfection, or filter.',
    },
    {
      question: 'How to build a shelter in the wilderness?',
      answer: 'Find location with natural windbreak like cliff or fallen tree. Debris hut: Create A-frame with ridgepole, layer branches and leaves thickly. Lean-to: Prop branches against horizontal support. Insulate floor with dry leaves and pine needles. Face opening away from prevailing wind. Keep shelter small to retain body heat.',
      embedding: [], category: 'survival',
      offlineSummary: 'Shelter: A-frame or lean-to, insulate floor, face away from wind.',
    },
    {
      question: 'How to start a fire without matches?',
      answer: 'Friction methods: bow drill or hand drill using dry wood. Use a tinder bundle of dry grass bark or cotton. Fire plow: rub a stick in a groove on a softwood board. Use flint and steel if available. Spark from battery and steel wool. Always prepare tinder kindling and fuel before starting. Protect fire from wind.',
      embedding: [], category: 'survival',
      offlineSummary: 'Fire without matches: bow drill, flint and steel, battery with steel wool.',
    },
    {
      question: 'How to navigate without a compass?',
      answer: 'Use the sun: sun rises in east sets in west. At noon in northern hemisphere sun is due south. Use stars: North Star Polaris points north. Use a stick: place stick upright mark shadow tip wait 15 minutes mark again line from first to second mark points east. Use moss: moss grows on north side of trees in northern hemisphere.',
      embedding: [], category: 'survival',
      offlineSummary: 'Navigation: sun position, North Star, stick shadow method, moss on trees.',
    },
    {
      question: 'How to signal for rescue?',
      answer: 'Visual: 3 fires in triangle formation, mirror flash toward aircraft or ships. Audio: 3 whistle blasts repeated at intervals. Ground: Create large SOS or X with rocks or logs visible from air. Wear bright colors avoid camouflage. At night use flashlight in groups of 3 flashes. Universal distress: anything in groups of three.',
      embedding: [], category: 'survival',
      offlineSummary: 'Rescue signals: groups of 3 fires whistles flashes, SOS on ground.',
    },
    {
      question: 'What wild plants are safe to eat?',
      answer: 'Dandelion: all parts edible leaves flowers roots. Cattail: roots shoots and pollen edible. Clover: leaves and flowers edible raw or cooked. Pine: inner bark and pine needles for tea. Blackberries raspberries blueberries: identify by cluster of small bumps. Universal edibility test: test one part at a time wait 8 hours. Avoid white berries and umbrella-shaped flowers.',
      embedding: [], category: 'survival',
      offlineSummary: 'Safe wild edibles: dandelion, cattail, clover, pine, blackberries. Universal edibility test.',
    },
    {
      question: 'How to tie basic survival knots?',
      answer: 'Square knot: right over left left over right for joining two ropes. Bowline: creates a fixed loop at end of rope pass end through loop around and back down. Clove hitch: two half hitches for attaching rope to a pole. Figure eight: stopper knot at end of rope. Practice each until you can tie them behind your back.',
      embedding: [], category: 'survival',
      offlineSummary: 'Knots: square knot, bowline, clove hitch, figure eight for survival situations.',
    },
    {
      question: 'How to predict weather without a forecast?',
      answer: 'Red sky at night sailors delight red sky in morning sailors take warning. Low clouds dark clouds indicate rain. High thin cirrus clouds indicate weather change within 24 hours. Ring around the moon means rain within 3 days. Wind shifting direction often means storm coming. Decreasing pressure dropping indicates storm approaching.',
      embedding: [], category: 'survival',
      offlineSummary: 'Weather prediction: red sky, cloud types, moon ring, wind shifts, pressure drops.',
    },
    {
      question: 'How to find water in the wild?',
      answer: 'Look for green vegetation which indicates water nearby. Follow animal trails especially in morning or evening. Dig in dry creek beds look for damp soil. Collect dew with cloth in early morning. Collect rainwater with clean containers. Melt ice or snow for drinking. Avoid drinking salt water or urine. Purify all water before drinking.',
      embedding: [], category: 'survival',
      offlineSummary: 'Find water: follow green vegetation animal trails dig creek beds collect dew rain.',
    },
    {
      question: 'How to treat snake bite in wilderness?',
      answer: 'Stay calm and still to slow venom spread. Keep bitten area at or below heart level. Remove jewelry or tight items near bite. Clean wound with soap and water. Cover with clean dry dressing. Do not cut the wound or suck out venom. Do not apply tourniquet. Get to medical help as quickly as possible. Identify snake if safe.',
      embedding: [], category: 'survival',
      offlineSummary: 'Snake bite: stay calm, keep bite below heart, clean wound, get medical help fast.',
    },
    // === EMERGENCY (8 entries) ===
    {
      question: 'What should I do during an earthquake?',
      answer: 'Drop Cover and Hold On. If indoors get under sturdy desk or table cover your head. Stay away from windows heavy objects and exterior walls. If outdoors move to open area away from buildings trees power lines. If driving pull over stop set parking brake. After quake check for injuries expect aftershocks check gas and water lines.',
      embedding: [], category: 'emergency',
      offlineSummary: 'Earthquake safety: Drop Cover Hold On. Stay away from windows and buildings.',
    },
    {
      question: 'What to do during a flood?',
      answer: 'Move to higher ground immediately. Do not walk swim or drive through flood waters. Six inches of moving water can knock you down. One foot of water can sweep away a car. Avoid power lines and electrical sources. Turn off utilities at main switches. Gather emergency supplies. Wait for authorities to declare it safe to return.',
      embedding: [], category: 'emergency',
      offlineSummary: 'Flood: move to high ground, never walk or drive through floodwater, avoid power lines.',
    },
    {
      question: 'How to prepare for a hurricane?',
      answer: 'Board up windows with plywood. Secure outdoor objects that could become projectiles. Fill car gas tank. Stock water one gallon per person per day for 3 days. Stock non-perishable food for 3 days. Charge phones and power banks. Know evacuation routes. If told to evacuate leave immediately. Stay away from windows during storm.',
      embedding: [], category: 'emergency',
      offlineSummary: 'Hurricane prep: board windows, stock water and food, charge devices, know evacuation route.',
    },
    {
      question: 'What to do during a tornado?',
      answer: 'Go to basement or interior room on lowest floor like bathroom or closet. Stay away from windows doors and exterior walls. Cover your head and neck with arms and a blanket or mattress. If in mobile home or vehicle leave and find sturdy shelter. If outside lie flat in a ditch or low area covering head. Do not seek shelter under overpass.',
      embedding: [], category: 'emergency',
      offlineSummary: 'Tornado: basement or interior room lowest floor, cover head, no windows.',
    },
    {
      question: 'How to survive a tsunami?',
      answer: 'If you feel strong earthquake near coast move to high ground immediately. Do not wait for official warning. Go to elevation of at least 100 feet above sea level or 2 miles inland. If you see the ocean receding unusually run inland. A tsunami is a series of waves the first may not be largest. Stay away from coast until officials say safe.',
      embedding: [], category: 'emergency',
      offlineSummary: 'Tsunami: move to high ground immediately after earthquake, run inland if water recedes.',
    },
    {
      question: 'How to survive a wildfire?',
      answer: 'If trapped call emergency services. Find body of water if possible. Lie face down in cleared area or depression. Cover body with soil or wet blanket. Breathe air close to ground where it is cooler. If driving park in cleared area close windows and vents. Cover yourself with wool blanket. Do not try to outrun the fire uphill.',
      embedding: [], category: 'emergency',
      offlineSummary: 'Wildfire survival: find water, lie low in cleared area, cover with wet blanket or soil.',
    },
    {
      question: 'What to do in an avalanche?',
      answer: 'If caught try to move to the side of the avalanche. Discard gear like skis and poles. Swim against the snow to stay near surface. When slowing create air pocket with hand in front of face. Stay calm to conserve oxygen. If buried do not struggle. Call out only when you hear rescuers nearby to conserve air.',
      embedding: [], category: 'emergency',
      offlineSummary: 'Avalanche: swim to stay near surface, create air pocket, conserve oxygen while buried.',
    },
    {
      question: 'How to respond to a landslide?',
      answer: 'If you suspect landslide danger evacuate immediately. Watch for leaning trees tilting fences or cracked pavement on hillsides. Listen for rumbling sound that increases in volume. Move away from path of landslide at right angle. If escape is not possible curl into tight ball and protect your head. After slide stay away from slide area as additional slides may occur.',
      embedding: [], category: 'emergency',
      offlineSummary: 'Landslide: evacuate immediately, move perpendicular to slide path, protect head.',
    },
    // === SAFETY (6 entries) ===
    {
      question: 'How to practice food safety without refrigeration?',
      answer: 'Keep food in cool dry place away from direct sun. Use airtight containers to protect from insects and animals. Cook meat thoroughly until no pink remains. Eat cooked food within 2 hours or 1 hour if temperature above 90F. When in doubt throw it out. Smell test: if it smells bad do not eat. Boil water before drinking or cooking.',
      embedding: [], category: 'safety',
      offlineSummary: 'Food safety: cool dry storage, cook thoroughly, eat within 2 hours, when in doubt throw out.',
    },
    {
      question: 'How to handle a mental health crisis?',
      answer: 'Stay with the person do not leave them alone. Listen without judgment. Ask directly if they are thinking of suicide. Remove means of self-harm from area. Call emergency services or suicide hotline 988 in US. Do not argue with or challenge the person. Offer hope that help is available. Follow up after the crisis passes.',
      embedding: [], category: 'safety',
      offlineSummary: 'Mental health crisis: stay with person, listen, call 988, remove means of harm.',
    },
    {
      question: 'How to survive an animal attack?',
      answer: 'Bear: do not run make yourself look big back away slowly. Mountain lion: make eye contact appear large do not crouch. Wolf or coyote: make noise appear large do not run. Moose: run away they can charge but usually stop at territory boundary. Snake: freeze and slowly back away. All animals: protect your neck and throat if attacked.',
      embedding: [], category: 'safety',
      offlineSummary: 'Animal attacks: bear back away slowly, mountain lion appear large, snake freeze and retreat.',
    },
    {
      question: 'How to stay safe during lightning?',
      answer: 'When thunder roars go indoors. No place outside is safe during lightning. Avoid open fields hilltops and tall isolated trees. Stay away from water and metal objects. If caught outside crouch low with feet together minimize ground contact. Do not lie flat. Wait 30 minutes after last thunder before leaving shelter. Unplug electronics.',
      embedding: [], category: 'safety',
      offlineSummary: 'Lightning safety: go indoors, avoid open areas and tall trees, crouch low if caught outside.',
    },
    {
      question: 'How to prevent carbon monoxide poisoning?',
      answer: 'Never use generators grills or camp stoves indoors or in enclosed spaces. Install CO detectors on every level of home. Symptoms include headache dizziness nausea confusion. If you suspect CO poisoning go outside immediately and call emergency services. Do not run car in attached garage even with garage door open. Get fresh air right away.',
      embedding: [], category: 'safety',
      offlineSummary: 'CO poisoning: never burn fuel indoors, use CO detectors, symptoms headache nausea dizziness.',
    },
    {
      question: 'What to include in an emergency kit?',
      answer: 'Water one gallon per person per day for 3 days. Non-perishable food for 3 days. First aid kit. Flashlight and extra batteries. Whistle to signal for help. Dust masks and plastic sheeting. Moist towelettes and garbage bags. Wrench to turn off utilities. Manual can opener. Local maps. Cell phone with chargers and backup battery.',
      embedding: [], category: 'safety',
      offlineSummary: 'Emergency kit: water food first aid flashlight whistle maps phone charger for 3 days.',
    },
  ];

  const snippets = raw.map((s) => ({
    ...s,
    embedding: computeEmbedding(`${s.question} ${s.answer} ${s.category}`),
  }));

  await db.knowledgeSnippets.bulkAdd(snippets);
}
