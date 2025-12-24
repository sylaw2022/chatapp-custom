import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { phoneNumber, message, imageUrl } = body

    if (!phoneNumber || !message) {
      return NextResponse.json(
        { error: 'Phone number and message are required' },
        { status: 400 }
      )
    }

    // Check if Singtel SMS API is configured
    const apiKey = process.env.SINGTEL_SMS_API_KEY
    const apiUrl = process.env.SINGTEL_SMS_API_URL || 'https://api.singtel.com/sms/send'
    const fromNumber = process.env.SINGTEL_SMS_FROM_NUMBER

    if (!apiKey) {
      return NextResponse.json(
        { 
          error: 'SMS service not configured. Please set up Singtel SMS API credentials.',
          fallback: true 
        },
        { status: 503 }
      )
    }

    // Format phone number (ensure it starts with +)
    let formattedPhone = phoneNumber.replace(/\D/g, '')
    if (!formattedPhone.startsWith('+')) {
      // If no country code, add +65 for Singapore (common for Singtel)
      // You can modify this based on your needs
      formattedPhone = '+65' + formattedPhone
    }

    // Prepare request payload for Singtel SMS API
    const payload: any = {
      to: formattedPhone,
      message: message
    }

    // Add from number if configured
    if (fromNumber) {
      payload.from = fromNumber
    }

    // Add image URL if provided (MMS support)
    if (imageUrl && imageUrl.startsWith('http')) {
      payload.mediaUrl = imageUrl
    }

    // Send SMS via Singtel API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const responseData = await response.json()

    if (!response.ok) {
      throw new Error(responseData.error || responseData.message || `HTTP ${response.status}: ${response.statusText}`)
    }

    return NextResponse.json({
      success: true,
      messageId: responseData.messageId || responseData.id || 'sent',
      status: responseData.status || 'sent'
    })

  } catch (error: any) {
    console.error('SMS sending error:', error)
    return NextResponse.json(
      { 
        error: error.message || 'Failed to send SMS',
        details: error.code || 'UNKNOWN_ERROR'
      },
      { status: 500 }
    )
  }
}

