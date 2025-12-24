'use client'
import { useState, useEffect } from 'react'
import { ArrowLeft, UtensilsCrossed, MapPin, Loader2, Search, Star, Filter, X } from 'lucide-react'

interface Restaurant {
  id: string
  name: string
  rating: number
  distance: number
  address: string
  cuisine?: string
  lat: number
  lon: number
  tags?: Record<string, string>
}

interface RestaurantSearchProps {
  currentUser: any
  onBack: () => void
}

type FoodType = 'all' | 'italian' | 'chinese' | 'japanese' | 'indian' | 'thai' | 'korean' | 'mexican' | 'american' | 'french' | 'pizza' | 'burger' | 'sushi' | 'seafood' | 'vegetarian' | 'fast_food' | 'cafe' | 'bakery'

const FOOD_TYPES: { value: FoodType; label: string; keywords: string[] }[] = [
  { value: 'all', label: 'All', keywords: [] },
  { value: 'italian', label: 'Italian', keywords: ['italian', 'pasta', 'pizza'] },
  { value: 'chinese', label: 'Chinese', keywords: ['chinese', 'dim sum', 'cantonese', 'szechuan'] },
  { value: 'japanese', label: 'Japanese', keywords: ['japanese', 'sushi', 'ramen', 'izakaya'] },
  { value: 'indian', label: 'Indian', keywords: ['indian', 'curry', 'tandoori', 'biryani'] },
  { value: 'thai', label: 'Thai', keywords: ['thai', 'pad thai', 'tom yum'] },
  { value: 'korean', label: 'Korean', keywords: ['korean', 'bbq', 'kimchi'] },
  { value: 'mexican', label: 'Mexican', keywords: ['mexican', 'taco', 'burrito', 'tex-mex'] },
  { value: 'american', label: 'American', keywords: ['american', 'steakhouse', 'bbq'] },
  { value: 'french', label: 'French', keywords: ['french', 'bistro', 'brasserie'] },
  { value: 'pizza', label: 'Pizza', keywords: ['pizza', 'pizzeria'] },
  { value: 'burger', label: 'Burger', keywords: ['burger', 'hamburger'] },
  { value: 'sushi', label: 'Sushi', keywords: ['sushi', 'sashimi'] },
  { value: 'seafood', label: 'Seafood', keywords: ['seafood', 'fish'] },
  { value: 'vegetarian', label: 'Vegetarian', keywords: ['vegetarian', 'vegan'] },
  { value: 'fast_food', label: 'Fast Food', keywords: ['fast_food', 'fast food'] },
  { value: 'cafe', label: 'Cafe', keywords: ['cafe', 'coffee', 'espresso'] },
  { value: 'bakery', label: 'Bakery', keywords: ['bakery', 'pastry', 'bread'] }
]

export default function RestaurantSearch({ currentUser, onBack }: RestaurantSearchProps) {
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedFoodType, setSelectedFoodType] = useState<FoodType>('all')
  const [radius, setRadius] = useState(2000) // Search radius in meters (2km default)

  useEffect(() => {
    // Request location on mount
    getCurrentLocation()
  }, [])

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser')
      return
    }

    setLoading(true)
    setError(null)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lon: position.coords.longitude
        })
        setLoading(false)
      },
      (err) => {
        setError('Failed to get location: ' + err.message)
        setLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    )
  }

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371 // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Reverse geocode coordinates to get address
  const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'RestaurantSearchApp/1.0'
          }
        }
      )
      const data = await response.json()
      
      if (data.address) {
        const addr = data.address
        const parts = []
        if (addr.house_number) parts.push(addr.house_number)
        if (addr.road) parts.push(addr.road)
        if (addr.suburb) parts.push(addr.suburb)
        if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village)
        if (addr.state) parts.push(addr.state)
        if (addr.country) parts.push(addr.country)
        return parts.join(', ') || data.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`
      }
      return data.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    } catch (err) {
      console.error('Reverse geocoding error:', err)
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    }
  }

  // Search restaurants using Foursquare Places API (primary) or Overpass API (fallback)
  const searchRestaurants = async (foodType?: FoodType, query?: string) => {
    if (!location) {
      setError('Location not available')
      return
    }

    setSearching(true)
    setError(null)

    try {
      // Try Foursquare Places API first (via API route)
      try {
        const restaurants = await searchFoursquare(foodType, query)
        if (restaurants.length > 0) {
          setRestaurants(restaurants)
          setSearching(false)
          return
        }
      } catch (foursquareError) {
        console.warn('Foursquare API failed, falling back to Overpass:', foursquareError)
        // Fall through to Overpass API
      }

      // Fallback to Overpass API (no API key required)
      const restaurants = await searchOverpass(foodType, query)
      setRestaurants(restaurants)
    } catch (err: any) {
      console.error('Restaurant search error:', err)
      setError('Failed to search restaurants: ' + (err.message || 'Unknown error'))
      setRestaurants([])
    } finally {
      setSearching(false)
    }
  }

  // Search using Foursquare Places API (via API route)
  const searchFoursquare = async (foodType?: FoodType, query?: string): Promise<Restaurant[]> => {
    // Map food types to Foursquare category IDs
    const categoryMap: Record<string, string> = {
      'italian': '4bf58dd8d48988d110941735',
      'chinese': '4bf58dd8d48988d1e0931735',
      'japanese': '4bf58dd8d48988d1d2941735',
      'indian': '4bf58dd8d48988d10f941735',
      'thai': '4bf58dd8d48988d149941735',
      'korean': '4bf58dd8d48988d113941735',
      'mexican': '4bf58dd8d48988d1c1941735',
      'american': '4bf58dd8d48988d14e941735',
      'french': '4bf58dd8d48988d10c941735',
      'pizza': '4bf58dd8d48988d1ca941735',
      'burger': '4bf58dd8d48988d16c941735',
      'sushi': '4bf58dd8d48988d1d2941735',
      'seafood': '4bf58dd8d48988d1ce941735',
      'vegetarian': '4bf58dd8d48988d1d3941735',
      'fast_food': '4bf58dd8d48988d16e941735',
      'cafe': '4bf58dd8d48988d1e0931735',
      'bakery': '4bf58dd8d48988d16a941735'
    }

    const categoryId = foodType && foodType !== 'all' ? categoryMap[foodType] : undefined
    const searchQuery = query || (foodType && foodType !== 'all' ? FOOD_TYPES.find(ft => ft.value === foodType)?.label : 'restaurant')
    
    // Call our API route
    let url = `/api/restaurants?lat=${location!.lat}&lon=${location!.lon}&radius=${radius}`
    
    if (categoryId) {
      url += `&categoryId=${categoryId}`
    }
    
    if (searchQuery) {
      url += `&query=${encodeURIComponent(searchQuery)}`
    }

    const response = await fetch(url)

    if (!response.ok) {
      const data = await response.json()
      if (data.fallback) {
        throw new Error('Foursquare API not configured')
      }
      throw new Error(`API error: ${response.statusText}`)
    }

    const data = await response.json()
    const results = data.results || []

    if (results.length === 0) {
      throw new Error('No results from Foursquare')
    }

    // Process Foursquare results
    const restaurants: Restaurant[] = results.map((place: any) => {
      const distance = calculateDistance(location!.lat, location!.lon, place.geocodes.main.latitude, place.geocodes.main.longitude)
      
      // Extract cuisine from categories
      const primaryCategory = place.categories?.[0]
      const cuisine = primaryCategory?.name?.toLowerCase() || ''
      
      // Get address
      const address = place.location?.formatted_address || 
                     `${place.location?.address || ''}, ${place.location?.locality || ''}, ${place.location?.region || ''}`.trim() ||
                     `${place.geocodes.main.latitude.toFixed(6)}, ${place.geocodes.main.longitude.toFixed(6)}`

      return {
        id: place.fsq_id,
        name: place.name,
        rating: (place.rating || 0) / 2, // Foursquare ratings are 0-10, convert to 0-5
        distance: Math.round(distance * 10) / 10,
        address,
        cuisine: cuisine || undefined,
        lat: place.geocodes.main.latitude,
        lon: place.geocodes.main.longitude,
        tags: place.categories
      }
    })

    // Apply additional filters
    let filteredRestaurants = restaurants

    // Filter by food type keywords if not already filtered by category
    if (foodType && foodType !== 'all' && !categoryMap[foodType]) {
      const foodTypeConfig = FOOD_TYPES.find(ft => ft.value === foodType)
      if (foodTypeConfig) {
        filteredRestaurants = filteredRestaurants.filter(restaurant => {
          const cuisine = (restaurant.cuisine || '').toLowerCase()
          const name = restaurant.name.toLowerCase()
          return foodTypeConfig.keywords.some(keyword => 
            cuisine.includes(keyword) || name.includes(keyword)
          )
        })
      }
    }

    // Filter by search query if provided
    if (query && query.trim()) {
      const queryLower = query.toLowerCase()
      filteredRestaurants = filteredRestaurants.filter(restaurant =>
        restaurant.name.toLowerCase().includes(queryLower) ||
        restaurant.cuisine?.toLowerCase().includes(queryLower) ||
        restaurant.address.toLowerCase().includes(queryLower)
      )
    }

    // Sort by distance
    filteredRestaurants.sort((a, b) => a.distance - b.distance)

    return filteredRestaurants.slice(0, 50)
  }

  // Search using Overpass API (fallback, no API key required)
  const searchOverpass = async (foodType?: FoodType, query?: string): Promise<Restaurant[]> => {
    let overpassQuery = `
      [out:json][timeout:25];
      (
        node["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$"]["name"](around:${radius},${location!.lat},${location!.lon});
        way["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream)$"]["name"](around:${radius},${location!.lat},${location!.lon});
      );
      out center meta;
    `

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(overpassQuery)}`
    })

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.statusText}`)
    }

    const data = await response.json()
    const elements = data.elements || []

    // Process restaurants
    const restaurantPromises = elements.map(async (element: any) => {
      const tags = element.tags || {}
      const name = tags.name || 'Unnamed Restaurant'
      const lat = element.lat || element.center?.lat
      const lon = element.lon || element.center?.lon

      if (!lat || !lon) return null

      const distance = calculateDistance(location!.lat, location!.lon, lat, lon)
      const address = await reverseGeocode(lat, lon)

      // Determine cuisine type from tags
      const cuisine = tags.cuisine || tags['cuisine:en'] || ''
      const amenity = tags.amenity || ''
      
      // Extract cuisine from various tag fields
      let cuisineType = cuisine.toLowerCase()
      if (tags.diet && tags.diet.includes('vegetarian')) cuisineType = 'vegetarian'
      if (amenity === 'fast_food') cuisineType = 'fast_food'
      if (amenity === 'cafe') cuisineType = 'cafe'
      if (tags.shop === 'bakery') cuisineType = 'bakery'

      return {
        id: `${element.type}_${element.id}`,
        name,
        rating: Math.random() * 1.5 + 3.5, // Mock rating (4.0-5.0)
        distance: Math.round(distance * 10) / 10, // Round to 1 decimal
        address,
        cuisine: cuisineType || undefined,
        lat,
        lon,
        tags
      }
    })

    let allRestaurants = (await Promise.all(restaurantPromises)).filter((r): r is Restaurant => r !== null)

    // Filter by food type
    if (foodType && foodType !== 'all') {
      const foodTypeConfig = FOOD_TYPES.find(ft => ft.value === foodType)
      if (foodTypeConfig) {
        allRestaurants = allRestaurants.filter(restaurant => {
          const cuisine = (restaurant.cuisine || '').toLowerCase()
          const name = restaurant.name.toLowerCase()
          const tagsStr = JSON.stringify(restaurant.tags || {}).toLowerCase()
          
          return foodTypeConfig.keywords.some(keyword => 
            cuisine.includes(keyword) || 
            name.includes(keyword) || 
            tagsStr.includes(keyword)
          )
        })
      }
    }

    // Filter by search query if provided
    if (query && query.trim()) {
      const queryLower = query.toLowerCase()
      allRestaurants = allRestaurants.filter(restaurant =>
        restaurant.name.toLowerCase().includes(queryLower) ||
        restaurant.cuisine?.toLowerCase().includes(queryLower) ||
        restaurant.address.toLowerCase().includes(queryLower)
      )
    }

    // Sort by distance
    allRestaurants.sort((a, b) => a.distance - b.distance)

    // Limit to top 50 results
    return allRestaurants.slice(0, 50)
  }

  const handleSearch = async () => {
    if (!location) {
      alert('Please wait for location to be detected')
      return
    }
    await searchRestaurants(selectedFoodType, searchQuery.trim() || undefined)
  }

  const handleFoodTypeChange = async (foodType: FoodType) => {
    setSelectedFoodType(foodType)
    if (location) {
      await searchRestaurants(foodType, searchQuery.trim() || undefined)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-orange-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-md p-4 flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-2">
          <UtensilsCrossed className="text-orange-600" size={28} />
          <h1 className="text-2xl font-bold text-gray-800">Restaurant Search</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full">
        <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 space-y-6">
          {/* Location Status */}
          <div className="space-y-2">
            {loading && (
              <div className="flex items-center gap-2 text-gray-600">
                <Loader2 className="animate-spin text-orange-600" size={20} />
                <span>Getting your location...</span>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-600 text-sm">{error}</p>
                <button
                  onClick={getCurrentLocation}
                  className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
                >
                  Try again
                </button>
              </div>
            )}

            {location && !loading && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-center gap-2">
                <MapPin className="text-orange-600" size={20} />
                <span className="text-sm text-gray-700">
                  Location: {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
                </span>
              </div>
            )}
          </div>

          {/* Search Bar */}
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-800">Find Restaurants</h2>
            
            {/* Search Input */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or cuisine (e.g., Italian, Pizza)"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={!location || searching}
                className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-semibold flex items-center gap-2"
              >
                {searching ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    <span>Searching...</span>
                  </>
                ) : (
                  <>
                    <Search size={20} />
                    <span>Search</span>
                  </>
                )}
              </button>
            </div>

            {/* Food Type Filter */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Filter className="text-orange-600" size={20} />
                <h3 className="text-lg font-semibold text-gray-800">Filter by Food Type</h3>
                {selectedFoodType !== 'all' && (
                  <button
                    onClick={() => handleFoodTypeChange('all')}
                    className="ml-auto text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1"
                  >
                    <X size={16} />
                    Clear Filter
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {FOOD_TYPES.map((foodType) => (
                  <button
                    key={foodType.value}
                    onClick={() => handleFoodTypeChange(foodType.value)}
                    disabled={searching}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      selectedFoodType === foodType.value
                        ? 'bg-orange-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {foodType.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Radius */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">
                Search Radius: {radius / 1000} km
              </label>
              <input
                type="range"
                min="500"
                max="5000"
                step="500"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>0.5 km</span>
                <span>5 km</span>
              </div>
            </div>

            {/* Quick Search Button */}
            {!searchQuery.trim() && (
              <button
                onClick={() => searchRestaurants(selectedFoodType)}
                disabled={!location || searching}
                className="w-full py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-semibold"
              >
                Find Nearby Restaurants
              </button>
            )}
          </div>

          {/* Results */}
          {searching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-orange-600" size={32} />
              <span className="ml-3 text-gray-600">Searching nearby restaurants...</span>
            </div>
          )}

          {!searching && restaurants.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-800">
                  Found {restaurants.length} restaurant{restaurants.length !== 1 ? 's' : ''}
                  {selectedFoodType !== 'all' && (
                    <span className="text-sm font-normal text-gray-500 ml-2">
                      (filtered by {FOOD_TYPES.find(ft => ft.value === selectedFoodType)?.label})
                    </span>
                  )}
                </h3>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {restaurants.map((restaurant) => (
                  <div
                    key={restaurant.id}
                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow bg-white"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1">
                        <h4 className="font-bold text-lg text-gray-800">{restaurant.name}</h4>
                        {restaurant.cuisine && (
                          <p className="text-sm text-gray-500 capitalize mt-1">{restaurant.cuisine.replace(/_/g, ' ')}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-4">
                        <Star className="text-yellow-500 fill-yellow-500" size={18} />
                        <span className="font-semibold text-gray-700">{restaurant.rating.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <MapPin size={16} className="text-orange-600" />
                        <span className="font-medium">{restaurant.distance} km away</span>
                      </div>
                      <p className="text-gray-600">{restaurant.address}</p>
                      <a
                        href={`https://www.google.com/maps?q=${restaurant.lat},${restaurant.lon}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-600 hover:text-orange-700 text-sm font-medium inline-flex items-center gap-1 w-fit"
                      >
                        <MapPin size={14} />
                        Open in Maps
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!searching && restaurants.length === 0 && location && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-yellow-800 text-sm">
                No restaurants found. Try adjusting your search radius or food type filter.
              </p>
            </div>
          )}

          {/* Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            <p className="text-blue-800 text-sm">
              <strong>Note:</strong> Restaurant search uses Foursquare Places API (if configured) or OpenStreetMap data as fallback. 
              Results are based on your current GPS location. You can filter by food type or search by name/cuisine. 
              Adjust the search radius to find restaurants further away.
            </p>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-2">
              <p className="text-yellow-800 text-xs">
                <strong>💡 Recommended:</strong> For better results with ratings and photos, get a free Foursquare API key at{' '}
                <a 
                  href="https://developer.foursquare.com/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline hover:text-yellow-900 font-medium"
                >
                  developer.foursquare.com
                </a>
                {' '}and add <code className="bg-yellow-100 px-1 rounded text-xs">FOURSQUARE_API_KEY</code> or <code className="bg-yellow-100 px-1 rounded text-xs">NEXT_PUBLIC_FOURSQUARE_API_KEY</code> to your environment variables.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

