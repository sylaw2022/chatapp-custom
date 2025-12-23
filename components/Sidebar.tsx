'use client'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase'
import { User, Group, Message } from '@/types'
import { UserPlus, Users, MessageSquare, X, Search, Check, Plus, Trash2, Settings, Camera, Loader2, Save, RefreshCw, LogOut, Upload, Image as ImageIcon } from 'lucide-react'

interface SidebarProps {
  currentUser: User;
  onSelect: (chat: any, isGroup: boolean) => void;
  onUpdateUser: (updatedUser: User) => void;
  onLogout: () => void; // New Prop for logout
}

interface FriendWithLatestMessage extends User {
  latestMessage?: Message | null;
}

interface GroupWithLatestMessage extends Group {
  latestMessage?: Message | null;
}

export default function Sidebar({ currentUser, onSelect, onUpdateUser, onLogout }: SidebarProps) {
  const [friends, setFriends] = useState<FriendWithLatestMessage[]>([])
  const [groups, setGroups] = useState<GroupWithLatestMessage[]>([])
  const [view, setView] = useState<'friends' | 'groups'>('friends')
  const [isRefreshing, setIsRefreshing] = useState(false)
  
  // Modal States
  const [showFriendModal, setShowFriendModal] = useState(false)
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false) // New Modal State
  
  // Data States
  const [availableUsers, setAvailableUsers] = useState<User[]>([])
  const [newGroupName, setNewGroupName] = useState('')
  const [selectedFriendIds, setSelectedFriendIds] = useState<number[]>([])

  // Profile Edit States
  const [editNickname, setEditNickname] = useState('')
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null)
  const [editAvatarPreview, setEditAvatarPreview] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  
  // Background Management States
  const [userBackgrounds, setUserBackgrounds] = useState<Array<{ id: string; name: string; url: string }>>([])
  const [selectedBackground, setSelectedBackground] = useState<string>('none')
  const backgroundFileInputRef = useRef<HTMLInputElement>(null)
  
  // Predefined background options (same as VideoCall)
  const BACKGROUND_OPTIONS = [
    { id: 'none', name: 'None', url: null },
    { id: 'blur', name: 'Blur', url: 'blur' },
    { id: 'office', name: 'Office', url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&h=1080&fit=crop' },
    { id: 'beach', name: 'Beach', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&h=1080&fit=crop' },
    { id: 'space', name: 'Space', url: 'https://images.unsplash.com/photo-1446776653964-20c1d3a81b06?w=1920&h=1080&fit=crop' },
    { id: 'nature', name: 'Nature', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&h=1080&fit=crop' },
  ]
  
  // Get all available backgrounds
  const getAllBackgrounds = () => {
    return [...BACKGROUND_OPTIONS, ...userBackgrounds]
  }
  
  // Get background by ID
  const getBackgroundById = (id: string) => {
    return getAllBackgrounds().find(bg => bg.id === id)
  }

  const supabase = createClient()

  // Define fetchData first so it can be used in useEffect
  const fetchData = async () => {
    if (!currentUser || !currentUser.id) {
      console.warn('⚠️ Cannot fetch data: currentUser is not set')
      return
    }
    
    setIsRefreshing(true)
    try {
      console.log('🔄 Starting fetchData for user:', currentUser.id, currentUser.username)
      // 1. Fetch Friends
      const { data: friendLinks, error: friendLinksError } = await supabase.from('friends').select('friend_id').eq('user_id', currentUser.id)
      if (friendLinksError) {
        console.error('Error fetching friend links:', friendLinksError)
        setIsRefreshing(false)
        return
      }
      
      let currentFriendIds: number[] = []
      
      if (friendLinks) {
        currentFriendIds = friendLinks.map((f: any) => f.friend_id)
        if (currentFriendIds.length > 0) {
          const { data: friendList, error: friendListError } = await supabase.from('users').select('*').in('id', currentFriendIds)
          if (friendListError) {
            console.error('Error fetching friend list:', friendListError)
            setIsRefreshing(false)
            return
          }
          
          if (friendList) {
            // Fetch latest message from either party (sent or received) for each friend
            const friendsWithMessages = await Promise.all(
              (friendList as User[]).map(async (friend) => {
                try {
                  console.log(`🔍 Fetching latest message for friend: ${friend.username} (ID: ${friend.id}), conversation with user: ${currentUser.id}`)
                  
                  // Get latest message from either party
                  const { data: latestMsgData, error: msgError } = await supabase
                    .from('messages')
                    .select('*')
                    .is('group_id', null)
                    .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${friend.id}),and(sender_id.eq.${friend.id},recipient_id.eq.${currentUser.id})`)
                    .order('timestamp', { ascending: false })
                    .limit(1)
                  
                  if (msgError) {
                    console.error(`❌ Error fetching latest message for friend ${friend.id}:`, msgError)
                    return {
                      ...friend,
                      latestMessage: null
                    } as FriendWithLatestMessage
                  }
                  
                  console.log(`📦 Raw message data for ${friend.username}:`, latestMsgData)
                  
                  const latestMsg = latestMsgData && Array.isArray(latestMsgData) && latestMsgData.length > 0 ? latestMsgData[0] : null
                  
                  // Debug logging
                  if (latestMsg) {
                    const isFromMe = latestMsg.sender_id === currentUser.id
                    console.log(`✅ Latest message for ${friend.username}:`, {
                      id: latestMsg.id,
                      content: latestMsg.content?.substring(0, 50) || '[no content]',
                      read: latestMsg.is_read,
                      type: latestMsg.type,
                      timestamp: latestMsg.timestamp,
                      fromMe: isFromMe
                    })
                  } else {
                    console.log(`❌ No messages found for ${friend.username} (conversation between user ${currentUser.id} and friend ${friend.id})`)
                  }
                  
                  return {
                    ...friend,
                    latestMessage: latestMsg
                  } as FriendWithLatestMessage
                } catch (error) {
                  console.error(`💥 Exception fetching message for friend ${friend.id}:`, error)
                  return {
                    ...friend,
                    latestMessage: null
                  } as FriendWithLatestMessage
                }
              })
            )
            
            console.log(`📋 Final friendsWithMessages:`, friendsWithMessages.map(f => ({
              username: f.username,
              hasMessage: !!f.latestMessage,
              messageContent: f.latestMessage?.content?.substring(0, 30)
            })))
            
            setFriends(friendsWithMessages)
          }
        } else {
          setFriends([])
        }
      }

      // 2. Fetch Groups
      const { data: groupLinks, error: groupLinksError } = await supabase.from('group_members').select('group_id').eq('user_id', currentUser.id)
      if (groupLinksError) {
        console.error('Error fetching group links:', groupLinksError)
        setIsRefreshing(false)
        return
      }
      
      if (groupLinks && groupLinks.length > 0) {
        const gIds = groupLinks.map((g: any) => g.group_id)
        const { data: groupList, error: groupListError } = await supabase.from('groups').select('*').in('id', gIds)
        if (groupListError) {
          console.error('Error fetching group list:', groupListError)
          setIsRefreshing(false)
          return
        }
        
        if (groupList) {
          // Fetch latest message from any member in each group
          const groupsWithMessages = await Promise.all(
            (groupList as Group[]).map(async (group) => {
              try {
                const { data: latestMsgData, error: msgError } = await supabase
                  .from('messages')
                  .select('*')
                  .eq('group_id', group.id)
                  .is('recipient_id', null)
                  .order('timestamp', { ascending: false })
                  .limit(1)
                
                if (msgError) {
                  console.error(`Error fetching latest message for group ${group.id}:`, msgError)
                  return {
                    ...group,
                    latestMessage: null
                  } as GroupWithLatestMessage
                }
                
                const latestMsg = latestMsgData && Array.isArray(latestMsgData) && latestMsgData.length > 0 ? latestMsgData[0] : null
                
                if (latestMsg) {
                  const isFromMe = latestMsg.sender_id === currentUser.id
                  console.log(`✓ Latest message for group ${group.name}:`, latestMsg.content?.substring(0, 50) || '[no content]', '| Read:', latestMsg.is_read, '| FromMe:', isFromMe)
                }
                
                return {
                  ...group,
                  latestMessage: latestMsg
                } as GroupWithLatestMessage
              } catch (error) {
                console.error(`Exception fetching message for group ${group.id}:`, error)
                return {
                  ...group,
                  latestMessage: null
                } as GroupWithLatestMessage
              }
            })
          )
          setGroups(groupsWithMessages)
        }
      } else {
        setGroups([])
      }
    } catch (error) {
      console.error('Error in fetchData:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    console.log('🔄 Sidebar mounted or currentUser changed, fetching data...', { currentUser: currentUser?.id, username: currentUser?.username })
    if (currentUser && currentUser.id) {
      fetchData()
    } else {
      console.warn('⚠️ Sidebar useEffect: currentUser is not available yet')
    }
  }, [currentUser?.id]) // Use currentUser.id to avoid unnecessary re-renders

  // Refresh data periodically as a fallback (realtime should handle most updates)
  useEffect(() => {
    if (!currentUser?.id) return
    
    const interval = setInterval(() => {
      console.log('⏰ Periodic refresh triggered')
      fetchData()
    }, 30000) // Refresh every 30 seconds as fallback

    return () => clearInterval(interval)
  }, [currentUser?.id])

  // Realtime listener for new messages to update latest message previews
  useEffect(() => {
    if (!currentUser) return
    
    const channel = supabase.channel('sidebar-messages-listener')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages'
      }, async (payload) => {
        const newMsg = payload.new as Message
        console.log('📨 New message inserted in sidebar:', newMsg)
        
        // Update friend's latest message if it's a direct message involving current user
        if (newMsg.recipient_id && !newMsg.group_id) {
          // Check if message is from or to a friend
          const isFromMe = newMsg.sender_id === currentUser.id
          const isToMe = newMsg.recipient_id === currentUser.id
          const friendId = isFromMe ? newMsg.recipient_id : newMsg.sender_id
          
          if (isFromMe || isToMe) {
            console.log(`Updating latest message for friend ${friendId}`)
            setFriends(prev => prev.map(f => 
              f.id === friendId 
                ? { ...f, latestMessage: newMsg }
                : f
            ))
          }
        }
        // Update group's latest message if it's a group message (from any member)
        if (newMsg.group_id && !newMsg.recipient_id) {
          console.log(`Updating latest message for group ${newMsg.group_id}`)
          setGroups(prev => prev.map(g => 
            g.id === newMsg.group_id 
              ? { ...g, latestMessage: newMsg }
              : g
          ))
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages'
      }, async (payload) => {
        const updatedMsg = payload.new as Message
        
        // Update read status for messages sent by current user (when recipient reads them)
        if (updatedMsg.sender_id === currentUser.id) {
          // Update read status in friend's latest message
          if (updatedMsg.recipient_id && !updatedMsg.group_id) {
            setFriends(prev => prev.map(f => 
              f.id === updatedMsg.recipient_id && f.latestMessage?.id === updatedMsg.id
                ? { ...f, latestMessage: updatedMsg }
                : f
            ))
          }
          // Update read status in group's latest message
          if (updatedMsg.group_id && !updatedMsg.recipient_id) {
            setGroups(prev => prev.map(g => 
              g.id === updatedMsg.group_id && g.latestMessage?.id === updatedMsg.id
                ? { ...g, latestMessage: updatedMsg }
                : g
            ))
          }
        }
        
        // Update read status for messages received by current user (when you read them)
        if (updatedMsg.recipient_id === currentUser.id && !updatedMsg.group_id) {
          setFriends(prev => prev.map(f => 
            f.id === updatedMsg.sender_id && f.latestMessage?.id === updatedMsg.id
              ? { ...f, latestMessage: updatedMsg }
              : f
          ))
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUser])

  // Load user backgrounds and selected background from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('userBackgrounds');
    if (saved) {
      try {
        setUserBackgrounds(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load user backgrounds:', e);
      }
    }
    
    const savedSelected = localStorage.getItem('selectedBackground');
    if (savedSelected) {
      setSelectedBackground(savedSelected);
    }
  }, []);
  
  // Save user backgrounds to localStorage
  useEffect(() => {
    if (userBackgrounds.length > 0) {
      localStorage.setItem('userBackgrounds', JSON.stringify(userBackgrounds));
    } else {
      localStorage.removeItem('userBackgrounds');
    }
  }, [userBackgrounds]);
  
  // Save selected background to localStorage
  useEffect(() => {
    localStorage.setItem('selectedBackground', selectedBackground);
  }, [selectedBackground]);
  
  // Handle background selection
  const handleBackgroundSelect = (backgroundId: string) => {
    setSelectedBackground(backgroundId);
  };

  // --- Initialize Profile Modal Data ---
  useEffect(() => {
    if (showProfileModal) {
      setEditNickname(currentUser.nickname || currentUser.username)
      setEditAvatarPreview(currentUser.avatar)
      setEditAvatarFile(null)
    }
  }, [showProfileModal, currentUser])

  // --- Logic ---
  const openUserSearch = async () => {
    setShowFriendModal(true)
    const { data: allUsers } = await supabase.from('users').select('*').neq('id', currentUser.id)
    if (allUsers) {
      const friendIds = friends.map(f => f.id)
      const nonFriends = allUsers.filter((u: any) => !friendIds.includes(u.id))
      setAvailableUsers(nonFriends as User[])
    }
  }

  const addFriend = async (targetUser: User) => {
    await supabase.from('friends').insert([{ user_id: currentUser.id, friend_id: targetUser.id }])
    await supabase.from('friends').insert([{ user_id: targetUser.id, friend_id: currentUser.id }])
    setShowFriendModal(false)
    fetchData()
  }

  const toggleFriendSelection = (friendId: number) => {
    setSelectedFriendIds(prev => 
      prev.includes(friendId) ? prev.filter(id => id !== friendId) : [...prev, friendId]
    )
  }

  const finalizeCreateGroup = async () => {
    if (!newGroupName.trim()) return alert("Please enter a group name")
    
    const { data: newGroup, error } = await supabase.from('groups').insert({ name: newGroupName, admin_id: currentUser.id }).select().single()
    if (error || !newGroup) return alert("Failed to create group")

    const members = [
      { group_id: newGroup.id, user_id: currentUser.id },
      ...selectedFriendIds.map(fid => ({ group_id: newGroup.id, user_id: fid }))
    ]
    await supabase.from('group_members').insert(members)
    setShowGroupModal(false)
    setNewGroupName('')
    setSelectedFriendIds([])
    fetchData()
    onSelect(newGroup, true)
  }

  const deleteGroup = async (groupId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Delete group?")) return
    const { error } = await supabase.from('groups').delete().eq('id', groupId)
    if (!error) fetchData()
  }

  // --- UPDATE PROFILE LOGIC ---
  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setEditAvatarFile(file)
      setEditAvatarPreview(URL.createObjectURL(file))
    }
  }

  const saveProfile = async () => {
    setIsUpdating(true)
    let finalAvatarUrl = currentUser.avatar

    try {
      // 1. Upload new image if selected
      if (editAvatarFile) {
        const formData = new FormData()
        formData.append('file', editAvatarFile)
        formData.append('upload_preset', process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!)
        
        const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData })
        const data = await res.json()
        if (data.secure_url) finalAvatarUrl = data.secure_url
      }

      // 2. Update Supabase
      const { data, error } = await supabase
        .from('users')
        .update({ nickname: editNickname, avatar: finalAvatarUrl })
        .eq('id', currentUser.id)
        .select()
        .single()

      if (error) throw error

      // 3. Update Parent State & Close
      if (data) {
        onUpdateUser(data as User)
        setShowProfileModal(false)
      }
    } catch (error) {
      console.error(error)
      alert("Failed to update profile")
    } finally {
      setIsUpdating(false)
    }
  }
  
  // Handle background image upload
  const handleBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image size should be less than 10MB');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      const newBackground = {
        id: `user-${Date.now()}`,
        name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
        url: url
      };
      setUserBackgrounds(prev => [...prev, newBackground]);
    };
    reader.onerror = () => {
      alert('Failed to read image file');
    };
    reader.readAsDataURL(file);
    
    // Reset file input
    if (backgroundFileInputRef.current) {
      backgroundFileInputRef.current.value = '';
    }
  };
  
  // Delete user background
  const deleteUserBackground = (id: string) => {
    setUserBackgrounds(prev => prev.filter(bg => bg.id !== id));
  };

  return (
    <div className="w-full md:w-80 bg-slate-800 border-r border-slate-700 flex flex-col h-full">
      {/* Current User Header */}
      <div className="p-4 bg-slate-900 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={currentUser.avatar} className="w-12 h-12 rounded-full border-2 border-green-500 object-cover" />
          <div>
            <h3 className="font-bold text-white max-w-[120px] truncate">{currentUser.nickname || currentUser.username}</h3>
            <span className="text-xs text-green-400">Online</span>
          </div>
        </div>
        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Settings Button */}
          <button 
            onClick={() => setShowProfileModal(true)}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-700 rounded-full transition-colors"
            title="Edit Profile"
          >
            <Settings size={20} />
          </button>
          
          {/* Logout Button */}
          <button 
            onClick={onLogout}
            className="p-2 text-slate-300 hover:text-red-400 hover:bg-slate-700 rounded-full transition-colors"
            title="Logout"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex p-2 gap-2 bg-slate-800 border-b border-slate-700">
        <button onClick={() => setView('friends')} className={`flex-1 p-2 rounded text-sm flex items-center justify-center gap-2 ${view === 'friends' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>
          <Users size={16} /> Friends
        </button>
        <button onClick={() => setView('groups')} className={`flex-1 p-2 rounded text-sm flex items-center justify-center gap-2 ${view === 'groups' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>
          <MessageSquare size={16} /> Groups
        </button>
        <button 
          onClick={() => fetchData()} 
          disabled={isRefreshing}
          className="p-2 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 hover:text-white transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {view === 'friends' ? (
          <>
             <button onClick={openUserSearch} className="w-full mb-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-100 p-2 rounded flex items-center justify-center gap-2 transition-colors">
                <Search size={16} /> Find New Friends
             </button>
             {friends.length === 0 ? (
               <div className="text-center py-8 text-slate-400 text-sm">
                 <p>No friends yet. Click "Find New Friends" to add some!</p>
               </div>
             ) : (
               friends.map(f => {
                 const latestMsg = f.latestMessage
                 
                 // Debug: Log what we're rendering
                 if (latestMsg) {
                   console.log(`🎨 Rendering friend ${f.username} with message:`, latestMsg.content?.substring(0, 30), 'is_read:', latestMsg.is_read, 'sender_id:', latestMsg.sender_id, 'currentUser.id:', currentUser.id)
                 }
                 
                 const getMessagePreview = () => {
                   if (!latestMsg) {
                     console.log(`⚠️ No latest message for ${f.username}`)
                     return null
                   }
                   const isFromMe = latestMsg.sender_id === currentUser.id
                   const prefix = isFromMe ? 'You: ' : ''
                   if (latestMsg.type === 'image') return `${prefix}📷 Image`
                   if (latestMsg.type === 'file') return `${prefix}📎 ${latestMsg.content || 'File'}`
                   const content = latestMsg.content || ''
                   console.log(`📝 Preview for ${f.username}:`, content.substring(0, 30))
                   return `${prefix}${content}`
                 }
                 const preview = getMessagePreview()
                 const isLatestFromMe = latestMsg && latestMsg.sender_id === currentUser.id
                 
                 return (
                   <div key={f.id} onClick={() => onSelect(f, false)} className="p-3 hover:bg-slate-700 rounded-lg cursor-pointer flex items-center gap-3 transition-colors">
                     <img src={f.avatar} className="w-10 h-10 rounded-full bg-slate-600 object-cover flex-shrink-0" />
                     <div className="flex-1 min-w-0 overflow-hidden">
                       <div className="flex items-center justify-between gap-2 mb-0.5">
                         <p className="text-slate-100 font-medium truncate">{f.nickname || f.username}</p>
                         {latestMsg && (
                           <div className="flex-shrink-0 ml-1 flex items-center" title={isLatestFromMe ? (latestMsg.is_read ? 'Read' : 'Sent') : (latestMsg.is_read ? 'You read it' : 'Unread')}>
                             {isLatestFromMe ? (
                               // Read status for messages sent by current user
                               latestMsg.is_read === true ? (
                                 // Two ticks green: sent and read
                                 <div className="flex items-center">
                                   <Check size={12} className="text-green-500" />
                                   <Check size={12} className="text-green-500 -ml-1" />
                                 </div>
                               ) : (
                                 // Two ticks red: sent but not read (is_read is false or undefined)
                                 <div className="flex items-center">
                                   <Check size={12} className="text-red-500" />
                                   <Check size={12} className="text-red-500 -ml-1" />
                                 </div>
                               )
                             ) : (
                               // Read status for messages received by current user
                               latestMsg.is_read === true ? (
                                 // Two ticks green: you have read it
                                 <div className="flex items-center">
                                   <Check size={12} className="text-green-500" />
                                   <Check size={12} className="text-green-500 -ml-1" />
                                 </div>
                               ) : (
                                 // Two ticks red: unread (you haven't read it yet)
                                 <div className="flex items-center">
                                   <Check size={12} className="text-red-500" />
                                   <Check size={12} className="text-red-500 -ml-1" />
                                 </div>
                               )
                             )}
                           </div>
                         )}
                       </div>
                       {preview ? (
                         <p className="text-xs text-slate-300 truncate block" title={preview}>{preview}</p>
                       ) : (
                         <p className="text-xs text-slate-400 truncate block">@{f.username}</p>
                       )}
                     </div>
                   </div>
                 )
               })
             )}
          </>
        ) : (
          <>
            <button onClick={() => setShowGroupModal(true)} className="w-full mb-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-100 p-2 rounded flex items-center justify-center gap-2 transition-colors">
              <Plus size={16} /> Create Group
            </button>
            {groups.map(g => {
              const latestMsg = g.latestMessage
              const getMessagePreview = () => {
                if (!latestMsg) return null
                if (latestMsg.type === 'image') return '📷 Image'
                if (latestMsg.type === 'file') return `📎 ${latestMsg.content || 'File'}`
                return latestMsg.content || ''
              }
              const preview = getMessagePreview()
              
              return (
                <div key={g.id} onClick={() => onSelect(g, true)} className="group p-3 hover:bg-slate-700 rounded-lg cursor-pointer flex items-center justify-between transition-colors">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">{g.name[0].toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-100 font-medium truncate">{g.name}</span>
                        {latestMsg && (
                          <div className="flex-shrink-0 flex items-center">
                            {latestMsg.sender_id === currentUser.id ? (
                              // Read status for messages sent by current user in group
                              latestMsg.is_read === true ? (
                                // Two ticks green: sent and read
                                <div className="flex items-center">
                                  <Check size={12} className="text-green-500" />
                                  <Check size={12} className="text-green-500 -ml-1" />
                                </div>
                              ) : (
                                // Two ticks red: sent but not read
                                <div className="flex items-center">
                                  <Check size={12} className="text-red-500" />
                                  <Check size={12} className="text-red-500 -ml-1" />
                                </div>
                              )
                            ) : (
                              // Read status for messages received by current user in group
                              latestMsg.is_read === true ? (
                                // Two ticks green: you have read it
                                <div className="flex items-center">
                                  <Check size={12} className="text-green-500" />
                                  <Check size={12} className="text-green-500 -ml-1" />
                                </div>
                              ) : (
                                // Two ticks red: unread
                                <div className="flex items-center">
                                  <Check size={12} className="text-red-500" />
                                  <Check size={12} className="text-red-500 -ml-1" />
                                </div>
                              )
                            )}
                          </div>
                        )}
                      </div>
                      {preview && (
                        <p className="text-xs text-slate-300 truncate mt-0.5">{preview}</p>
                      )}
                    </div>
                  </div>
                  {g.admin_id === currentUser.id && (
                    <button onClick={(e) => deleteGroup(g.id, e)} className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* --- PROFILE EDIT MODAL --- */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-800 w-full max-w-sm rounded-xl border border-slate-600 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] sm:max-h-[85vh]">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800 flex-shrink-0">
              <h3 className="text-white font-bold text-lg">Edit Profile</h3>
              <button onClick={() => setShowProfileModal(false)} className="text-slate-300 hover:text-white"><X size={20}/></button>
            </div>
            
            <div className="p-6 flex flex-col items-center gap-6 overflow-y-auto flex-1 min-h-0">
              {/* Avatar Upload */}
              <div className="relative group cursor-pointer">
                <img src={editAvatarPreview} className="w-32 h-32 rounded-full object-cover border-4 border-slate-700 group-hover:opacity-50 transition-opacity" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera className="text-white" size={32} />
                </div>
                <input 
                  type="file" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                  accept="image/*"
                  onChange={handleAvatarSelect}
                />
              </div>
              
              <div className="w-full space-y-2">
                <label className="text-xs text-slate-300 uppercase font-bold">Nickname</label>
                <input 
                  className="w-full bg-slate-700 text-white p-3 rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500"
                  value={editNickname}
                  onChange={e => setEditNickname(e.target.value)}
                  placeholder="Enter nickname"
                />
              </div>

              <div className="w-full space-y-2">
                <label className="text-xs text-slate-400 uppercase font-bold">Username</label>
                 <input 
                  className="w-full bg-slate-700/50 text-slate-400 p-3 rounded-lg border border-slate-600 cursor-not-allowed"
                  value={currentUser.username}
                  disabled
                  title="Username cannot be changed"
                />
              </div>
              
              {/* Video Call Backgrounds Section */}
              <div className="w-full space-y-3 border-t border-slate-700 pt-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-300 uppercase font-bold">Video Call Backgrounds</label>
                  <button
                    onClick={() => backgroundFileInputRef.current?.click()}
                    className="text-xs bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded flex items-center gap-1.5 text-white transition-colors"
                  >
                    <Upload size={14} />
                    Upload
                  </button>
                </div>
                
                <input
                  ref={backgroundFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleBackgroundUpload}
                  className="hidden"
                />
                
                {userBackgrounds.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto overscroll-contain">
                    {userBackgrounds.map(bg => (
                      <div key={bg.id} className="relative group">
                        <div className="aspect-video bg-slate-700 rounded-lg overflow-hidden border border-slate-600">
                          <img 
                            src={bg.url} 
                            alt={bg.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <button
                          onClick={() => deleteUserBackground(bg.id)}
                          className="absolute -top-1 -right-1 bg-red-600 hover:bg-red-500 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete"
                        >
                          <X size={12} className="text-white" />
                        </button>
                        <p className="text-xs text-slate-300 mt-1 truncate">{bg.name}</p>
                      </div>
                    ))}
                  </div>
                )}
                
                {userBackgrounds.length === 0 && (
                  <div className="text-center py-4 text-slate-400 text-sm">
                    <ImageIcon size={24} className="mx-auto mb-2 opacity-50" />
                    <p>No custom backgrounds yet</p>
                    <p className="text-xs mt-1">Upload images to use as video call backgrounds</p>
                  </div>
                )}
                
                {/* Background Selection */}
                <div className="mt-4 space-y-2">
                  <label className="text-xs text-slate-300 uppercase font-bold">Select Background</label>
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto overscroll-contain">
                    {getAllBackgrounds().map(bg => (
                      <button
                        key={bg.id}
                        onClick={() => handleBackgroundSelect(bg.id)}
                        className={`relative p-2 rounded-lg border-2 transition-colors ${
                          selectedBackground === bg.id 
                            ? 'border-blue-500 bg-blue-600/20' 
                            : 'border-slate-600 bg-slate-700 hover:bg-slate-600'
                        }`}
                      >
                        {bg.id === 'none' ? (
                          <div className="aspect-video bg-slate-800 rounded flex items-center justify-center">
                            <span className="text-xs text-slate-300">None</span>
                          </div>
                        ) : bg.id === 'blur' ? (
                          <div className="aspect-video bg-gradient-to-br from-slate-600 to-slate-800 rounded flex items-center justify-center">
                            <span className="text-xs text-slate-300">Blur</span>
                          </div>
                        ) : (
                          <div className="aspect-video bg-slate-700 rounded overflow-hidden">
                            <img 
                              src={bg.url || ''} 
                              alt={bg.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <p className="text-xs text-slate-300 mt-1 truncate text-center">{bg.name}</p>
                        {selectedBackground === bg.id && (
                          <div className="absolute top-1 right-1 bg-blue-500 rounded-full p-1">
                            <Check size={10} className="text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-800 flex-shrink-0">
              <button 
                onClick={saveProfile} 
                disabled={isUpdating}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isUpdating ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- OTHER MODALS (Friend / Group) --- */}
      {showFriendModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-800 w-full max-w-md rounded-xl border border-slate-600 shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-white font-bold text-lg">Add a Friend</h3>
              <button onClick={() => setShowFriendModal(false)} className="text-slate-300 hover:text-white"><X size={20}/></button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {availableUsers.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-3 hover:bg-slate-700 rounded-lg group">
                    <div className="flex items-center gap-3">
                      <img src={u.avatar} className="w-10 h-10 rounded-full" />
                      <div><p className="text-white font-medium">{u.nickname || u.username}</p></div>
                    </div>
                    <button onClick={() => addFriend(u)} className="bg-blue-600 p-2 rounded-full text-white hover:bg-blue-500"><UserPlus size={18} /></button>
                  </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showGroupModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-800 w-full max-w-md rounded-xl border border-slate-600 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
              <h3 className="text-white font-bold text-lg">Create New Group</h3>
              <button onClick={() => setShowGroupModal(false)} className="text-slate-300 hover:text-white"><X size={20}/></button>
            </div>
            <div className="p-4 overflow-y-auto">
              <input className="w-full bg-gray-800 text-white p-3 rounded-lg border border-gray-700 mb-6" placeholder="Group Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
              <label className="block text-xs text-gray-400 mb-2 uppercase font-bold">Select Members</label>
              <div className="space-y-1">
                {friends.map(f => {
                  const isSelected = selectedFriendIds.includes(f.id)
                  return (
                    <div key={f.id} onClick={() => toggleFriendSelection(f.id)} className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${isSelected ? 'bg-blue-900/30 border border-blue-600/50' : 'hover:bg-gray-800 border border-transparent'}`}>
                      <div className="flex items-center gap-3"><img src={f.avatar} className="w-10 h-10 rounded-full" /><span className={`font-medium ${isSelected ? 'text-blue-400' : 'text-gray-300'}`}>{f.nickname || f.username}</span></div>
                      {isSelected && <Check size={14} className="text-white" />}
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="p-4 border-t border-gray-800 bg-gray-900">
              <button onClick={finalizeCreateGroup} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg">Create Group</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
