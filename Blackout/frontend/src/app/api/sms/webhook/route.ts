// API Route: /api/sms/webhook
// Receives incoming SMS from Twilio (webhook endpoint)
// Configure this URL in your Twilio console: https://console.twilio.com
// Set as the "A MESSAGE COMES IN" webhook for your Twilio phone number

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const body = formData.get('Body') as string;
    const from = formData.get('From') as string;
    const messageSid = formData.get('MessageSid') as string;

    console.log('Incoming SMS:', { body, from, messageSid });

    // Parse the query from SMS
    const query = body?.replace('BLACKOUT_QUERY:', '').trim() || '';

    if (query) {
      // In production: process query through Gemini and send response SMS
      console.log('Processing SMS query:', query);
    }

    // Respond with TwiML (Twilio expects XML response)
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Blackout AI received your query. Processing...</Message>
</Response>`;

    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('SMS webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
