import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const lat = searchParams.get('lat')
    const lon = searchParams.get('lon')
    const radius = searchParams.get('radius') || '2000'
    const categoryId = searchParams.get('categoryId')
    const query = searchParams.get('query')

    if (!lat || !lon) {
      return NextResponse.json(
        { error: 'Latitude and longitude are required' },
        { status: 400 }
      )
    }

    // Check if Foursquare API key is configured
    // Priority: Environment variable > Hardcoded fallback (for development)
    const apiKey = process.env.NEXT_PUBLIC_FOURSQUARE_API_KEY || 
                   process.env.FOURSQUARE_API_KEY || 
                   '2GW1UJER5JMYYDFMFRLBSNKKZ1LA3AS40BORE24TB0M0C5IG'

    if (!apiKey) {
      return NextResponse.json(
        { error: 'Foursquare API key not configured', fallback: true },
        { status: 503 }
      )
    }

    // Build Foursquare API URL
    let url = `https://api.foursquare.com/v3/places/search?ll=${lat},${lon}&radius=${radius}&limit=50`
    
    if (categoryId) {
      url += `&categories=${categoryId}`
    }
    
    if (query) {
      url += `&query=${encodeURIComponent(query)}`
    }

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': apiKey
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Foursquare API error: ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()
    
    return NextResponse.json({
      success: true,
      results: data.results || []
    })

  } catch (error: any) {
    console.error('Restaurant API error:', error)
    return NextResponse.json(
      { 
        error: error.message || 'Failed to fetch restaurants',
        fallback: true
      },
      { status: 500 }
    )
  }
}

