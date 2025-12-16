'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { User, Message } from '@/types'
import { Send, Image as ImageIcon, Loader2, Paperclip, FileText, Download, ArrowLeft } from 'lucide-react' // Added ArrowLeft
import VideoCall from './VideoCall'

interface ChatWindowProps {
  user: User;
  activeChat: any;
  isGroup: boolean;
  acceptedCallMode?: 'audio' | 'video' | null;
  onBack: () => void; // New Prop
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

  const fetchHistory = async () => { /* ... same as before ... */ 
      if (!activeChat) return
      let query = supabase.from('messages').select('*, sender:users!sender_id(username, avatar)').order('timestamp', { ascending: true })
      if (isGroup) query = query.eq('group_id', activeChat.id).is('recipient_id', null) 
      else query = query.is('group_id', null).or(`and(sender_id.eq.${user.id},recipient_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},recipient_id.eq.${user.id})`)
      const { data } = await query
      if (data) setMessages(data as any)
  }

  useEffect(() => { /* ... same as before ... */ 
      const channel = supabase.channel('global-chat-listener').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
          const newMsg = payload.new as Message
          if (!activeChatRef.current) return
          let isRelevant = false
          if (isGroupRef.current) isRelevant = (Number(newMsg.group_id) === Number(activeChatRef.current.id)) && (newMsg.recipient_id === null)
          else isRelevant = (newMsg.group_id === null) && ((newMsg.sender_id === activeChatRef.current.id && newMsg.recipient_id === userRef.current.id) || (newMsg.sender_id === userRef.current.id && newMsg.recipient_id === activeChatRef.current.id))
          if (isRelevant) {
             let senderData = null
             if (newMsg.sender_id === userRef.current.id) senderData = { username: userRef.current.username, avatar: userRef.current.avatar }
             else if (!isGroupRef.current && newMsg.sender_id === activeChatRef.current.id) senderData = { username: activeChatRef.current.username, avatar: activeChatRef.current.avatar }
             else { const { data } = await supabase.from('users').select('username, avatar').eq('id', newMsg.sender_id).single(); senderData = data }
             setMessages(prev => { if (prev.find(m => m.id === newMsg.id)) return prev; return [...prev, { ...newMsg, sender: senderData } as any] })
          }
      }).subscribe()
      return () => { supabase.removeChannel(channel) }
  }, [])
  
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth' }) }, [messages, loadingChat])

  const handleSend = async (fileUrl?: string, type: 'text'|'image'|'file' = 'text', fileName?: string) => { /* ... same as before ... */
    if (!text.trim() && !fileUrl) return
    const msgData = { sender_id: user.id, content: fileName || text, type, fileUrl, timestamp: new Date().toISOString(), group_id: isGroup ? activeChat.id : null, recipient_id: isGroup ? null : activeChat.id }
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
      </div>

      <VideoCall currentUser={user} activeChat={activeChat} isGroup={isGroup} incomingMode={acceptedCallMode} />

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
                        {msg.type === 'text' && <span className="text-sm md:text-[15px] leading-relaxed break-words">{msg.content}</span>}
                        
                        {/* Timestamp */}
                        <span className={`text-[9px] md:text-[10px] block text-right mt-1 ${isMe ? 'text-blue-100' : 'text-gray-400'}`}>
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
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
