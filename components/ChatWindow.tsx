'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { User, Message } from '@/types'
import { Send, Image as ImageIcon, Loader2, Paperclip, FileText, Download } from 'lucide-react'
import VideoCall from './VideoCall'

interface ChatWindowProps {
  user: User;
  activeChat: any;
  isGroup: boolean;
  acceptedCallMode?: 'audio' | 'video' | null;
}

export default function ChatWindow({ user, activeChat, isGroup, acceptedCallMode }: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [loadingChat, setLoadingChat] = useState(false)
  
  const supabase = createClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  
  const activeChatRef = useRef(activeChat)
  const isGroupRef = useRef(isGroup)
  const userRef = useRef(user)

  // 1. Switch Chat Logic
  useEffect(() => {
    activeChatRef.current = activeChat
    isGroupRef.current = isGroup
    userRef.current = user
    setMessages([]) 
    if (activeChat) {
      setLoadingChat(true)
      fetchHistory().finally(() => setLoadingChat(false))
    }
  }, [activeChat?.id])

  // 2. Fetch History
  const fetchHistory = async () => {
    if (!activeChat) return

    let query = supabase.from('messages')
      .select('*, sender:users!sender_id(username, avatar)')
      .order('timestamp', { ascending: true })

    if (isGroup) {
      query = query.eq('group_id', activeChat.id).is('recipient_id', null) 
    } else {
      query = query.is('group_id', null).or(`and(sender_id.eq.${user.id},recipient_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},recipient_id.eq.${user.id})`)
    }

    const { data, error } = await query
    if (data) setMessages(data as any)
  }

  // 3. Realtime Listener
  useEffect(() => {
    const channel = supabase.channel('global-chat-listener')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
          const newMsg = payload.new as Message
          const currentChat = activeChatRef.current
          const currentIsGroup = isGroupRef.current
          const currentUser = userRef.current

          if (!currentChat) return

          let isRelevant = false
          if (currentIsGroup) {
            isRelevant = (Number(newMsg.group_id) === Number(currentChat.id)) && (newMsg.recipient_id === null)
          } else {
            isRelevant = (newMsg.group_id === null) && (
              (newMsg.sender_id === currentChat.id && newMsg.recipient_id === currentUser.id) || 
              (newMsg.sender_id === currentUser.id && newMsg.recipient_id === currentChat.id)
            )
          }

          if (isRelevant) {
             let senderData = null
             if (newMsg.sender_id === currentUser.id) {
               senderData = { username: currentUser.username, avatar: currentUser.avatar }
             } else if (!currentIsGroup && newMsg.sender_id === currentChat.id) {
               senderData = { username: currentChat.username, avatar: currentChat.avatar }
             } else {
               const { data } = await supabase.from('users').select('username, avatar').eq('id', newMsg.sender_id).single()
               senderData = data
             }

             setMessages(prev => {
               if (prev.find(m => m.id === newMsg.id)) return prev
               return [...prev, { ...newMsg, sender: senderData } as any]
             })
          }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => { 
    if (scrollRef.current) scrollRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loadingChat])

  // 4. Send Message Logic
  const handleSend = async (fileUrl?: string, type: 'text'|'image'|'file' = 'text', fileName?: string) => {
    if (!text.trim() && !fileUrl) return

    const msgData = {
      sender_id: user.id,
      content: fileName || text, 
      type,
      fileUrl,
      timestamp: new Date().toISOString(),
      group_id: isGroup ? activeChat.id : null, 
      recipient_id: isGroup ? null : activeChat.id
    }

    const optimisticId = Date.now()
    setMessages(prev => [...prev, { ...msgData, id: optimisticId, sender: { username: user.username, avatar: user.avatar } } as any])
    setText('')

    const { data, error } = await supabase.from('messages').insert(msgData).select().single()
    
    if (error) {
      console.error("Send failed:", error)
      setMessages(prev => prev.filter(m => m.id !== optimisticId)) 
    } else if (data) {
      setMessages(prev => prev.map(m => m.id === optimisticId ? { ...m, id: data.id } : m))
    }
  }

  // 5. Universal Upload Handler
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, fileType: 'image' | 'file') => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    
    const formData = new FormData()
    formData.append('file', file)
    formData.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!)
    
    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/auto/upload`, { method: 'POST', body: formData })
      const data = await res.json()
      
      if (data.secure_url) {
        await handleSend(data.secure_url, fileType, file.name)
      } else {
        alert("Upload failed: " + (data.error?.message || "Unknown error"))
      }
    } catch(e) { 
      console.error(e) 
      alert("Upload error")
    } finally { 
      setUploading(false) 
    }
  }

  if (!activeChat) return <div className="flex-1 flex items-center justify-center bg-slate-100 text-gray-400">Select a chat</div>

  return (
    // Changed: Background from bg-gray-950 to bg-slate-100
    <div className="flex-1 flex flex-col h-screen bg-slate-100 relative">
      
      {/* Header - Changed to White with Border */}
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-white shadow-sm z-10">
        <div className="flex items-center gap-3">
          <img src={activeChat.avatar || activeChat.avatar_url} className="w-10 h-10 rounded-full bg-gray-200 object-cover border border-gray-300" />
          <div>
            {/* Text Color: Dark Gray */}
            <h2 className="font-bold text-gray-800 text-lg">{activeChat.name || activeChat.nickname || activeChat.username}</h2>
            {!isGroup && <span className="text-xs text-green-600 font-medium">● Online</span>}
          </div>
        </div>
      </div>

      <VideoCall currentUser={user} activeChat={activeChat} isGroup={isGroup} incomingMode={acceptedCallMode} />

      {/* Messages Area - Light Gray Background */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-100">
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
                  <div className={`flex max-w-[85%] ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                    
                    {!isMe && (
                      <img src={msg.sender?.avatar || 'https://via.placeholder.com/40'} className="w-8 h-8 rounded-full bg-gray-300 object-cover mb-1 border border-gray-200" />
                    )}

                    {/* 
                       Bubbles Logic:
                       - Me (Right): Blue Background, White Text (High Contrast)
                       - Them (Left): White Background, Dark Gray Text, Shadow (High Contrast)
                    */}
                    <div className={`p-3 rounded-2xl shadow-sm ${
                      isMe 
                        ? 'bg-blue-600 text-white rounded-br-none' 
                        : 'bg-white text-gray-800 rounded-bl-none border border-gray-200'
                    }`}>
                        {!isMe && isGroup && <p className="text-[10px] font-bold text-orange-600 mb-1">{msg.sender?.username}</p>}
                        
                        {/* Image */}
                        {msg.type === 'image' && msg.fileUrl && (
                          <img src={msg.fileUrl} className="mb-2 rounded-lg max-h-60 border border-black/10" />
                        )}

                        {/* File */}
                        {msg.type === 'file' && msg.fileUrl && (
                          <div className={`flex items-center gap-3 p-3 rounded-lg mb-1 border ${isMe ? 'bg-white/10 border-white/20' : 'bg-gray-100 border-gray-200'}`}>
                            <div className={`${isMe ? 'bg-white/20' : 'bg-white'} p-2 rounded shadow-sm`}>
                              <FileText size={24} className={isMe ? 'text-white' : 'text-blue-500'} />
                            </div>
                            <div className="flex-1 min-w-[100px] max-w-[200px]">
                              <p className="text-sm font-bold truncate">{msg.content || "Document"}</p>
                              <p className="text-[10px] opacity-70">FILE</p>
                            </div>
                            <a 
                              href={msg.fileUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className={`p-2 rounded-full transition-colors ${isMe ? 'bg-white/20 hover:bg-white/30' : 'bg-gray-200 hover:bg-gray-300'}`}
                              download
                            >
                              <Download size={16} />
                            </a>
                          </div>
                        )}
                        
                        {/* Text */}
                        {msg.type === 'text' && <span className="text-[15px] leading-relaxed">{msg.content}</span>}
                        
                        {/* Timestamp */}
                        <span className={`text-[10px] block text-right mt-1 ${isMe ? 'text-blue-100' : 'text-gray-400'}`}>
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

      {/* Input Area - White Background */}
      <div className="p-4 bg-white border-t border-gray-200">
         <div className="flex gap-3 max-w-4xl mx-auto items-center">
            
            <div className="flex gap-1">
              {/* Icons: Darker Gray */}
              <label className={`cursor-pointer p-2 rounded-full hover:bg-gray-100 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`} title="Send Image">
                {uploading ? <Loader2 className="animate-spin text-blue-500" size={20} /> : <ImageIcon size={22} className="text-gray-500 hover:text-blue-600" />}
                <input type="file" hidden accept="image/*" onChange={(e) => handleUpload(e, 'image')} disabled={uploading}/>
              </label>

              <label className={`cursor-pointer p-2 rounded-full hover:bg-gray-100 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`} title="Send File">
                <Paperclip size={22} className="text-gray-500 hover:text-green-600" />
                <input type="file" hidden accept="*" onChange={(e) => handleUpload(e, 'file')} disabled={uploading}/>
              </label>
            </div>

            {/* Input Field: Light Gray Background, Dark Text */}
            <input 
              className="flex-1 bg-gray-100 text-gray-800 placeholder-gray-500 rounded-full px-5 py-3 border border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" 
              placeholder={uploading ? "Uploading..." : "Type a message..."}
              value={text} 
              onChange={e => setText(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleSend()} 
              disabled={uploading}
            />
            
            <button 
              onClick={() => handleSend()} 
              disabled={!text && !uploading}
              className="bg-blue-600 p-3 rounded-full text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Send size={20}/>
            </button>
         </div>
      </div>
    </div>
  )
}
