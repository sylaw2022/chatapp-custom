'use client'
import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Navigation as NavIcon, MapPin, Loader2, Route, Clock, Navigation2, Crosshair, Car, Bus, Train } from 'lucide-react'
import dynamic from 'next/dynamic'

// Dynamically import Leaflet to avoid SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false })
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false })
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false })
const Popup = dynamic(() => import('react-leaflet').then(mod => mod.Popup), { ssr: false })
const Polyline = dynamic(() => import('react-leaflet').then(mod => mod.Polyline), { ssr: false })
const Circle = dynamic(() => import('react-leaflet').then(mod => mod.Circle), { ssr: false })

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix for default marker icons in Next.js
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  })
}

// Create custom icon for current location (green)
const createCurrentLocationIcon = () => {
  if (typeof window === 'undefined') return undefined
  return L.divIcon({
    className: 'current-location-marker',
    html: `
      <div style="
        width: 30px;
        height: 30px;
        background-color: #10b981;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          width: 12px;
          height: 12px;
          background-color: white;
          border-radius: 50%;
        "></div>
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15]
  })
}

interface NavigationProps {
  currentUser: any
  onBack: () => void
}

interface RouteStep {
  distance: number
  duration: number
  instruction: string
  type: number
}

interface RouteInfo {
  distance: number // in meters
  duration: number // in seconds
  steps: RouteStep[]
  geometry: number[][] // coordinates [lon, lat]
}

type TransportationMode = 'car' | 'bus' | 'train'

export default function Navigation({ currentUser, onBack }: NavigationProps) {
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null)
  const [currentAddress, setCurrentAddress] = useState<string>('')
  const [loadingAddress, setLoadingAddress] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [destination, setDestination] = useState('')
  const [destinationCoords, setDestinationCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [navigating, setNavigating] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [transportMode, setTransportMode] = useState<TransportationMode>('car')
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    // Request location on mount
    getCurrentLocation()
  }, [])

  // Update map view when location changes
  useEffect(() => {
    if (location && mapRef.current) {
      mapRef.current.setView([location.lat, location.lon], 15, {
        animate: true,
        duration: 0.5
      })
      // Open popup when location is first set
      setTimeout(() => {
        if (markerRef.current && currentAddress) {
          markerRef.current.openPopup()
        }
      }, 600)
    }
  }, [location, currentAddress])

  // Force map to invalidate size when container is ready
  useEffect(() => {
    if (mapRef.current && location) {
      setTimeout(() => {
        mapRef.current?.invalidateSize()
      }, 100)
    }
  }, [location])

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser')
      return
    }

    setLoading(true)
    setError(null)

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        // Get exact coordinates from GPS
        const coords = {
          lat: position.coords.latitude,
          lon: position.coords.longitude
        }
        
        // Set location first to show marker on map immediately
        setLocation(coords)
        setLocationAccuracy(position.coords.accuracy) // Store accuracy in meters
        setLoading(false)
        
        // Center map on current location with animation (using exact GPS coordinates)
        if (mapRef.current) {
          mapRef.current.setView([coords.lat, coords.lon], 15, {
            animate: true,
            duration: 0.5
          })
        }
        
        // Reverse geocode using the EXACT same coordinates that are displayed on the map
        // Pass accuracy to help determine address precision
        // This ensures the address matches the map location
        const address = await reverseGeocode(coords.lat, coords.lon, position.coords.accuracy)
        setCurrentAddress(address)
        
        // Open popup after address is loaded
        setTimeout(() => {
          if (markerRef.current) {
            markerRef.current.openPopup()
          }
        }, 600)
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

  // Reverse geocode coordinates to address with high accuracy
  const reverseGeocode = async (lat: number, lon: number, accuracy?: number): Promise<string> => {
    try {
      setLoadingAddress(true)
      
      // Use maximum zoom level (18) for highest precision
      // Add layer parameter to get the most specific address
      let url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&extratags=1&namedetails=1&layer=address`
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'SYLAW Navigation App',
          'Accept-Language': 'en'
        }
      })
      
      if (!response.ok) {
        throw new Error('Reverse geocoding failed')
      }

      let data = await response.json()
      
      // If accuracy is poor (>50m), try without layer restriction for more general address
      if (accuracy && accuracy > 50 && (!data.address || !data.address.road)) {
        const generalResponse = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`,
          {
            headers: {
              'User-Agent': 'SYLAW Navigation App',
              'Accept-Language': 'en'
            }
          }
        )
        if (generalResponse.ok) {
          const generalData = await generalResponse.json()
          if (generalData && generalData.address) {
            data = generalData
          }
        }
      }
      
      // Verify the returned coordinates match what we requested
      if (data && data.lat && data.lon) {
        const returnedLat = parseFloat(data.lat)
        const returnedLon = parseFloat(data.lon)
        const latDiff = Math.abs(returnedLat - lat)
        const lonDiff = Math.abs(returnedLon - lon)
        
        // Calculate distance difference in meters
        // 1 degree latitude ≈ 111,320 meters
        const latDiffMeters = latDiff * 111320
        const lonDiffMeters = lonDiff * 111320 * Math.cos(lat * Math.PI / 180)
        const totalDiffMeters = Math.sqrt(latDiffMeters * latDiffMeters + lonDiffMeters * lonDiffMeters)
        
        // If coordinates differ significantly (more than 20m), try again with exact coordinates
        if (totalDiffMeters > 20) {
          console.warn('Address coordinates mismatch:', { 
            requested: { lat, lon }, 
            returned: { lat: returnedLat, lon: returnedLon },
            difference: `${totalDiffMeters.toFixed(1)}m`
          })
          
          // Try one more time with exact coordinates and no layer restriction
          try {
            const retryResponse = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
              {
                headers: {
                  'User-Agent': 'SYLAW Navigation App',
                  'Accept-Language': 'en'
                }
              }
            )
            if (retryResponse.ok) {
              const retryData = await retryResponse.json()
              if (retryData && retryData.lat && retryData.lon) {
                const retryLat = parseFloat(retryData.lat)
                const retryLon = parseFloat(retryData.lon)
                const retryLatDiff = Math.abs(retryLat - lat)
                const retryLonDiff = Math.abs(retryLon - lon)
                const retryLatDiffMeters = retryLatDiff * 111320
                const retryLonDiffMeters = retryLonDiff * 111320 * Math.cos(lat * Math.PI / 180)
                const retryTotalDiffMeters = Math.sqrt(retryLatDiffMeters * retryLatDiffMeters + retryLonDiffMeters * retryLonDiffMeters)
                
                // Use retry data if it's more accurate
                if (retryTotalDiffMeters < totalDiffMeters) {
                  data = retryData
                }
              }
            }
          } catch (retryError) {
            console.warn('Retry geocoding failed:', retryError)
          }
        }
      }
      
      if (data && data.address) {
        const addr = data.address
        
        // Prefer display_name if available and coordinates match well
        if (data.display_name && data.display_name.length > 0) {
          // Verify coordinates match
          if (data.lat && data.lon) {
            const returnedLat = parseFloat(data.lat)
            const returnedLon = parseFloat(data.lon)
            const latDiff = Math.abs(returnedLat - lat)
            const lonDiff = Math.abs(returnedLon - lon)
            
            // If coordinates are very close (within 10m), use display_name
            const latDiffMeters = latDiff * 111320
            const lonDiffMeters = lonDiff * 111320 * Math.cos(lat * Math.PI / 180)
            const totalDiffMeters = Math.sqrt(latDiffMeters * latDiffMeters + lonDiffMeters * lonDiffMeters)
            
            if (totalDiffMeters < 10) {
              let displayName = data.display_name
              // Enhance display_name with block number if it exists and isn't already in the name
              if (data.address && data.address.block && !displayName.includes(`Block ${data.address.block}`) && !displayName.includes(data.address.block)) {
                // Insert block number at the beginning
                displayName = `Block ${data.address.block}, ${displayName}`
              }
              const cleanedName = displayName.replace(/,\s*[A-Z]{2}\s*$/, '')
              setLoadingAddress(false)
              return cleanedName
            }
          } else {
            // If no coordinates in response, still use display_name but enhance with block number
            let displayName = data.display_name
            if (data.address && data.address.block && !displayName.includes(`Block ${data.address.block}`) && !displayName.includes(data.address.block)) {
              displayName = `Block ${data.address.block}, ${displayName}`
            }
            const cleanedName = displayName.replace(/,\s*[A-Z]{2}\s*$/, '')
            setLoadingAddress(false)
            return cleanedName
          }
        }
        
        // Build a readable address from the response
        const addressParts = []
        
        // Build address in logical order: block, unit/house number, street, then area, city, state, country
        // Block number (common in some regions)
        if (addr.block) {
          addressParts.push(`Block ${addr.block}`)
        }
        // Building number/name
        if (addr.building) {
          addressParts.push(addr.building)
        }
        // House/Unit number
        if (addr.house_number) {
          addressParts.push(addr.house_number)
        }
        // Unit number (apartments/flats)
        if (addr.unit) {
          addressParts.push(`Unit ${addr.unit}`)
        }
        // Level/Floor
        if (addr.level) {
          addressParts.push(`Level ${addr.level}`)
        }
        // Street/Road name
        if (addr.road) {
          addressParts.push(addr.road)
        }
        // Neighbourhood/Suburb
        if (addr.neighbourhood) {
          addressParts.push(addr.neighbourhood)
        } else if (addr.suburb) {
          addressParts.push(addr.suburb)
        }
        // City/Town/Village
        if (addr.city || addr.town || addr.village) {
          addressParts.push(addr.city || addr.town || addr.village)
        }
        // State/Province
        if (addr.state) {
          addressParts.push(addr.state)
        }
        // Country
        if (addr.country) {
          addressParts.push(addr.country)
        }
        
        const formattedAddress = addressParts.length > 0 
          ? addressParts.join(', ')
          : `${lat.toFixed(6)}, ${lon.toFixed(6)}`
        
        setLoadingAddress(false)
        return formattedAddress
      }
      
      // If no address data, return coordinates
      setLoadingAddress(false)
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    } catch (error) {
      console.error('Reverse geocoding error:', error)
      setLoadingAddress(false)
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    }
  }

  // Geocode destination address to coordinates
  const geocodeAddress = async (address: string): Promise<{ lat: number; lon: number } | null> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
        {
          headers: {
            'User-Agent': 'SYLAW Navigation App'
          }
        }
      )
      
      if (!response.ok) {
        throw new Error('Geocoding failed')
      }

      const data = await response.json()
      
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon)
        }
      }
      
      return null
    } catch (error) {
      console.error('Geocoding error:', error)
      throw error
    }
  }

  // Get route from current location to destination
  const getRoute = async (start: { lat: number; lon: number }, end: { lat: number; lon: number }, mode: TransportationMode = transportMode) => {
    try {
      // Using OpenRouteService API with provided API key
      const apiKey = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjU2MjNmODdjZTRkNzRlYjA5OTE0M2UwZTQ0ZmYwZmIxIiwiaCI6Im11cm11cjY0In0='
      
      // Select routing profile based on transportation mode
      let profile = 'driving-car' // default
      if (mode === 'car') {
        profile = 'driving-car'
      } else if (mode === 'bus' || mode === 'train') {
        profile = 'public-transport'
      }
      
      const response = await fetch(
        `https://api.openrouteservice.org/v2/directions/${profile}?api_key=${apiKey}&start=${start.lon},${start.lat}&end=${end.lon},${end.lat}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8'
          }
        }
      )

      if (!response.ok) {
        // Fallback: Create a simple straight-line route if API fails
        console.warn('OpenRouteService API failed, using fallback route')
        return createFallbackRoute(start, end, mode)
      }

      const data = await response.json()
      return parseRouteData(data)
    } catch (error) {
      console.error('Routing error:', error)
      // Fallback to simple route
      return createFallbackRoute(start, end, mode)
    }
  }

  // Create a simple fallback route (straight line) when API is unavailable
  const createFallbackRoute = (start: { lat: number; lon: number }, end: { lat: number; lon: number }, mode: TransportationMode = transportMode): RouteInfo => {
    // Calculate distance using Haversine formula
    const R = 6371000 // Earth radius in meters
    const dLat = (end.lat - start.lat) * Math.PI / 180
    const dLon = (end.lon - start.lon) * Math.PI / 180
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(start.lat * Math.PI / 180) * Math.cos(end.lat * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const distance = R * c

    // Estimate duration based on transportation mode
    let avgSpeed = 50 // km/h for car (default)
    if (mode === 'car') {
      avgSpeed = 50 // km/h
    } else if (mode === 'bus') {
      avgSpeed = 30 // km/h
    } else if (mode === 'train') {
      avgSpeed = 80 // km/h
    }
    const duration = (distance / 1000 / avgSpeed) * 3600

    return {
      distance: distance,
      duration: duration,
        steps: [
          {
            distance: distance,
            duration: duration,
            instruction: `Navigate to ${destination} by ${mode === 'car' ? 'car' : mode === 'bus' ? 'bus' : 'train'}`,
            type: 0
          }
        ],
      geometry: [
        [start.lon, start.lat],
        [end.lon, end.lat]
      ]
    }
  }

  // Parse route data from OpenRouteService response
  const parseRouteData = (data: any): RouteInfo => {
    if (!data || !data.features || data.features.length === 0) {
      throw new Error('No route found')
    }

    const route = data.features[0]
    const properties = route.properties
    const geometry = route.geometry.coordinates // [[lon, lat], ...]

    // Extract steps from segments
    const steps: RouteStep[] = []
    if (properties.segments && properties.segments.length > 0) {
      properties.segments.forEach((segment: any) => {
        segment.steps.forEach((step: any) => {
          steps.push({
            distance: step.distance,
            duration: step.duration,
            instruction: step.instruction || 'Continue',
            type: step.type || 0
          })
        })
      })
    }

    return {
      distance: properties.summary?.distance || 0,
      duration: properties.summary?.duration || 0,
      steps: steps,
      geometry: geometry
    }
  }

  const handleNavigate = async () => {
    if (!destination.trim()) {
      alert('Please enter a destination')
      return
    }

    if (!location) {
      alert('Please wait for your current location to be detected')
      return
    }

    setGeocoding(true)
    setError(null)
    setRouteInfo(null)
    setDestinationCoords(null)

    try {
      // Step 1: Geocode destination
      const destCoords = await geocodeAddress(destination)
      
      if (!destCoords) {
        throw new Error('Could not find the destination. Please try a more specific address.')
      }

      setDestinationCoords(destCoords)

      // Step 2: Calculate route with selected transportation mode
      setNavigating(true)
      const route = await getRoute(location, destCoords, transportMode)
      setRouteInfo(route)
      setNavigating(false)
      setCurrentStep(0)

      // Fit map to show entire route
      if (mapRef.current && route.geometry.length > 0) {
        const bounds = L.latLngBounds(
          route.geometry.map((coord: number[]) => [coord[1], coord[0]] as [number, number])
        )
        // Add start and end points to bounds
        bounds.extend([location.lat, location.lon])
        bounds.extend([destCoords.lat, destCoords.lon])
        mapRef.current.fitBounds(bounds, { padding: [50, 50] })
      }
    } catch (err: any) {
      setError(err.message || 'Failed to calculate route')
      setGeocoding(false)
      setNavigating(false)
    } finally {
      setGeocoding(false)
    }
  }

  const formatDistance = (meters: number): string => {
    if (meters < 1000) {
      return `${Math.round(meters)} m`
    }
    return `${(meters / 1000).toFixed(1)} km`
  }

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${minutes} min`
  }

  const handleNextStep = () => {
    if (routeInfo && currentStep < routeInfo.steps.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  // Center map on current location
  const centerOnCurrentLocation = () => {
    if (location && mapRef.current) {
      mapRef.current.setView([location.lat, location.lon], 15, {
        animate: true,
        duration: 0.5
      })
      // Open popup to show location info
      if (markerRef.current) {
        markerRef.current.openPopup()
      }
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-md p-4 flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-2">
          <NavIcon className="text-green-600" size={28} />
          <h1 className="text-2xl font-bold text-gray-800">Navigation</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col md:flex-row gap-4 p-4 md:p-6 overflow-hidden">
        {/* Left Panel - Controls */}
        <div className="w-full md:w-96 bg-white rounded-2xl shadow-lg p-4 md:p-6 space-y-4 overflow-y-auto">
          {/* Current Location */}
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <MapPin className="text-green-600" size={20} />
              Current Location
            </h2>
            
            {loading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="animate-spin text-green-600" size={24} />
                <span className="ml-2 text-sm text-gray-600">Getting location...</span>
              </div>
            )}

            {error && !geocoding && !navigating && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-600 text-sm">{error}</p>
                <button
                  onClick={getCurrentLocation}
                  className="mt-2 text-xs text-red-600 hover:text-red-800 underline"
                >
                  Try again
                </button>
              </div>
            )}

            {location && !loading && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                {loadingAddress ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="animate-spin text-green-600" size={16} />
                    <span className="text-gray-600 text-sm">Getting address...</span>
                  </div>
                ) : currentAddress ? (
                  <div className="space-y-1">
                    <p className="text-gray-800 text-sm font-semibold flex items-start gap-2">
                      <MapPin className="text-green-600 mt-0.5 flex-shrink-0" size={16} />
                      <span className="flex-1 break-words">{currentAddress}</span>
                    </p>
                    <p className="text-gray-500 text-xs mt-2">
                      Coordinates: {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                    </p>
                    {locationAccuracy && (
                      <p className="text-gray-400 text-xs">
                        Accuracy: ±{Math.round(locationAccuracy)}m
                      </p>
                    )}
                    <button
                      onClick={async () => {
                        if (location) {
                          setLoadingAddress(true)
                          const address = await reverseGeocode(location.lat, location.lon, locationAccuracy || undefined)
                          setCurrentAddress(address)
                        }
                      }}
                      className="mt-2 text-xs text-green-600 hover:text-green-800 underline"
                      title="Refresh address"
                    >
                      Refresh Address
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-gray-700 text-sm">
                      <span className="font-semibold">Coordinates:</span> {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                    </p>
                    <button
                      onClick={async () => {
                        if (location) {
                          setLoadingAddress(true)
                          const address = await reverseGeocode(location.lat, location.lon, locationAccuracy || undefined)
                          setCurrentAddress(address)
                        }
                      }}
                      className="text-xs text-green-600 hover:text-green-800 underline"
                      title="Get address"
                    >
                      Get Address
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Transportation Mode Selection */}
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-gray-800">Transportation Mode</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setTransportMode('car')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                  transportMode === 'car'
                    ? 'bg-green-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title="Car Navigation"
              >
                <Car size={18} />
                <span>Car</span>
              </button>
              <button
                onClick={() => setTransportMode('bus')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                  transportMode === 'bus'
                    ? 'bg-green-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title="Bus Navigation"
              >
                <Bus size={18} />
                <span>Bus</span>
              </button>
              <button
                onClick={() => setTransportMode('train')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                  transportMode === 'train'
                    ? 'bg-green-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title="Train Navigation"
              >
                <Train size={18} />
                <span>Train</span>
              </button>
            </div>
          </div>

          {/* Destination Input */}
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-gray-800">Destination</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Enter address or place name"
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
                disabled={geocoding || navigating}
              />
              <button
                onClick={handleNavigate}
                disabled={!destination.trim() || loading || geocoding || navigating}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-semibold text-sm whitespace-nowrap"
              >
                {geocoding ? (
                  <>
                    <Loader2 className="animate-spin inline mr-1" size={16} />
                    Finding...
                  </>
                ) : navigating ? (
                  <>
                    <Loader2 className="animate-spin inline mr-1" size={16} />
                    Routing...
                  </>
                ) : (
                  'Navigate'
                )}
              </button>
            </div>
          </div>

          {/* Route Info */}
          {routeInfo && (
            <div className="space-y-3 border-t pt-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-700">
                  <Route size={18} className="text-green-600" />
                  <span className="font-semibold">Distance:</span>
                </div>
                <span className="text-gray-800 font-bold">{formatDistance(routeInfo.distance)}</span>
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-700">
                  <Clock size={18} className="text-green-600" />
                  <span className="font-semibold">Duration:</span>
                </div>
                <span className="text-gray-800 font-bold">{formatDuration(routeInfo.duration)}</span>
              </div>

              {/* Turn-by-turn Directions */}
              {routeInfo.steps.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-bold text-gray-800 text-sm">Directions</h3>
                  <div className="bg-gray-50 rounded-lg p-3 max-h-64 overflow-y-auto">
                    <div className="space-y-2">
                      {routeInfo.steps.map((step, index) => (
                        <div
                          key={index}
                          className={`p-2 rounded ${
                            index === currentStep
                              ? 'bg-green-100 border-2 border-green-500'
                              : 'bg-white border border-gray-200'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className="text-xs font-bold text-gray-500 mt-1 min-w-[24px]">
                              {index + 1}.
                            </span>
                            <div className="flex-1">
                              <p className="text-sm text-gray-800">{step.instruction}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                {formatDistance(step.distance)} • {formatDuration(step.duration)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Step Navigation */}
                  <div className="flex gap-2">
                    <button
                      onClick={handlePrevStep}
                      disabled={currentStep === 0}
                      className="flex-1 px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={handleNextStep}
                      disabled={currentStep >= routeInfo.steps.length - 1}
                      className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error during navigation */}
          {error && (geocoding || navigating) && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Right Panel - Map */}
        <div className="flex-1 bg-white rounded-2xl shadow-lg overflow-hidden relative" style={{ minHeight: '400px', height: '100%' }}>
          {/* Center on Current Location Button */}
          {location && (
            <button
              onClick={centerOnCurrentLocation}
              className="absolute top-4 right-4 z-[1000] bg-white hover:bg-green-50 border-2 border-green-500 rounded-full p-3 shadow-lg transition-all hover:scale-110 active:scale-95"
              title="Center on Current Location"
            >
              <Crosshair className="text-green-600" size={24} />
            </button>
          )}
          
          {typeof window !== 'undefined' && location ? (
            <div style={{ height: '100%', width: '100%', minHeight: '400px', position: 'relative' }}>
              <MapContainer
                center={[location.lat, location.lon]}
                zoom={15}
                style={{ height: '100%', width: '100%', zIndex: 1 }}
                whenCreated={(map) => {
                  mapRef.current = map
                  // Center on current location when map is created
                  if (location) {
                    map.setView([location.lat, location.lon], 15)
                    // Force invalidate size to ensure map renders
                    setTimeout(() => {
                      map.invalidateSize()
                      if (markerRef.current) {
                        markerRef.current.openPopup()
                      }
                    }, 300)
                  }
                }}
              >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              
              {/* Current Location Accuracy Circle */}
              {locationAccuracy && locationAccuracy > 0 && (
                <Circle
                  center={[location.lat, location.lon]}
                  radius={locationAccuracy}
                  pathOptions={{
                    color: '#10b981',
                    fillColor: '#10b981',
                    fillOpacity: 0.1,
                    weight: 2,
                    opacity: 0.5
                  }}
                />
              )}

              {/* Current Location Marker */}
              <Marker 
                position={[location.lat, location.lon]}
                icon={createCurrentLocationIcon()}
                ref={(ref) => {
                  if (ref) {
                    markerRef.current = ref
                  }
                }}
              >
                <Popup>
                  <div className="text-center min-w-[200px]">
                    <p className="font-semibold text-green-600 mb-2">📍 Your Current Location</p>
                    {currentAddress ? (
                      <>
                        <p className="text-sm text-gray-800 mb-2 break-words">{currentAddress}</p>
                        <p className="text-xs text-gray-500">
                          {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                        </p>
                        {locationAccuracy && (
                          <p className="text-xs text-gray-400 mt-1">
                            Accuracy: ±{Math.round(locationAccuracy)}m
                          </p>
                        )}
                      </>
                    ) : loadingAddress ? (
                      <div className="flex items-center justify-center gap-2 py-2">
                        <Loader2 className="animate-spin text-green-600" size={16} />
                        <span className="text-sm text-gray-600">Loading address...</span>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-gray-600">
                          {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                        </p>
                        {locationAccuracy && (
                          <p className="text-xs text-gray-400 mt-1">
                            Accuracy: ±{Math.round(locationAccuracy)}m
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </Popup>
              </Marker>

              {/* Destination Marker */}
              {destinationCoords && (
                <Marker position={[destinationCoords.lat, destinationCoords.lon]}>
                  <Popup>
                    <div className="text-center">
                      <p className="font-semibold">Destination</p>
                      <p className="text-xs text-gray-600">{destination}</p>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* Route Polyline */}
              {routeInfo && routeInfo.geometry.length > 0 && (
                <Polyline
                  positions={routeInfo.geometry.map((coord: number[]) => [coord[1], coord[0]] as [number, number])}
                  color="#10b981"
                  weight={5}
                  opacity={0.8}
                />
              )}
              </MapContainer>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-gray-200" style={{ minHeight: '400px' }}>
              <div className="text-center text-gray-500">
                <NavIcon size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-lg font-semibold">Map View</p>
                <p className="text-sm">
                  {loading ? 'Getting your location...' : 'Waiting for location...'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
