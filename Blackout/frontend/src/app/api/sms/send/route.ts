import { NextRequest, NextResponse } from 'next/server';

async function sendSmsViaTwilio(toNumber: string, body: string): Promise<{ sid: string; status: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || '';

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: toNumber,
      From: fromNumber,
      Body: body.substring(0, 1600),
    }),
  });

  if (!response.ok) {
    throw new Error(`Twilio error: ${response.status}`);
  }

  const data = await response.json();
  return { sid: data.sid, status: data.status };
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const { query, phoneNumber } = json;

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';

    if (!accountSid || !authToken) {
      return NextResponse.json({
        status: 'demo',
        message: 'Twilio not configured',
      });
    }

    const result = await sendSmsViaTwilio(
      phoneNumber || process.env.SMS_RECIPIENT || '',
      `BLACKOUT AI: ${query}`
    );

    return NextResponse.json({
      status: 'sent',
      messageId: result.sid,
    });
  } catch (error) {
    console.error('SMS API error:', error);
    return NextResponse.json({ error: 'Failed to send SMS' }, { status: 500 });
  }
}
