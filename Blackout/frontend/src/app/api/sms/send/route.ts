// API Route: /api/sms/send
// Handles SMS sending via Twilio for Mode B (SMS Fallback)

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query } = body;

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    // Read Twilio config at runtime
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    const fromNumber = process.env.TWILIO_PHONE_NUMBER || '';
    const toNumber = process.env.SMS_RECIPIENT || '';

    // If Twilio is not configured, return demo response
    if (!accountSid || !authToken) {
      return NextResponse.json({
        response: `📱 **SMS Mode (Demo)**\n\nYour query has been formatted for SMS delivery:\n\n> "${query.substring(0, 160)}"\n\n⚠️ Twilio is not configured. To enable real SMS:\n1. Set TWILIO_ACCOUNT_SID\n2. Set TWILIO_AUTH_TOKEN\n3. Set TWILIO_PHONE_NUMBER\n4. Set SMS_RECIPIENT\n\nIn production, this message would be sent via cellular network and a response would arrive via SMS.`,
        status: 'demo',
        messageId: `demo-${Date.now()}`,
      });
    }

    // Send SMS via Twilio
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // Format query for SMS (160 char limit)
    const smsBody = `BLACKOUT_QUERY: ${query.substring(0, 140)}`;

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: toNumber,
        From: fromNumber,
        Body: smsBody,
      }),
    });

    if (!response.ok) {
      throw new Error(`Twilio error: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json({
      response: `📱 **SMS Sent Successfully**\n\nYour query has been sent via SMS. Response will arrive shortly.\n\n**Message SID:** ${data.sid}\n**Status:** ${data.status}`,
      status: 'sent',
      messageId: data.sid,
    });
  } catch (error) {
    console.error('SMS API error:', error);
    return NextResponse.json(
      { error: 'Failed to send SMS' },
      { status: 500 }
    );
  }
}
