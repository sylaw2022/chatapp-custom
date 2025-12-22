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
          onReject={() => setIncomingCall(null)}
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
        flex-1 flex-col h-full relative bg-slate-100 z-10
      `}>
        <ChatWindow 
          user={currentUser} 
          activeChat={activeChat} 
          isGroup={isGroup} 
          acceptedCallMode={acceptedCallMode} 
          onBack={() => setActiveChat(null)}
        />
      </div>
    </main>
  )
}
