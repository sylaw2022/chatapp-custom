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
  
  const supabase = createClient()

  // Clear accepted mode when switching chats manually
  useEffect(() => {
    if (activeChat) {
      const timer = setTimeout(() => setAcceptedCallMode(null), 2000)
      return () => clearTimeout(timer)
    }
  }, [activeChat])

  // Global Call Listener
  useEffect(() => {
    if (!currentUser) return
    const channel = supabase.channel(`notifications-${currentUser.id}`)
    channel.on('broadcast', { event: 'incoming-call' }, ({ payload }) => {
        setIncomingCall(payload)
    }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentUser])

  const acceptCall = () => {
    if (!incomingCall) return
    setActiveChat(incomingCall.caller)
    setIsGroup(false) 
    setAcceptedCallMode(incomingCall.callType)
    setIncomingCall(null)
  }

  // --- NEW: Handle Profile Update ---
  const handleProfileUpdate = (updatedUser: User) => {
    setCurrentUser(updatedUser)
    // Also update activeChat if we are chatting with ourselves (rare, but good for consistency)
    if (activeChat?.id === updatedUser.id && !isGroup) {
      setActiveChat(updatedUser)
    }
  }

  if (!currentUser) return <Auth onLogin={setCurrentUser} />

  return (
    <main className="flex min-h-screen bg-black">
      {incomingCall && (
        <IncomingCall 
          caller={incomingCall.caller}
          callType={incomingCall.callType}
          onAccept={acceptCall}
          onReject={() => setIncomingCall(null)}
        />
      )}

      {/* Pass onUpdateUser to Sidebar */}
      <Sidebar 
        currentUser={currentUser} 
        onSelect={(chat, group) => { setActiveChat(chat); setIsGroup(group); }} 
        onUpdateUser={handleProfileUpdate} 
      />
      
      <div className="flex-1 flex flex-col relative">
        <ChatWindow 
          user={currentUser} 
          activeChat={activeChat} 
          isGroup={isGroup} 
          acceptedCallMode={acceptedCallMode} 
        />
      </div>
    </main>
  )
}
