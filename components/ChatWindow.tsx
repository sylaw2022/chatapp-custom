'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { User, Message } from '@/types'
import { Send, Image as ImageIcon, Loader2, Paperclip, FileText, Download, ArrowLeft, Home, Check } from 'lucide-react'
import VideoCall from './VideoCall'

interface ChatWindowProps {
  user: User;
  activeChat: any;
  isGroup: boolean;
  acceptedCallMode?: 'audio' | 'video' | null;
  onBack: () => void;
}

export default function ChatWindow({ user, activeChat, isGroup, acceptedCallMode, onBack }: ChatWindowProps) {
  // ... (All existing state logic remains identical) ...
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [loadingChat, setLoadingChat] = useState(false)
  
  const supabase = createClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  
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
      console.log('📖 Marking messages as read for chat:', activeChat.id, 'isGroup:', isGroup)
      
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
          console.log('✅ Marked group messages as read:', data?.length || 0, 'messages')
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
          console.log('✅ Marked received messages as read:', receivedData?.length || 0, 'messages')
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
  
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth' }) }, [messages, loadingChat])

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


  if (!activeChat) return <div className="flex-1 flex items-center justify-center bg-slate-100 text-gray-400">Select a chat</div>

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 relative">
      
      {/* Header - MODIFIED FOR MOBILE */}
      <div className="p-3 md:p-4 border-b border-gray-200 flex justify-between items-center bg-white shadow-sm z-10 sticky top-0">
        <div className="flex items-center gap-2 md:gap-3">
          
          {/* Back Button (Only Visible on Mobile) */}
          <button 
            onClick={onBack}
            className="md:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-full"
          >
            <ArrowLeft size={20} />
          </button>

          <img src={activeChat.avatar || activeChat.avatar_url} className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gray-200 object-cover border border-gray-300" />
          <div>
            <h2 className="font-bold text-gray-800 text-base md:text-lg leading-tight">
              {activeChat.name || activeChat.nickname || activeChat.username}
            </h2>
            {!isGroup && <span className="text-[10px] md:text-xs text-green-600 font-medium">● Online</span>}
          </div>
        </div>
        
        {/* Home Button (Visible on Desktop, also on Mobile) */}
        <button 
          onClick={onBack}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
          title="Back to Home"
        >
          <Home size={20} />
        </button>
      </div>

      <VideoCall 
        currentUser={user} 
        activeChat={activeChat} 
        isGroup={isGroup} 
        incomingMode={acceptedCallMode}
        onCallEnd={() => {
          // Call ended, reset any call-related state if needed
          // This prop is required by VideoCall component
        }}
      />

      {/* Messages Area - Adjusted padding for mobile */}
      <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-4 md:space-y-6 bg-slate-100">
        {loadingChat ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="animate-spin text-blue-500" size={32} />
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isMe = msg.sender_id === user.id
              return (
                <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex max-w-[90%] md:max-w-[75%] ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-1 md:gap-2`}>
                    
                    {!isMe && (
                      <img src={msg.sender?.avatar || 'https://via.placeholder.com/40'} className="w-6 h-6 md:w-8 md:h-8 rounded-full bg-gray-300 object-cover mb-1 border border-gray-200" />
                    )}

                    <div className={`p-2 md:p-3 rounded-2xl shadow-sm ${
                      isMe 
                        ? 'bg-blue-600 text-white rounded-br-none' 
                        : 'bg-white text-gray-800 rounded-bl-none border border-gray-200'
                    }`}>
                        {!isMe && isGroup && <p className="text-[10px] font-bold text-orange-600 mb-1">{msg.sender?.username}</p>}
                        
                        {/* Image */}
                        {msg.type === 'image' && msg.fileUrl && (
                          <img src={msg.fileUrl} className="mb-2 rounded-lg max-h-48 md:max-h-60 border border-black/10" />
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
                        {msg.type === 'text' && <span className="text-sm md:text-[15px] leading-relaxed wrap-break-word">{msg.content}</span>}
                        
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

      {/* Input Area - Adjusted for mobile touch targets */}
      <div className="p-2 md:p-4 bg-white border-t border-gray-200 pb-safe">
         <div className="flex gap-2 md:gap-3 max-w-4xl mx-auto items-center">
            
            <div className="flex gap-0 md:gap-1">
              <label className={`cursor-pointer p-2 rounded-full hover:bg-gray-100 ${uploading ? 'opacity-50' : ''}`}>
                {uploading ? <Loader2 className="animate-spin text-blue-500" size={20} /> : <ImageIcon size={20} className="text-gray-500 hover:text-blue-600" />}
                <input type="file" hidden accept="image/*" onChange={(e) => handleUpload(e, 'image')} disabled={uploading}/>
              </label>

              <label className={`cursor-pointer p-2 rounded-full hover:bg-gray-100 ${uploading ? 'opacity-50' : ''}`}>
                <Paperclip size={20} className="text-gray-500 hover:text-green-600" />
                <input type="file" hidden accept="*" onChange={(e) => handleUpload(e, 'file')} disabled={uploading}/>
              </label>
            </div>

            <input 
              className="flex-1 bg-gray-100 text-gray-800 placeholder-gray-500 rounded-full px-4 py-2 md:px-5 md:py-3 text-sm md:text-base border border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all" 
              placeholder={uploading ? "..." : "Message"}
              value={text} 
              onChange={e => setText(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleSend()} 
              disabled={uploading}
            />
            
            <button onClick={() => handleSend()} disabled={!text && !uploading} className="bg-blue-600 p-2 md:p-3 rounded-full text-white hover:bg-blue-700 disabled:bg-gray-300 transition-colors shadow-sm">
              <Send size={18} />
            </button>
         </div>
      </div>
    </div>
  )
}
