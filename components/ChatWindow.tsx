'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { User, Message } from '@/types'
import { Send, Image as ImageIcon, Loader2, Paperclip, FileText, Download, ArrowLeft, Home, Check, MapPin, Phone, Video as VideoIcon, ZoomIn, ZoomOut, X, RotateCcw } from 'lucide-react'
import VideoCall from './VideoCall'

interface ChatWindowProps {
  user: User;
  activeChat: any;
  isGroup: boolean;
  acceptedCallMode?: 'audio' | 'video' | null;
  onBack: () => void;
  onCallEnd?: () => void;
}

export default function ChatWindow({ user, activeChat, isGroup, acceptedCallMode, onBack, onCallEnd }: ChatWindowProps) {
  // ... (All existing state logic remains identical) ...
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [loadingChat, setLoadingChat] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationProgress, setLocationProgress] = useState(0)
  const [zoomedImage, setZoomedImage] = useState<{ url: string; isLocation: boolean } | null>(null)
  const [imageZoom, setImageZoom] = useState(1)
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 })
  const imageRef = useRef<HTMLImageElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  
  const supabase = createClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)
  const shouldAutoScrollRef = useRef(true)
  
  const activeChatRef = useRef(activeChat)
  const isGroupRef = useRef(isGroup)
  const userRef = useRef(user)

  // ... (Keep existing UseEffects for Fetch/Realtime/Upload exactly as they were) ...
  // (Assuming code is the same as previous step, just hiding it for brevity)
  
  // Re-paste your existing useEffects and handler functions here...
  // 1. Switch Chat Logic...
  // 2. Fetch History...
  // 3. Realtime Listener...
  // 4. Send Message Logic...
  // 5. Upload Handler...

  // Re-paste logic here or use previous file content
  // ...

  // COPY THE LOGIC FROM PREVIOUS RESPONSE FOR useEffects/handlers
  // I will focus on the Return Statement changes below:

  useEffect(() => {
    activeChatRef.current = activeChat; isGroupRef.current = isGroup; userRef.current = user;
    setMessages([]); if (activeChat) { setLoadingChat(true); fetchHistory().finally(() => setLoadingChat(false)) }
  }, [activeChat?.id])

  // Mark messages as read continuously while chat is open
  useEffect(() => {
    if (!activeChat || loadingChat) return
    
    const markAsRead = async () => {
      if (isGroup) {
        // For groups: Mark messages sent by current user as read (when others read them)
        const { data, error } = await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('sender_id', user.id)
          .eq('group_id', activeChat.id)
          .is('recipient_id', null)
          .eq('is_read', false)
          .select()
        
        if (error) {
          console.error('❌ Error marking group messages as read:', error)
        } else {
          // Update local state immediately for instant UI update
          if (data && data.length > 0) {
            setMessages(prev => prev.map(m => 
              data.some((d: any) => d.id === m.id)
                ? { ...m, is_read: true }
                : m
            ))
          }
        }
      } else {
        // For direct messages:
        // 1. Mark messages received by current user as read (when you read them)
        // This happens because you are viewing the chat
        const { data: receivedData, error: receivedError } = await supabase
          .from('messages')
          .update({ is_read: true })
          .eq('sender_id', activeChat.id)
          .eq('recipient_id', user.id)
          .is('group_id', null)
          .eq('is_read', false)
          .select()
        
        if (receivedError) {
          console.error('❌ Error marking received messages as read:', receivedError)
        } else {
          // Update local state immediately - mark ALL received messages as read
          setMessages(prev => prev.map(m => 
            m.sender_id === activeChat.id && m.recipient_id === user.id
              ? { ...m, is_read: true }
              : m
          ))
        }
        
        // 2. Note: Messages sent by current user are marked as read by the RECIPIENT
        // when they open the chat. The real-time UPDATE listener will update our view
        // when the recipient marks them as read. We don't mark our own sent messages here.
      }
    }
    
    // Mark as read immediately when chat opens
    const initialTimer = setTimeout(() => {
      markAsRead()
    }, 500)
    
    // Continue marking as read periodically while chat is open (every 2 seconds)
    const interval = setInterval(() => {
      markAsRead()
    }, 2000)
    
    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [activeChat?.id, loadingChat, user.id, isGroup])

  const fetchHistory = async () => { 
      if (!activeChat) return
      let query = supabase.from('messages').select('*, sender:users!sender_id(username, avatar)').order('timestamp', { ascending: true })
      if (isGroup) query = query.eq('group_id', activeChat.id).is('recipient_id', null) 
      else query = query.is('group_id', null).or(`and(sender_id.eq.${user.id},recipient_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},recipient_id.eq.${user.id})`)
      const { data } = await query
      if (data) {
        // When chat is open, mark all received messages as read in local state
        const messagesWithReadStatus = data.map((msg: any) => {
          // If message is received by current user, mark as read since chat is open
          if (!isGroup && msg.recipient_id === user.id && msg.sender_id === activeChat.id) {
            return { ...msg, is_read: true }
          }
          return msg
        })
        setMessages(messagesWithReadStatus as any)
      }
  }

  useEffect(() => { 
      const channel = supabase.channel('global-chat-listener')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
          const newMsg = payload.new as Message
          if (!activeChatRef.current) return
          let isRelevant = false
          if (isGroupRef.current) isRelevant = (Number(newMsg.group_id) === Number(activeChatRef.current.id)) && (newMsg.recipient_id === null)
          else isRelevant = (newMsg.group_id === null) && ((newMsg.sender_id === activeChatRef.current.id && newMsg.recipient_id === userRef.current.id) || (newMsg.sender_id === userRef.current.id && newMsg.recipient_id === activeChatRef.current.id))
          if (isRelevant) {
             let senderData: { username: string; avatar: string } | null = null
             if (newMsg.sender_id === userRef.current.id) senderData = { username: userRef.current.username, avatar: userRef.current.avatar }
             else if (!isGroupRef.current && newMsg.sender_id === activeChatRef.current.id) senderData = { username: activeChatRef.current.username, avatar: activeChatRef.current.avatar }
             else { const { data } = await supabase.from('users').select('username, avatar').eq('id', newMsg.sender_id).single(); senderData = data as { username: string; avatar: string } | null }
             
             // If this is a received message, mark it as read immediately since chat is open
             const messageToAdd = { ...newMsg, sender: senderData } as any
             if (!isGroupRef.current && newMsg.sender_id === activeChatRef.current.id && newMsg.recipient_id === userRef.current.id) {
               messageToAdd.is_read = true
               // Also update in database
               supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id).then(({ error }) => {
                 if (error) console.error('❌ Error marking new message as read:', error)
               })
             }
             
             setMessages(prev => { if (prev.find(m => m.id === newMsg.id)) return prev; return [...prev, messageToAdd] })
          }
        })
        .on('postgres_changes', { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'messages' 
        }, async (payload) => {
          const updatedMsg = payload.new as Message
          const oldMsg = payload.old as Message
          
          console.log('🔄 Message UPDATE received in ChatWindow:', {
            id: updatedMsg.id,
            old_read: oldMsg?.is_read,
            new_read: updatedMsg.is_read,
            sender_id: updatedMsg.sender_id,
            recipient_id: updatedMsg.recipient_id,
            group_id: updatedMsg.group_id
          })
          
          if (!activeChatRef.current) {
            console.log('⚠️ No active chat, ignoring update')
            return
          }
          
          // Check if the updated message is relevant to current chat
          let isRelevant = false
          if (isGroupRef.current) {
            isRelevant = (Number(updatedMsg.group_id) === Number(activeChatRef.current.id)) && (updatedMsg.recipient_id === null)
          } else {
            isRelevant = (updatedMsg.group_id === null) && 
              ((updatedMsg.sender_id === activeChatRef.current.id && updatedMsg.recipient_id === userRef.current.id) || 
               (updatedMsg.sender_id === userRef.current.id && updatedMsg.recipient_id === activeChatRef.current.id))
          }
          
          console.log('📋 Update relevance check:', {
            isRelevant,
            isGroup: isGroupRef.current,
            activeChatId: activeChatRef.current.id,
            userId: userRef.current.id
          })
          
          if (isRelevant) {
            console.log('✅ Updating message read status in ChatWindow:', updatedMsg.id, 'is_read:', updatedMsg.is_read)
            // Update the message's read status in the messages list
            setMessages(prev => {
              const messageExists = prev.find(m => m.id === updatedMsg.id)
              if (!messageExists) {
                console.log('⚠️ Message not found in current messages list')
                return prev
              }
              
              const updated = prev.map(m => 
                m.id === updatedMsg.id 
                  ? { ...m, is_read: updatedMsg.is_read } 
                  : m
              )
              console.log('📝 Updated messages state:', {
                messageId: updatedMsg.id,
                oldRead: messageExists.is_read,
                newRead: updatedMsg.is_read,
                updatedMessage: updated.find(m => m.id === updatedMsg.id)
              })
              return updated
            })
          } else {
            console.log('❌ Message update not relevant to current chat')
          }
        })
        .subscribe()
      return () => { supabase.removeChannel(channel) }
  }, [])
  
  // Auto-scroll to bottom only if user is near bottom or it's a new message from current user
  const scrollToBottom = useCallback((force: boolean = false) => {
    if (!messagesContainerRef.current) return
    
    const container = messagesContainerRef.current
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    
    // Only auto-scroll if:
    // 1. Force is true (initial load)
    // 2. User is near bottom (within 100px)
    // 3. Should auto-scroll flag is true
    if (force || (isNearBottom && shouldAutoScrollRef.current)) {
      setTimeout(() => {
        if (scrollRef.current && messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
        }
      }, 50)
    }
  }, [])

  // Handle scroll events to detect user scrolling up
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
      shouldAutoScrollRef.current = isNearBottom
      isUserScrollingRef.current = true
      
      // Reset flag after scroll ends
      clearTimeout((handleScroll as any).timeout)
      ;(handleScroll as any).timeout = setTimeout(() => {
        isUserScrollingRef.current = false
      }, 150)
    }

    container.addEventListener('scroll', handleScroll)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      clearTimeout((handleScroll as any).timeout)
    }
  }, [])

  // Auto-scroll on new messages or initial load
  useEffect(() => {
    if (loadingChat) {
      // Initial load - always scroll to bottom
      scrollToBottom(true)
    } else if (messages.length > 0) {
      // Check if last message is from current user (new message sent)
      const lastMessage = messages[messages.length - 1]
      const isMyMessage = lastMessage.sender_id === user.id
      
      // Auto-scroll if it's my message or user is near bottom
      if (isMyMessage || shouldAutoScrollRef.current) {
        scrollToBottom(false)
      }
    }
  }, [messages, loadingChat, scrollToBottom, user.id])

  const handleSend = async (fileUrl?: string, type: 'text'|'image'|'file' = 'text', fileName?: string) => {
    if (!text.trim() && !fileUrl) return
    const msgData = { 
      sender_id: user.id, 
      content: fileName || text, 
      type, 
      fileUrl, 
      timestamp: new Date().toISOString(), 
      group_id: isGroup ? activeChat.id : null, 
      recipient_id: isGroup ? null : activeChat.id,
      is_read: false // New messages start as unread
    }
    const optimisticId = Date.now()
    setMessages(prev => [...prev, { ...msgData, id: optimisticId, sender: { username: user.username, avatar: user.avatar } } as any])
    setText('')
    const { data, error } = await supabase.from('messages').insert(msgData).select().single()
    if (error) setMessages(prev => prev.filter(m => m.id !== optimisticId)) 
    else if (data) setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, id: data.id } : m))
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, fileType: 'image' | 'file') => { /* ... same as before ... */
    const file = e.target.files?.[0]; if (!file) return; setUploading(true);
    const formData = new FormData(); formData.append('file', file); formData.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!)
    try { const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/auto/upload`, { method: 'POST', body: formData }); const data = await res.json(); if (data.secure_url) await handleSend(data.secure_url, fileType, file.name) } 
    catch(e) { console.error(e) } finally { setUploading(false) }
  }

  const handleShareLocation = async () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser. Please use a modern browser that supports location services.')
      return
    }

    setLocationLoading(true)
    setLocationProgress(0)
    setUploading(true)
    
    // Simulate progress while waiting for location
    let progressInterval: NodeJS.Timeout | null = setInterval(() => {
      setLocationProgress(prev => {
        if (prev >= 90) return prev // Don't go to 100% until location is obtained
        return prev + 5
      })
    }, 200)
    
    try {
      // Get current position with high accuracy settings
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (progressInterval) {
              clearInterval(progressInterval)
              progressInterval = null
            }
            setLocationProgress(100)
            console.log('📍 Location obtained:', {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              altitudeAccuracy: pos.coords.altitudeAccuracy
            })
            // Small delay to show 100% before proceeding
            setTimeout(() => resolve(pos), 100)
          },
          (error) => {
            if (progressInterval) {
              clearInterval(progressInterval)
              progressInterval = null
            }
            setLocationProgress(0)
            reject(error)
          },
          {
            enableHighAccuracy: true, // Use GPS if available for better accuracy
            timeout: 15000, // Increased timeout for better accuracy
            maximumAge: 0 // Don't use cached position
          }
        )
      })

      const { latitude, longitude, accuracy } = position.coords
      
      // Log accuracy information
      if (accuracy > 100) {
        console.warn(`⚠️ Location accuracy is ${accuracy.toFixed(0)} meters. This may affect map precision.`)
      }
      
      const mapWidth = 600
      const mapHeight = 400
      // Adjust zoom based on accuracy - better accuracy = higher zoom
      // Accuracy is in meters, so we adjust zoom accordingly
      let zoom = 15 // Default zoom
      if (accuracy < 10) {
        zoom = 18 // Very accurate (GPS)
      } else if (accuracy < 50) {
        zoom = 16 // Good accuracy
      } else if (accuracy < 100) {
        zoom = 15 // Moderate accuracy
      } else {
        zoom = 14 // Lower accuracy, zoom out more
      }
      
      let blob: Blob
      
      // Helper function to create map using OpenStreetMap tiles
      async function createOSMMap(lat: number, lon: number, width: number, height: number, zoomLevel: number, accuracyMeters?: number): Promise<Blob> {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        
        if (!ctx) {
          throw new Error('Failed to create canvas context')
        }
        
        // Convert lat/lon to pixel coordinates at the given zoom level
        function latLonToPixel(lat: number, lon: number, zoom: number) {
          const n = Math.pow(2, zoom)
          const latRad = lat * Math.PI / 180
          const x = (lon + 180) / 360 * n * 256
          const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n * 256
          return { x, y }
        }
        
        // Get pixel coordinates for the center point
        const centerPixel = latLonToPixel(lat, lon, zoomLevel)
        
        // Calculate which tiles we need and their positions
        const tilesToFetch: Array<{x: number, y: number, offsetX: number, offsetY: number}> = []
        
        // Calculate the top-left pixel of our map (centered on the location)
        const topLeftPixelX = centerPixel.x - width / 2
        const topLeftPixelY = centerPixel.y - height / 2
        
        // Calculate which tiles we need
        const startTileX = Math.floor(topLeftPixelX / 256)
        const startTileY = Math.floor(topLeftPixelY / 256)
        const endTileX = Math.ceil((topLeftPixelX + width) / 256)
        const endTileY = Math.ceil((topLeftPixelY + height) / 256)
        
        // Fetch all needed tiles
        for (let ty = startTileY; ty <= endTileY; ty++) {
          for (let tx = startTileX; tx <= endTileX; tx++) {
            // Calculate where this tile should be drawn on the canvas
            const tilePixelX = tx * 256
            const tilePixelY = ty * 256
            const offsetX = tilePixelX - topLeftPixelX
            const offsetY = tilePixelY - topLeftPixelY
            
            tilesToFetch.push({
              x: tx,
              y: ty,
              offsetX: offsetX,
              offsetY: offsetY
            })
          }
        }
        
        // Try to fetch tiles from OpenStreetMap
        try {
          const tilePromises = tilesToFetch.map(async (tile) => {
            try {
              // Use OpenStreetMap tile server (free, no API key required)
              const tileUrl = `https://tile.openstreetmap.org/${zoomLevel}/${tile.x}/${tile.y}.png`
              const response = await fetch(tileUrl, { 
                mode: 'cors',
                cache: 'no-cache'
              })
              
              if (response.ok) {
                const blob = await response.blob()
                const img = await createImageBitmap(blob)
                return { img, offsetX: tile.offsetX, offsetY: tile.offsetY }
              }
            } catch (e) {
              console.warn('Failed to fetch tile:', e)
            }
            return null
          })
          
          const tileResults = await Promise.all(tilePromises)
          
          // Draw tiles on canvas
          let tilesDrawn = 0
          for (const result of tileResults) {
            if (result && result.img) {
              ctx.drawImage(result.img, result.offsetX, result.offsetY)
              tilesDrawn++
            }
          }
          
          // If we got some tiles, draw marker and return
          if (tilesDrawn > 0) {
            // Draw location marker (red pin)
            const centerX = width / 2
            const centerY = height / 2
            
            // Draw pin shadow
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
            ctx.beginPath()
            ctx.arc(centerX + 2, centerY + 2, 12, 0, Math.PI * 2)
            ctx.fill()
            
            // Draw pin circle
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
            
            // Draw coordinates text with background
            ctx.font = 'bold 14px Arial'
            ctx.textAlign = 'center'
            const coordText = `📍 ${lat.toFixed(6)}, ${lon.toFixed(6)}`
            const coordTextWidth = ctx.measureText(coordText).width
            
            let accuracyText = ''
            let accuracyTextWidth = 0
            if (accuracyMeters) {
              ctx.font = '12px Arial'
              accuracyText = `Accuracy: ±${accuracyMeters.toFixed(0)}m`
              accuracyTextWidth = ctx.measureText(accuracyText).width
            }
            
            const textWidth = Math.max(coordTextWidth, accuracyTextWidth)
            const padding = 10
            const textHeight = accuracyText ? 50 : 30
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
            ctx.fillRect(centerX - textWidth / 2 - padding, height - textHeight - 10, textWidth + padding * 2, textHeight)
            ctx.fillStyle = '#333333'
            ctx.font = 'bold 14px Arial'
            ctx.fillText(coordText, centerX, height - (accuracyText ? 30 : 20))
            
            if (accuracyText) {
              ctx.font = '12px Arial'
              ctx.fillStyle = accuracyMeters! < 50 ? '#00aa00' : accuracyMeters! < 100 ? '#ff8800' : '#ff0000'
              ctx.fillText(accuracyText, centerX, height - 15)
            }
            
            // Draw accuracy circle if accuracy is provided
            if (accuracyMeters && accuracyMeters < 500) {
              // Convert meters to pixels at current zoom level
              // At equator: 1 degree ≈ 111,320 meters
              // Pixel scale: meters per pixel = 156543.03392 * cos(lat) / 2^zoom
              const metersPerPixel = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoomLevel)
              const accuracyRadius = Math.min(accuracyMeters / metersPerPixel, Math.min(width, height) / 2 - 20)
              
              // Draw accuracy circle (semi-transparent)
              ctx.strokeStyle = 'rgba(255, 0, 0, 0.4)'
              ctx.fillStyle = 'rgba(255, 0, 0, 0.1)'
              ctx.lineWidth = 2
              ctx.setLineDash([5, 5])
              ctx.beginPath()
              ctx.arc(centerX, centerY, accuracyRadius, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()
              ctx.setLineDash([])
            }
            
            // Convert canvas to blob
            return new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (blob) {
                  resolve(blob)
                } else {
                  reject(new Error('Failed to create blob from canvas'))
                }
              }, 'image/png')
            })
          }
        } catch (error) {
          console.warn('Failed to fetch OSM tiles, using fallback:', error)
        }
        
        // Fallback: Draw simple map with grid
        ctx.fillStyle = '#f0f0f0'
        ctx.fillRect(0, 0, width, height)
        
        ctx.strokeStyle = '#d0d0d0'
        ctx.lineWidth = 1
        for (let i = 0; i < width; i += 30) {
          ctx.beginPath()
          ctx.moveTo(i, 0)
          ctx.lineTo(i, height)
          ctx.stroke()
        }
        for (let i = 0; i < height; i += 30) {
          ctx.beginPath()
          ctx.moveTo(0, i)
          ctx.lineTo(width, i)
          ctx.stroke()
        }
        
        const centerX = width / 2
        const centerY = height / 2
        
        ctx.fillStyle = 'rgba(255, 0, 0, 0.3)'
        ctx.beginPath()
        ctx.arc(centerX, centerY, 40, 0, Math.PI * 2)
        ctx.fill()
        
        ctx.fillStyle = '#ff0000'
        ctx.beginPath()
        ctx.arc(centerX, centerY, 15, 0, Math.PI * 2)
        ctx.fill()
        
        ctx.fillStyle = '#333333'
        ctx.font = 'bold 16px Arial'
        ctx.textAlign = 'center'
        ctx.fillText(`📍 ${lat.toFixed(6)}, ${lon.toFixed(6)}`, centerX, height - 30)
        
        return new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(blob)
            } else {
              reject(new Error('Failed to create blob from canvas'))
            }
          }, 'image/png')
        })
      }
      
      // Use OpenStreetMap (free, no API key required)
      blob = await createOSMMap(latitude, longitude, mapWidth, mapHeight, zoom, accuracy)
      
      // Create a File object from the blob
      const mapFile = new File([blob], `location-${Date.now()}.png`, { type: 'image/png' })
      
      // Upload to Cloudinary
      const formData = new FormData()
      formData.append('file', mapFile)
      formData.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!)
      
      const uploadResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`,
        { method: 'POST', body: formData }
      )
      
      const uploadData = await uploadResponse.json()
      
      if (uploadData.secure_url) {
        // Send location message with coordinates in content
        const locationText = `📍 My Location\nLat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}`
        await handleSend(uploadData.secure_url, 'image', locationText)
      } else {
        throw new Error('Failed to upload map image')
      }
    } catch (error: any) {
      console.error('Error sharing location:', error)
      // Clear interval if still running
      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }
      setLocationProgress(0)
      
      let errorMessage = ''
      let showGPSSettings = false
      
      if (error.code === 1) { // PERMISSION_DENIED
        errorMessage = 'Location permission denied. Please enable location access in your browser settings.'
        showGPSSettings = true
      } else if (error.code === 2) { // POSITION_UNAVAILABLE
        errorMessage = 'GPS location is not available. Please enable GPS/location services on your device and try again.'
        showGPSSettings = true
      } else if (error.code === 3) { // TIMEOUT
        errorMessage = 'Location request timed out. Please ensure GPS is enabled and try again.'
        showGPSSettings = true
      } else {
        errorMessage = 'Failed to share location: ' + (error.message || 'Unknown error')
      }
      
      // Show detailed error message with GPS enable instructions
      const gpsInstructions = showGPSSettings ? 
        '\n\nTo enable GPS:\n' +
        '• Mobile: Go to Settings > Location/GPS and enable it\n' +
        '• Desktop: Check browser location permissions in settings\n' +
        '• Make sure location services are enabled on your device' : ''
      
      alert(errorMessage + gpsInstructions)
    } finally {
      setLocationLoading(false)
      setLocationProgress(0)
      setUploading(false)
    }
  }


  if (!activeChat) return <div className="flex-1 flex items-center justify-center bg-slate-100 text-gray-400">Select a chat</div>

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 relative" style={{ willChange: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
      
      {/* Header - Always visible with highest z-index - Fixed position to prevent layout shifts */}
      <div 
        className="px-2 py-2 md:p-4 border-b border-gray-200 flex justify-between items-center bg-white shadow-sm shrink-0 w-full md:!left-80" 
        style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 99999, 
          backgroundColor: 'white',
          height: 'auto',
          minHeight: '56px',
          flexShrink: 0,
          isolation: 'isolate',
          pointerEvents: 'auto'
        }}
      >
        <div className="flex items-center gap-1.5 md:gap-3 flex-1 min-w-0">
          
          {/* Back Button (Only Visible on Mobile) */}
          <button 
            onClick={onBack}
            className="md:hidden p-1.5 -ml-1 text-gray-600 hover:bg-gray-100 rounded-full shrink-0"
          >
            <ArrowLeft size={18} />
          </button>

          <img src={activeChat.avatar || activeChat.avatar_url} className="w-7 h-7 md:w-10 md:h-10 rounded-full bg-gray-200 object-cover border border-gray-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-gray-800 text-sm md:text-lg leading-tight truncate">
              {activeChat.name || activeChat.nickname || activeChat.username}
            </h2>
            {!isGroup && <span className="text-[9px] md:text-xs text-green-600 font-medium">● Online</span>}
          </div>
        </div>
        
        <div className="flex items-center gap-0.5 md:gap-2">
          {/* Call Buttons - Only show when not in a call, smaller on mobile */}
          {!acceptedCallMode && !isGroup && (
            <>
              <button 
                onClick={() => {
                  // Trigger audio call via VideoCall component
                  const videoCallElement = document.querySelector('[data-video-call]') as any;
                  if (videoCallElement?.startAudioCall) {
                    videoCallElement.startAudioCall();
                  }
                }}
                className="p-1.5 md:p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors touch-manipulation"
                title="Audio Call"
              >
                <Phone size={18} className="md:w-5 md:h-5" />
              </button>
              <button 
                onClick={() => {
                  // Trigger video call via VideoCall component
                  const videoCallElement = document.querySelector('[data-video-call]') as any;
                  if (videoCallElement?.startVideoCall) {
                    videoCallElement.startVideoCall();
                  }
                }}
                className="p-1.5 md:p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors touch-manipulation"
                title="Video Call"
              >
                <VideoIcon size={18} className="md:w-5 md:h-5" />
              </button>
            </>
          )}
          
          {/* Home Button - Hidden on mobile (back button is shown instead) */}
          <button 
            onClick={onBack}
            className="hidden md:flex p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors touch-manipulation"
            title="Back to Home"
          >
            <Home size={20} />
          </button>
        </div>
      </div>

      {/* Spacer for fixed header */}
      <div className="h-[56px] md:h-[64px] shrink-0"></div>

      <div className="shrink-0 relative" style={{ position: 'relative', zIndex: 1, minHeight: '80px', maxHeight: '500px', overflow: 'visible' }}>
        <div data-video-call>
          <VideoCall 
            currentUser={user} 
            activeChat={activeChat} 
            isGroup={isGroup} 
            incomingMode={acceptedCallMode}
            onCallEnd={() => {
              // Call ended, reset acceptedCallMode to null
              console.log('📞 onCallEnd called from VideoCall, calling parent onCallEnd');
              onCallEnd?.();
            }}
          />
        </div>
      </div>

      {/* Messages Area - Adjusted padding for mobile */}
      <div 
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3 md:space-y-6 bg-slate-100 messages-container"
        style={{ 
          scrollBehavior: 'smooth', 
          WebkitOverflowScrolling: 'touch',
          minHeight: 0,
          maxHeight: '100%',
          overflowY: 'auto',
          overflowX: 'hidden'
        }}
      >
        {loadingChat ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="animate-spin text-blue-500" size={32} />
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isMe = msg.sender_id === user.id
              return (
                <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} px-1`}>
                  <div className={`flex max-w-[85%] md:max-w-[75%] ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-1.5 md:gap-2`}>
                    
                    {!isMe && (
                      <img src={msg.sender?.avatar || 'https://via.placeholder.com/40'} className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-gray-300 object-cover mb-1 border border-gray-200" />
                    )}

                    <div className={`p-2.5 md:p-3 rounded-2xl shadow-sm break-words ${
                      isMe 
                        ? 'bg-blue-600 text-white rounded-br-none' 
                        : 'bg-white text-gray-800 rounded-bl-none border border-gray-200'
                    }`}>
                        {!isMe && isGroup && <p className="text-[10px] font-bold text-orange-600 mb-1">{msg.sender?.username}</p>}
                        
                        {/* Image */}
                        {msg.type === 'image' && msg.fileUrl && (
                          <div className="mb-2 relative">
                            <img 
                              src={msg.fileUrl} 
                              className="rounded-lg max-h-48 md:max-h-60 w-full object-contain border border-black/10 cursor-pointer hover:opacity-90 transition-opacity" 
                              onClick={() => {
                                // Check if this is a location map (content contains coordinates)
                                const isLocation = msg.content?.includes('📍') || msg.content?.includes('Lat:') || msg.content?.includes('Lon:')
                                setZoomedImage({ url: msg.fileUrl, isLocation })
                                setImageZoom(1)
                                setImagePosition({ x: 0, y: 0 })
                              }}
                            />
                            {(msg.content?.includes('📍') || msg.content?.includes('Lat:') || msg.content?.includes('Lon:')) && (
                              <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                                <MapPin size={12} />
                                <span>Tap to zoom</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* File */}
                        {msg.type === 'file' && msg.fileUrl && (
                          <div className={`flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg mb-1 border ${isMe ? 'bg-white/10 border-white/20' : 'bg-gray-100 border-gray-200'}`}>
                            <div className={`${isMe ? 'bg-white/20' : 'bg-white'} p-2 rounded shadow-sm`}>
                              <FileText size={20} className={isMe ? 'text-white' : 'text-blue-500'} />
                            </div>
                            <div className="flex-1 min-w-[80px] max-w-[150px] md:max-w-[200px]">
                              <p className="text-xs md:text-sm font-bold truncate">{msg.content || "Document"}</p>
                              <p className="text-[9px] opacity-70">FILE</p>
                            </div>
                            <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className={`p-1.5 md:p-2 rounded-full transition-colors ${isMe ? 'bg-white/20 hover:bg-white/30' : 'bg-gray-200 hover:bg-gray-300'}`} download>
                              <Download size={14} />
                            </a>
                          </div>
                        )}
                        
                        {/* Text */}
                        {msg.type === 'text' && <span className="text-sm md:text-[15px] leading-relaxed break-words whitespace-pre-wrap word-wrap">{msg.content}</span>}
                        
                        {/* Timestamp and Read Status */}
                        <div className={`flex items-center justify-end gap-1 mt-1 ${isMe ? 'text-blue-100' : 'text-gray-400'}`}>
                          <span className={`text-[9px] md:text-[10px]`}>
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isMe ? (
                            // Read status for messages sent by current user
                            <div className="flex items-center">
                              {/* Check if message is optimistic (unsent) - ID is a timestamp (Date.now() creates IDs > 1e12) */}
                              {typeof msg.id === 'number' && msg.id > 1000000000000 ? (
                                // Single tick: unsent message (optimistic update)
                                <Check size={12} className="text-blue-200" />
                              ) : msg.is_read !== false ? (
                                // Two ticks green: sent and read (true or undefined both mean read when chat is open)
                                <>
                                  <Check size={12} className="text-green-400" />
                                  <Check size={12} className="text-green-400 -ml-1" />
                                </>
                              ) : (
                                // Two ticks red: sent but not read (is_read is explicitly false)
                                <>
                                  <Check size={12} className="text-red-400" />
                                  <Check size={12} className="text-red-400 -ml-1" />
                                </>
                              )}
                            </div>
                          ) : (
                            // Read status for messages received by current user
                            // Since chat is open, all received messages are considered read
                            <div className="flex items-center">
                              {/* When chat is open, all received messages show as read (green) */}
                              {msg.is_read !== false ? (
                                // Two ticks green: you have read it (chat is open, so it's read)
                                <>
                                  <Check size={12} className="text-green-400" />
                                  <Check size={12} className="text-green-400 -ml-1" />
                                </>
                              ) : (
                                // Two ticks red: unread (shouldn't happen when chat is open)
                                <>
                                  <Check size={12} className="text-red-400" />
                                  <Check size={12} className="text-red-400 -ml-1" />
                                </>
                              )}
                            </div>
                          )}
                        </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input Area - Fixed on mobile, relative on desktop */}
      <div 
        data-chat-input
        className="chat-input-area bg-white border-t border-gray-200 shrink-0"
        style={{
          width: '100%',
          maxWidth: '100%',
          backgroundColor: 'white',
          WebkitTransform: 'translateZ(0)',
          transform: 'translateZ(0)',
          visibility: 'visible',
          display: 'block'
        }}
      >
        <div className="p-2 md:p-4">
          <div className="flex gap-1 md:gap-3 max-w-4xl mx-auto items-center">
            
            <div className="flex gap-0.5 md:gap-2 shrink-0">
              <label className={`cursor-pointer p-2 md:p-2.5 rounded-full hover:bg-gray-100 active:bg-gray-200 touch-manipulation flex items-center justify-center ${uploading ? 'opacity-50' : ''}`} style={{ minWidth: '40px', minHeight: '40px' }}>
                {uploading ? <Loader2 className="animate-spin text-blue-500" size={20} /> : <ImageIcon size={20} className="text-gray-500 hover:text-blue-600 md:w-6 md:h-6" />}
                <input type="file" hidden accept="image/*" onChange={(e) => handleUpload(e, 'image')} disabled={uploading}/>
              </label>

              <label className={`cursor-pointer p-2 md:p-2.5 rounded-full hover:bg-gray-100 active:bg-gray-200 touch-manipulation flex items-center justify-center ${uploading ? 'opacity-50' : ''}`} style={{ minWidth: '40px', minHeight: '40px' }}>
                <Paperclip size={20} className="text-gray-500 hover:text-green-600 md:w-6 md:h-6" />
                <input type="file" hidden accept="*" onChange={(e) => handleUpload(e, 'file')} disabled={uploading}/>
              </label>

              <button 
                onClick={handleShareLocation} 
                disabled={uploading}
                className={`p-2 md:p-2.5 rounded-full hover:bg-gray-100 active:bg-gray-200 touch-manipulation flex items-center justify-center ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Share Location"
                style={{ minWidth: '40px', minHeight: '40px' }}
              >
                <MapPin size={20} className="text-gray-500 hover:text-red-600 md:w-6 md:h-6" />
              </button>
            </div>

            <input 
              className="flex-1 min-w-0 bg-gray-100 text-gray-800 placeholder-gray-500 rounded-full px-3 py-2 md:px-5 md:py-3 text-sm md:text-base border border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
              placeholder={uploading ? "..." : "Message"}
              value={text} 
              onChange={e => setText(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleSend()} 
              disabled={uploading}
              style={{ minHeight: '40px' }}
            />
            
            <button 
              onClick={() => handleSend()} 
              disabled={!text && !uploading} 
              className="bg-blue-600 p-2 md:p-3 rounded-full text-white hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 transition-colors shadow-sm shrink-0 touch-manipulation flex items-center justify-center"
              style={{ minWidth: '40px', minHeight: '40px' }}
            >
              <Send size={18} className="md:w-6 md:h-6" />
            </button>
          </div>
        </div>
      </div>

      {/* Location Loading Modal */}
      {locationLoading && (
        <div className="fixed inset-0 bg-black/70 z-[100001] flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 md:p-8 max-w-sm w-full mx-4 shadow-xl">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <MapPin size={48} className="text-blue-600 animate-pulse" />
                <Loader2 size={24} className="absolute -top-2 -right-2 text-blue-500 animate-spin" />
              </div>
              <div className="w-full">
                <h3 className="text-lg font-bold text-gray-800 mb-2 text-center">Getting your location...</h3>
                <p className="text-sm text-gray-600 mb-4 text-center">
                  {locationProgress < 50 
                    ? 'Requesting GPS access...' 
                    : locationProgress < 90
                    ? 'Waiting for GPS signal...'
                    : 'Finalizing location...'}
                </p>
                
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${locationProgress}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-500 text-center">{locationProgress}%</p>
                
                {locationProgress < 30 && (
                  <p className="text-xs text-orange-600 mt-2 text-center">
                    💡 If GPS is disabled, please enable it in your device settings
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image Zoom Modal */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 bg-black/90 z-[100000] flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setZoomedImage(null)
              setImageZoom(1)
              setImagePosition({ x: 0, y: 0 })
            }
          }}
        >
          {/* Close Button */}
          <button
            onClick={() => {
              setZoomedImage(null)
              setImageZoom(1)
              setImagePosition({ x: 0, y: 0 })
            }}
            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors z-10"
            title="Close"
          >
            <X size={24} />
          </button>

          {/* Zoom Controls */}
          <div className="absolute top-4 left-4 flex gap-2 z-10">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setImageZoom(prev => Math.min(prev + 0.25, 5))
              }}
              className="p-2 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
              title="Zoom In"
            >
              <ZoomIn size={20} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setImageZoom(prev => Math.max(prev - 0.25, 0.5))
              }}
              className="p-2 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
              title="Zoom Out"
            >
              <ZoomOut size={20} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setImageZoom(1)
                setImagePosition({ x: 0, y: 0 })
              }}
              className="p-2 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
              title="Reset"
            >
              <RotateCcw size={20} />
            </button>
          </div>

          {/* Zoomed Image */}
          <div 
            className="relative max-w-[95vw] max-h-[95vh] overflow-hidden"
            onWheel={(e) => {
              e.preventDefault()
              const delta = e.deltaY > 0 ? -0.1 : 0.1
              setImageZoom(prev => Math.max(0.5, Math.min(5, prev + delta)))
            }}
            onMouseDown={(e) => {
              if (imageZoom > 1) {
                isDraggingRef.current = true
                dragStartRef.current = { x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y }
              }
            }}
            onMouseMove={(e) => {
              if (isDraggingRef.current && imageZoom > 1) {
                setImagePosition({
                  x: e.clientX - dragStartRef.current.x,
                  y: e.clientY - dragStartRef.current.y
                })
              }
            }}
            onMouseUp={() => {
              isDraggingRef.current = false
            }}
            onMouseLeave={() => {
              isDraggingRef.current = false
            }}
            onTouchStart={(e) => {
              if (e.touches.length === 2) {
                // Pinch zoom
                e.preventDefault()
                const touch1 = e.touches[0]
                const touch2 = e.touches[1]
                const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
                ;(e.currentTarget as any)._pinchStartDistance = distance
                ;(e.currentTarget as any)._pinchStartZoom = imageZoom
              } else if (imageZoom > 1 && e.touches.length === 1) {
                // Single touch drag
                isDraggingRef.current = true
                dragStartRef.current = { x: e.touches[0].clientX - imagePosition.x, y: e.touches[0].clientY - imagePosition.y }
              }
            }}
            onTouchMove={(e) => {
              if (e.touches.length === 2) {
                // Pinch zoom
                e.preventDefault()
                const touch1 = e.touches[0]
                const touch2 = e.touches[1]
                const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY)
                const startDistance = (e.currentTarget as any)._pinchStartDistance
                const startZoom = (e.currentTarget as any)._pinchStartZoom
                if (startDistance) {
                  const scale = distance / startDistance
                  const newZoom = Math.max(0.5, Math.min(5, startZoom * scale))
                  setImageZoom(newZoom)
                }
              } else if (isDraggingRef.current && imageZoom > 1 && e.touches.length === 1) {
                // Single touch drag
                setImagePosition({
                  x: e.touches[0].clientX - dragStartRef.current.x,
                  y: e.touches[0].clientY - dragStartRef.current.y
                })
              }
            }}
            onTouchEnd={(e) => {
              isDraggingRef.current = false
              delete (e.currentTarget as any)._pinchStartDistance
              delete (e.currentTarget as any)._pinchStartZoom
            }}
          >
            <img
              ref={imageRef}
              src={zoomedImage.url}
              alt="Zoomed image"
              className="max-w-full max-h-[95vh] object-contain select-none"
              style={{
                transform: `scale(${imageZoom}) translate(${imagePosition.x / imageZoom}px, ${imagePosition.y / imageZoom}px)`,
                transformOrigin: 'center center',
                transition: isDraggingRef.current ? 'none' : 'transform 0.2s ease-out',
                cursor: imageZoom > 1 ? 'move' : 'default'
              }}
              draggable={false}
            />
          </div>

          {/* Zoom Level Indicator */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white/20 text-white px-4 py-2 rounded-full text-sm">
            {Math.round(imageZoom * 100)}%
          </div>
        </div>
      )}
    </div>
  )
}
