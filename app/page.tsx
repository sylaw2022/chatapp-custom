'use client'
import { useState, useEffect } from 'react'
import Auth from '@/components/Auth'
import Sidebar from '@/components/Sidebar'
import ChatWindow from '@/components/ChatWindow'
import IncomingCall from '@/components/IncomingCall'
import { User } from '@/types'
import { createClient } from '@/lib/supabase'

export default function Home() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [activeChat, setActiveChat] = useState<any>(null)
  const [isGroup, setIsGroup] = useState(false)
  
  // Call States
  const [incomingCall, setIncomingCall] = useState<any>(null)
  const [acceptedCallMode, setAcceptedCallMode] = useState<'audio' | 'video' | null>(null)
  
  // Don't clear acceptedCallMode automatically - let the call continue
  // Only clear when switching to a different chat
  useEffect(() => {
    // Only clear if switching to a different chat (not just when acceptedCallMode is set)
    // This prevents premature call termination
  }, [activeChat?.id]) // Only trigger when chat ID actually changes

  // Global Call Listener
  useEffect(() => {
    if (!currentUser) return
    const supabase = createClient()
    const channel = supabase.channel(`notifications-${currentUser.id}`)
    
    // Listen for incoming calls
    channel.on('broadcast', { event: 'incoming-call' }, ({ payload }) => {
        setIncomingCall(payload)
    })
    
    // Also listen for call rejections (for when we're the sender)
    // Dispatch a custom event that VideoCall can listen to
    channel.on('broadcast', { event: 'call-rejected' }, ({ payload }) => {
        console.log('📨 [GLOBAL LISTENER] Received call-rejected signal:', payload)
        console.log('📨 [GLOBAL LISTENER] Payload type:', typeof payload, 'Payload keys:', payload ? Object.keys(payload) : 'null')
        console.log('📨 [GLOBAL LISTENER] Dispatching window event with payload:', JSON.stringify(payload))
        // Dispatch a custom event that VideoCall component can listen to
        const event = new CustomEvent('call-rejected', { detail: payload })
        window.dispatchEvent(event)
        console.log('✅ [GLOBAL LISTENER] Window event dispatched')
    })
    
    // Listen for ANY broadcast to debug (including call-rejected to see if it's received)
    channel.on('broadcast', {}, ({ event, payload }) => {
        if (event === 'call-rejected') {
          console.log('🔍 [GLOBAL LISTENER] call-rejected broadcast detected - event:', event)
          console.log('🔍 [GLOBAL LISTENER] call-rejected payload:', payload)
          console.log('🔍 [GLOBAL LISTENER] call-rejected payload type:', typeof payload, 'Payload keys:', payload ? Object.keys(payload) : 'null')
        } else if (event !== 'incoming-call') { // Don't log incoming-call to reduce noise
          console.log('🔍 [GLOBAL LISTENER] Any broadcast received - event:', event, 'payload:', payload)
        }
    })
    
    // Subscribe to the channel and log status
    channel.subscribe((status) => {
      console.log('📡 [GLOBAL LISTENER] Channel subscription status:', status, 'channel:', `notifications-${currentUser.id}`)
      if (status === 'SUBSCRIBED') {
        console.log('✅ [GLOBAL LISTENER] Global listener is ready to receive rejection signals')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('❌ [GLOBAL LISTENER] Failed to subscribe:', status)
      }
    })
    
    return () => { 
      console.log('🧹 [GLOBAL LISTENER] Cleaning up global listener channel')
      supabase.removeChannel(channel) 
    }
  }, [currentUser])

  // Function to send rejection signal to caller
  const rejectCall = async (callerId: number, roomId?: string) => {
    if (!currentUser) return
    const supabase = createClient()
    console.log('📤 [RECEIVER] Sending rejection signal to caller:', callerId, 'from receiver:', currentUser.id, 'roomId:', roomId)
    
    const rejectionPayload = { 
      rejectedBy: currentUser.id,
      rejectedByUsername: currentUser.username || 'Unknown'
    }
    console.log('📤 [RECEIVER] Rejection payload:', JSON.stringify(rejectionPayload))
    console.log('📤 [RECEIVER] Rejection payload details - rejectedBy:', rejectionPayload.rejectedBy, 'rejectedByUsername:', rejectionPayload.rejectedByUsername)
    
    // Try sending on room channel first (if roomId is available and caller is already in the room)
    if (roomId) {
      try {
        console.log('📤 [RECEIVER] Attempting to send rejection on room channel:', roomId)
        const roomChannel = supabase.channel(roomId)
        
        // Wait for subscription using Promise
        const roomSubscriptionPromise = new Promise<void>((resolve, reject) => {
          roomChannel.subscribe((status) => {
            console.log('📡 [RECEIVER] Room channel subscription status:', status, 'roomId:', roomId)
            if (status === 'SUBSCRIBED') {
              console.log('✅ [RECEIVER] Room channel subscribed, ready to send rejection signal')
              resolve()
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('❌ [RECEIVER] Room channel subscription failed:', status)
              reject(new Error(`Room channel subscription failed: ${status}`))
            }
          })
        })
        
        // Wait for subscription, then send
        try {
          await roomSubscriptionPromise
          // Give it a moment to ensure subscription is fully active
          await new Promise(resolve => setTimeout(resolve, 200))
          console.log('📤 [RECEIVER] Sending rejection on room channel with payload:', JSON.stringify(rejectionPayload))
          const sendResult = await roomChannel.send({ 
            type: 'broadcast', 
            event: 'call-rejected', 
            payload: rejectionPayload
          })
          console.log('✅ [RECEIVER] Rejection signal sent on room channel, result:', sendResult)
        } catch (sendError) {
          console.error('❌ [RECEIVER] Error sending rejection on room channel:', sendError)
        }
        
        // Clean up after sending
        setTimeout(() => {
          console.log('🧹 [RECEIVER] Cleaning up room channel')
          supabase.removeChannel(roomChannel)
        }, 3000)
      } catch (error) {
        console.error('❌ [RECEIVER] Error setting up room channel:', error)
      }
    } else {
      console.log('⚠️ [RECEIVER] No roomId provided, skipping room channel rejection')
    }
    
    // Send on caller's notification channel (primary method)
    // The sender sets up a listener on this channel before sending the call notification
    try {
      console.log('📤 [RECEIVER] Attempting to send rejection on notification channel:', `notifications-${callerId}`)
      const callerChannel = supabase.channel(`notifications-${callerId}`)
      
      // Set up listener to verify the channel is working (optional, for debugging)
      callerChannel.on('broadcast', {}, ({ event, payload }) => {
        console.log('🔍 [RECEIVER] Notification channel broadcast received - event:', event, 'payload:', payload)
      })
      
      // Wait for subscription using Promise
      const notificationSubscriptionPromise = new Promise<void>((resolve, reject) => {
        callerChannel.subscribe((status) => {
          console.log('📡 [RECEIVER] Notification channel subscription status:', status, 'channel:', `notifications-${callerId}`)
          if (status === 'SUBSCRIBED') {
            console.log('✅ [RECEIVER] Caller notification channel subscribed, ready to send rejection signal')
            resolve()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('❌ [RECEIVER] Notification channel subscription failed:', status)
            reject(new Error(`Notification channel subscription failed: ${status}`))
          }
        })
      })
      
      // Wait for subscription, then send
      try {
        await notificationSubscriptionPromise
        // Give it a moment to ensure subscription is fully active
        await new Promise(resolve => setTimeout(resolve, 200))
        console.log('📤 [RECEIVER] Sending rejection on notification channel with payload:', JSON.stringify(rejectionPayload))
        const sendResult = await callerChannel.send({ 
          type: 'broadcast', 
          event: 'call-rejected', 
          payload: rejectionPayload
        })
        console.log('✅ [RECEIVER] Rejection signal sent on notification channel, result:', sendResult)
      } catch (sendError) {
        console.error('❌ [RECEIVER] Error sending rejection on notification channel:', sendError)
      }
      
      // Clean up after sending (give it time to be received)
      setTimeout(() => {
        console.log('🧹 [RECEIVER] Cleaning up notification channel')
        supabase.removeChannel(callerChannel)
      }, 3000)
    } catch (error) {
      console.error('❌ [RECEIVER] Error setting up notification channel:', error)
    }
    
    // Clear local state
    setIncomingCall(null)
    setAcceptedCallMode(null)
  }

  const acceptCall = () => {
    if (!incomingCall) return
    setActiveChat(incomingCall.caller)
    setIsGroup(false) 
    setAcceptedCallMode(incomingCall.callType)
    setIncomingCall(null)
  }

  const handleProfileUpdate = (updatedUser: User) => {
    setCurrentUser(updatedUser)
    if (activeChat?.id === updatedUser.id && !isGroup) {
      setActiveChat(updatedUser)
    }
  }

  if (!currentUser) return <Auth onLogin={setCurrentUser} />

  return (
    <main className="flex h-screen bg-black overflow-hidden relative">
      {incomingCall && (
        <IncomingCall 
          caller={incomingCall.caller}
          callType={incomingCall.callType}
          onAccept={acceptCall}
          onReject={async () => {
            // Send rejection signal to caller before clearing local state
            if (incomingCall?.caller?.id) {
              // Extract roomId from incomingCall payload if available
              const roomId = (incomingCall as any).roomId
              await rejectCall(incomingCall.caller.id, roomId)
            } else {
              // Fallback: just clear local state if caller info not available
              setIncomingCall(null)
              setAcceptedCallMode(null)
            }
          }}
        />
      )}

      {/* 
        SIDEBAR CONTAINER 
        - Mobile: Hidden if chat is active. W-full.
        - Desktop (md): Always flex. Fixed width handled inside component.
      */}
      <div className={`
        ${activeChat ? 'hidden md:flex' : 'flex'} 
        w-full md:w-auto flex-col h-full z-20
      `}>
        <Sidebar 
          key={activeChat ? 'sidebar-with-chat' : 'sidebar-no-chat'} 
          currentUser={currentUser} 
          onSelect={(chat, group) => { setActiveChat(chat); setIsGroup(group); }} 
          onUpdateUser={handleProfileUpdate}
          onLogout={() => setCurrentUser(null)} // Logout handler
        />
      </div>
      
      {/* 
        CHAT WINDOW CONTAINER
        - Mobile: Hidden if NO chat active. W-full.
        - Desktop (md): Always flex. Flex-1 to take remaining space.
      */}
      <div className={`
        ${!activeChat ? 'hidden md:flex' : 'flex'} 
        flex-1 flex-col h-full relative bg-slate-100
      `} style={{ zIndex: 10 }}>
        <ChatWindow 
          user={currentUser} 
          activeChat={activeChat} 
          isGroup={isGroup} 
          acceptedCallMode={acceptedCallMode} 
          onBack={() => setActiveChat(null)}
          onCallEnd={() => {
            console.log('📞 Call ended, resetting acceptedCallMode');
            setAcceptedCallMode(null);
          }}
        />
      </div>
    </main>
  )
}
