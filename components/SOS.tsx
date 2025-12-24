'use client'
import { useState, useEffect } from 'react'
import { ArrowLeft, AlertTriangle, MapPin, Loader2, Phone, CheckCircle, XCircle, Download } from 'lucide-react'

interface SOSProps {
  currentUser: any
  onBack: () => void
}

export default function SOS({ currentUser, onBack }: SOSProps) {
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null)
  const [currentAddress, setCurrentAddress] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [emergencyType, setEmergencyType] = useState('')
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null)

  // Load saved phone number and emergency type from localStorage
  useEffect(() => {
    const savedPhone = localStorage.getItem('sos_phone_number')
    if (savedPhone) {
      setPhoneNumber(savedPhone)
    }
    const savedEmergencyType = localStorage.getItem('sos_emergency_type')
    if (savedEmergencyType) {
      setEmergencyType(savedEmergencyType)
    }
    // Get current location on mount
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
      async (position) => {
        const coords = {
          lat: position.coords.latitude,
          lon: position.coords.longitude
        }
        setLocation(coords)
        setLocationAccuracy(position.coords.accuracy)
        setLoading(false)
        
        // Reverse geocode to get address
        const address = await reverseGeocode(coords.lat, coords.lon)
        setCurrentAddress(address)
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

  // Reverse geocode coordinates to address
  const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'SYLAW SOS App',
            'Accept-Language': 'en'
          }
        }
      )
      
      if (!response.ok) {
        return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
      }

      const data = await response.json()
      
      if (data && data.display_name) {
        return data.display_name
      }
      
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    } catch (error) {
      return `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    }
  }

  // Generate map image of current location
  const generateLocationMap = async (lat: number, lon: number): Promise<string> => {
    try {
      // Create map using OpenStreetMap tiles (similar to ChatWindow location sharing)
      const mapWidth = 600
      const mapHeight = 400
      const zoom = 15
      
      const canvas = document.createElement('canvas')
      canvas.width = mapWidth
      canvas.height = mapHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        throw new Error('Failed to create canvas')
      }

      // Helper function to convert lat/lon to pixel coordinates
      function latLonToPixel(lat: number, lon: number, zoom: number) {
        const n = Math.pow(2, zoom)
        const latRad = lat * Math.PI / 180
        const x = (lon + 180) / 360 * n * 256
        const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n * 256
        return { x, y }
      }

      const centerPixel = latLonToPixel(lat, lon, zoom)
      const topLeftPixelX = centerPixel.x - mapWidth / 2
      const topLeftPixelY = centerPixel.y - mapHeight / 2

      // Fetch map tiles
      const startTileX = Math.floor(topLeftPixelX / 256)
      const startTileY = Math.floor(topLeftPixelY / 256)
      const endTileX = Math.ceil((topLeftPixelX + mapWidth) / 256)
      const endTileY = Math.ceil((topLeftPixelY + mapHeight) / 256)

      for (let ty = startTileY; ty <= endTileY; ty++) {
        for (let tx = startTileX; tx <= endTileX; tx++) {
          try {
            const tileUrl = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`
            const response = await fetch(tileUrl, { mode: 'cors', cache: 'no-cache' })
            
            if (response.ok) {
              const blob = await response.blob()
              const img = await createImageBitmap(blob)
              const tilePixelX = tx * 256
              const tilePixelY = ty * 256
              const offsetX = tilePixelX - topLeftPixelX
              const offsetY = tilePixelY - topLeftPixelY
              ctx.drawImage(img, offsetX, offsetY)
            }
          } catch (e) {
            console.warn('Failed to fetch tile:', e)
          }
        }
      }

      // Draw location marker
      const centerX = mapWidth / 2
      const centerY = mapHeight / 2
      
      // Draw pin shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.beginPath()
      ctx.arc(centerX + 2, centerY + 2, 12, 0, Math.PI * 2)
      ctx.fill()
      
      // Draw red pin
      ctx.fillStyle = '#ff0000'
      ctx.beginPath()
      ctx.arc(centerX, centerY, 10, 0, Math.PI * 2)
      ctx.fill()
      
      // Draw pin border
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(centerX, centerY, 10, 0, Math.PI * 2)
      ctx.stroke()

      // Draw coordinates text
      ctx.font = 'bold 14px Arial'
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.fillRect(centerX - 100, mapHeight - 40, 200, 30)
      ctx.fillStyle = '#333333'
      ctx.fillText(`📍 ${lat.toFixed(6)}, ${lon.toFixed(6)}`, centerX, mapHeight - 20)

      // Convert canvas to blob
      return new Promise<string>((resolve, reject) => {
        canvas.toBlob(async (blob) => {
          if (!blob) {
            reject(new Error('Failed to create map image'))
            return
          }

          // Upload to Cloudinary if available
          if (process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET && process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
            try {
              const formData = new FormData()
              formData.append('file', blob, 'sos-location.png')
              formData.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET)
              
              const uploadResponse = await fetch(
                `https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`,
                { method: 'POST', body: formData }
              )
              
              const uploadData = await uploadResponse.json()
              if (uploadData.secure_url) {
                resolve(uploadData.secure_url)
                return
              }
            } catch (uploadError) {
              console.warn('Cloudinary upload failed:', uploadError)
            }
          }

          // Fallback: convert to data URL
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        }, 'image/png')
      })
    } catch (error) {
      console.error('Error generating map:', error)
      throw error
    }
  }

  const handleSendSOS = async () => {
    if (!phoneNumber.trim()) {
      setError('Please enter a phone number')
      return
    }

    if (!emergencyType.trim()) {
      setError('Please describe the emergency type')
      return
    }

    if (!location) {
      setError('Please wait for location to be detected')
      return
    }

    setSending(true)
    setError(null)
    setSuccess(false)

    try {
      // Generate map image
      const mapImageUrl = await generateLocationMap(location.lat, location.lon)
      
      // Get username from currentUser
      const username = currentUser?.nickname || currentUser?.username || 'Unknown User'
      
      // Create SOS message with username and emergency type in header
      const addressText = currentAddress || `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`
      const googleMapsLink = `https://www.google.com/maps?q=${location.lat},${location.lon}`
      const message = `🚨 SOS EMERGENCY ALERT 🚨\n\nUser: ${username}\nEmergency Type: ${emergencyType}\n\nI need immediate help!\n\nLocation: ${addressText}\nCoordinates: ${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}\n\nMap Link: ${googleMapsLink}\n\nLocation Map: ${mapImageUrl}\n\nTime: ${new Date().toLocaleString()}`

      // Save phone number and emergency type to localStorage
      localStorage.setItem('sos_phone_number', phoneNumber)
      localStorage.setItem('sos_emergency_type', emergencyType)

      // Try to send SMS via API first
      try {
        const response = await fetch('/api/send-sms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phoneNumber: phoneNumber,
            message: message,
            imageUrl: mapImageUrl.startsWith('http') ? mapImageUrl : null
          })
        })

        const data = await response.json()

        if (response.ok && data.success) {
          // SMS sent successfully via API
          setSuccess(true)
          setSending(false)
          setError(null)
          return
        } else if (data.fallback) {
          // API not configured, fall back to other methods
          console.log('SMS API not configured, using fallback method')
          // Don't show error, just continue to fallback
        } else {
          // API error, but continue to fallback
          console.warn('SMS API error:', data.error)
        }
      } catch (apiError: any) {
        console.warn('SMS API request failed, using fallback:', apiError)
        // Continue to fallback methods - don't show error yet
      }

      // Fallback: Try to use Web Share API (supports images on mobile)
      if (navigator.share && navigator.canShare) {
        try {
          // Convert data URL to blob if needed
          let imageFile: File | null = null
          
          if (mapImageUrl.startsWith('data:')) {
            // Convert data URL to blob
            const response = await fetch(mapImageUrl)
            const blob = await response.blob()
            imageFile = new File([blob], 'sos-location-map.png', { type: 'image/png' })
          } else if (mapImageUrl.startsWith('http')) {
            // Download image from URL and convert to File
            try {
              const response = await fetch(mapImageUrl)
              const blob = await response.blob()
              imageFile = new File([blob], 'sos-location-map.png', { type: 'image/png' })
            } catch (e) {
              console.warn('Failed to download image for sharing:', e)
            }
          }

          // Check if we can share with image
          const shareData: any = {
            title: 'SOS Emergency Alert',
            text: message,
            url: googleMapsLink
          }

          if (imageFile && navigator.canShare({ files: [imageFile] })) {
            shareData.files = [imageFile]
          }

          if (navigator.canShare(shareData)) {
            await navigator.share(shareData)
            setSuccess(true)
            setSending(false)
            return
          }
        } catch (shareError: any) {
          // If user cancels share, don't show error
          if (shareError.name === 'AbortError') {
            setSending(false)
            return
          }
          console.warn('Web Share API failed, falling back to SMS link:', shareError)
        }
      }

      // Final fallback: Send SMS using SMS link (opens default SMS app)
      // Format: sms:+1234567890?body=message
      const phone = phoneNumber.replace(/\D/g, '') // Remove non-digits
      const smsLink = `sms:${phone}?body=${encodeURIComponent(message)}`
      
      // Try to open SMS app
      window.location.href = smsLink
      
      // Show success message
      setTimeout(() => {
        setSuccess(true)
        setSending(false)
      }, 1000)

    } catch (err: any) {
      setError('Failed to send SOS: ' + (err.message || 'Unknown error'))
      setSending(false)
    }
  }

  const handleCopyLocation = async () => {
    if (!location) return

    try {
      const username = currentUser?.nickname || currentUser?.username || 'Unknown User'
      const addressText = currentAddress || `${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}`
      const googleMapsLink = `https://www.google.com/maps?q=${location.lat},${location.lon}`
      const emergencyTypeText = emergencyType || 'Emergency'
      // Generate map image URL for copy
      let mapImageUrl = ''
      try {
        mapImageUrl = await generateLocationMap(location.lat, location.lon)
      } catch (e) {
        console.warn('Failed to generate map for copy:', e)
      }
      
      const message = `🚨 SOS EMERGENCY ALERT 🚨\n\nUser: ${username}\nEmergency Type: ${emergencyTypeText}\n\nI need immediate help!\n\nLocation: ${addressText}\nCoordinates: ${location.lat.toFixed(6)}, ${location.lon.toFixed(6)}\n\nMap Link: ${googleMapsLink}${mapImageUrl ? `\n\nLocation Map: ${mapImageUrl}` : ''}\n\nTime: ${new Date().toLocaleString()}`
      
      await navigator.clipboard.writeText(message)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError('Failed to copy location')
    }
  }

  const handleDownloadMap = async () => {
    if (!location) return

    try {
      const mapImageUrl = await generateLocationMap(location.lat, location.lon)
      
      // If it's a data URL, download directly
      if (mapImageUrl.startsWith('data:')) {
        const link = document.createElement('a')
        link.href = mapImageUrl
        link.download = `sos-location-${Date.now()}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } else if (mapImageUrl.startsWith('http')) {
        // If it's a URL, download it
        const response = await fetch(mapImageUrl)
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `sos-location-${Date.now()}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
      }
    } catch (err) {
      setError('Failed to download map image')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-md p-4 flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-red-600" size={28} />
          <h1 className="text-2xl font-bold text-gray-800">SOS Emergency</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 md:p-8 max-w-2xl mx-auto w-full">
        <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8 space-y-6">
          {/* Warning */}
          <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-red-600 flex-shrink-0 mt-0.5" size={24} />
              <div>
                <h3 className="font-bold text-red-800 mb-1">Emergency Alert</h3>
                <p className="text-sm text-red-700">
                  This will send an SOS message with your current location to the configured phone number. 
                  Use only in emergency situations.
                </p>
              </div>
            </div>
          </div>

          {/* Phone Number Input */}
          <div className="space-y-2">
            <label className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Phone className="text-red-600" size={20} />
              Emergency Contact Number
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Enter phone number (e.g., +1234567890)"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-lg"
            />
            <p className="text-xs text-gray-500">
              This number will be saved for future use
            </p>
          </div>

          {/* Emergency Type Input */}
          <div className="space-y-2">
            <label className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <AlertTriangle className="text-red-600" size={20} />
              Emergency Type
            </label>
            <input
              type="text"
              value={emergencyType}
              onChange={(e) => setEmergencyType(e.target.value)}
              placeholder="Describe the emergency (e.g., Medical Emergency, Accident, Safety Threat)"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-lg"
            />
            <p className="text-xs text-gray-500">
              Brief description of the emergency situation
            </p>
          </div>

          {/* Current Location */}
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <MapPin className="text-red-600" size={20} />
              Current Location
            </h2>
            
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-red-600" size={32} />
                <span className="ml-3 text-gray-600">Getting your location...</span>
              </div>
            )}

            {error && !loading && (
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
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                {currentAddress ? (
                  <p className="text-gray-800 font-semibold">{currentAddress}</p>
                ) : (
                  <p className="text-gray-700 text-sm">
                    Coordinates: {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                  </p>
                )}
                <p className="text-gray-600 text-xs">
                  {location.lat.toFixed(6)}, {location.lon.toFixed(6)}
                </p>
                {locationAccuracy && (
                  <p className="text-gray-500 text-xs">
                    Accuracy: ±{Math.round(locationAccuracy)}m
                  </p>
                )}
                <a
                  href={`https://www.google.com/maps?q=${location.lat},${location.lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 text-xs underline"
                >
                  View on Google Maps
                </a>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <button
              onClick={handleSendSOS}
              disabled={!phoneNumber.trim() || !emergencyType.trim() || !location || sending || loading}
              className="w-full py-4 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-bold text-lg flex items-center justify-center gap-2 shadow-lg"
            >
              {sending ? (
                <>
                  <Loader2 className="animate-spin" size={24} />
                  <span>Sending SOS...</span>
                </>
              ) : (
                <>
                  <AlertTriangle size={24} />
                  <span>Send SOS Alert</span>
                </>
              )}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleCopyLocation}
                disabled={!location || loading}
                className="py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:bg-gray-50 disabled:cursor-not-allowed transition-colors font-semibold flex items-center justify-center gap-2"
              >
                <MapPin size={18} />
                <span className="text-sm">Copy Details</span>
              </button>
              <button
                onClick={handleDownloadMap}
                disabled={!location || loading}
                className="py-3 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:bg-blue-50 disabled:cursor-not-allowed transition-colors font-semibold flex items-center justify-center gap-2"
              >
                <Download size={18} />
                <span className="text-sm">Download Map</span>
              </button>
            </div>
          </div>

          {/* Success Message */}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="text-green-600 flex-shrink-0" size={24} />
              <div>
                <p className="font-semibold text-green-800">SOS Alert Sent!</p>
                <p className="text-sm text-green-700">
                  SMS has been sent successfully to {phoneNumber}! The message includes your location details and map image URL.
                </p>
              </div>
            </div>
          )}

          {/* Info */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            <p className="text-blue-800 text-sm">
              <strong>Note:</strong> SMS will be sent directly to the configured phone number. 
              The message includes your username, emergency type, location details, coordinates, Google Maps link, and location map image URL.
            </p>
            <p className="text-blue-800 text-sm">
              Make sure your phone number includes the country code (e.g., +1 for US, +44 for UK).
            </p>
            <p className="text-orange-800 text-xs mt-2">
              <strong>Setup Required:</strong> To send SMS automatically, configure Singtel SMS API credentials in your environment variables:
              <br />• SINGTEL_SMS_API_KEY (your Singtel API key)
              <br />• SINGTEL_SMS_API_URL (optional, defaults to Singtel API endpoint)
              <br />• SINGTEL_SMS_FROM_NUMBER (optional, your sender number)
              <br />Without Singtel API, the app will open your messaging app with the message pre-filled.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

