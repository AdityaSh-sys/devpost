import { NextRequest, NextResponse } from 'next/server';

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const SYSTEM_PROMPT = `You are Blackout AI, an intelligent assistant that works across all connectivity conditions — online, via SMS, and completely offline. You specialize in providing helpful, accurate, and concise answers.

Key traits:
- You are helpful, knowledgeable, and empathetic
- You provide clear, actionable information
- For emergency/medical queries, you prioritize safety and recommend professional help
- You format responses with clear structure using markdown
- You are aware that users may be in areas with limited connectivity

Always be concise but thorough. Use bullet points and numbered lists for clarity.`;

async function callGeminiDirect(query: string, history: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const contents = [
    { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: 'Understood. I am Blackout AI, ready to help across all connectivity conditions.' }] },
    ...history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })),
    { role: 'user', parts: [{ text: query }] },
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.7, topP: 0.95, topK: 40, maxOutputTokens: 2048 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${errorText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, history = [] } = body;
    const sessionId = req.headers.get('X-Session-Id') || '';

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    // Try proxying to FastAPI backend first
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const backendResponse = await fetch(`${backendUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({ query, history }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (backendResponse.ok) {
        const data = await backendResponse.json();
        return NextResponse.json({
          response: data.response,
          model: data.model || `Gemini ${GEMINI_MODEL}`,
        });
      }
    } catch {
      console.warn('FastAPI backend unreachable, falling back to direct Gemini call');
    }

    // Fallback: call Gemini directly
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return NextResponse.json({
        response: generateDemoResponse(query),
        model: 'Blackout Demo Mode',
      });
    }

    const text = await callGeminiDirect(query, history);
    return NextResponse.json({
      response: text,
      model: `Gemini ${GEMINI_MODEL}`,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function generateDemoResponse(query: string): string {
  const q = query.toLowerCase();

  if (q.includes('first aid') || q.includes('cut') || q.includes('wound') || q.includes('bleeding')) {
    return `🩹 **First Aid for Cuts & Wounds**

Here's what you should do:

1. **Stop the bleeding** — Apply firm, direct pressure with a clean cloth for at least 10 minutes
2. **Clean the wound** — Rinse gently with clean running water
3. **Apply antibiotic** — Use antibiotic ointment if available
4. **Cover it** — Use a sterile bandage or clean cloth
5. **Watch for infection** — Look for redness, swelling, warmth, or pus

⚠️ **Seek medical help if:**
- Bleeding doesn't stop after 10 minutes
- The cut is deep (more than ¼ inch) or gaping
- There's debris you can't remove
- It's been more than 5 years since your last tetanus shot

*— Blackout AI (Demo Mode)*`;
  }

  if (q.includes('water') || q.includes('purif') || q.includes('drink')) {
    return `💧 **Emergency Water Purification**

Multiple methods to make water safe:

**🔥 Boiling (Most Reliable)**
- Bring water to a rolling boil for 1 minute
- At high altitude (>6,500 ft): boil for 3 minutes

**🧪 Chemical Treatment**
- 2 drops of unscented household bleach per liter
- Wait 30 minutes before drinking

**☀️ Solar Disinfection (SODIS)**
- Fill clear plastic bottles with water
- Place in direct sunlight for 6+ hours

**🔬 Filtration**
- Use cloth to remove large particles first
- Commercial filters remove bacteria & parasites

**Pro tip:** Always filter before treating for best results!

*— Blackout AI (Demo Mode)*`;
  }

  if (q.includes('earthquake')) {
    return `🌍 **Earthquake Safety Guide**

**During an Earthquake:**
1. **DROP** — Get down on your hands and knees
2. **COVER** — Get under a sturdy desk or table
3. **HOLD ON** — Grip table legs until shaking stops

**If Indoors:**
- Stay away from windows, heavy furniture, and exterior walls
- Do NOT run outside during shaking
- If in bed, stay there and cover your head with a pillow

**If Outdoors:**
- Move to an open area away from buildings, trees, power lines
- Drop to the ground

**If Driving:**
- Pull over safely, stop, and set parking brake
- Stay in the vehicle until shaking stops

**After the Earthquake:**
- ✅ Check for injuries
- ✅ Expect aftershocks
- ✅ Check gas and water lines for damage
- ❌ Don't use elevators

*— Blackout AI (Demo Mode)*`;
  }

  if (q.includes('cpr') || q.includes('cardiac') || q.includes('heart')) {
    return `❤️ **CPR Guide (Cardiopulmonary Resuscitation)**

**Step 1:** Call emergency services immediately

**Step 2: Compressions**
- Place heel of hand on center of chest
- Push hard and fast: **2 inches deep**
- Rate: **100-120 compressions per minute**
- (Think: beat of "Stayin' Alive" by Bee Gees)

**Step 3: Rescue Breaths**
- After 30 compressions, give 2 rescue breaths
- Tilt head back, lift chin, pinch nose
- Blow for about 1 second per breath

**Step 4:** Continue 30:2 ratio until help arrives

**For Infants:**
- Use 2 fingers instead of full hand
- Compress 1.5 inches deep

⚠️ **Hands-only CPR** (no breaths) is better than no CPR at all!

*— Blackout AI (Demo Mode)*`;
  }

  if (q.includes('rescue') || q.includes('signal') || q.includes('help') || q.includes('sos')) {
    return `🆘 **How to Signal for Rescue**

**Visual Signals:**
- 🔥 **Three fires** in a triangle formation
- 🪞 **Mirror flash** toward aircraft or ships
- Create large **SOS** or **X** with rocks/logs (visible from air)
- Wear **bright colors** — avoid camouflage

**Audio Signals:**
- 📢 **Three whistle blasts**, repeated at intervals
- Any sound in **groups of three** = universal distress

**Night Signals:**
- 🔦 **Flashlight**: groups of 3 flashes
- Fire is your best friend at night

**Ground-to-Air Signals:**
| Symbol | Meaning |
|--------|---------|
| V | Need assistance |
| X | Need medical help |
| → | Traveling this direction |
| LL | All is well |

**Key Rule:** Everything in **groups of three** signals distress!

*— Blackout AI (Demo Mode)*`;
  }

  return `🌑 **Blackout AI Response**

Thank you for your question! I'm currently running in **Demo Mode** (no API key configured).

Here's what I can help with:
- 🩹 **First Aid** — Wound care, CPR, emergency medical guidance
- 💧 **Survival** — Water purification, shelter building, fire starting
- 🌍 **Emergencies** — Earthquake, flood, storm safety procedures
- 🆘 **Rescue** — Signaling techniques, navigation basics

**To enable full AI responses:**
1. Get a Gemini API key from Google AI Studio
2. Set it as \`GEMINI_API_KEY\` in your environment
3. Restart the application

**Try asking:** "What is first aid for a deep cut?" or "How to signal for rescue?"

*— Blackout AI (Demo Mode)*`;
}
